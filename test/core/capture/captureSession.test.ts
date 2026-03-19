import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CaptureSession } from '../../../src/core/capture/captureSession';
import { RecorderManager } from '../../../src/core/recorders';
import { QueueSpy } from '../../../src/core/spies/queueSpy';
import { EncoderSpy } from '../../../src/core/spies/encoderSpy';
import { RenderPassSpy } from '../../../src/core/spies/renderPassSpy';
import { ComputePassSpy } from '../../../src/core/spies/computePassSpy';
import { CommandType } from '../../../src/shared/types';
import type { ICapture } from '../../../src/shared/types';
import { globalIdGenerator } from '../../../src/shared/utils';
import {
    resetMockIds,
    MockGPUQueue,
    MockGPUCommandEncoder,
    MockGPURenderPassEncoder,
    MockGPUComputePassEncoder,
    MockGPURenderPipeline,
    MockGPUBindGroup,
    MockGPUBuffer,
} from '../../mocks';

describe('CaptureSession', () => {
    let session: CaptureSession;
    let recorderManager: RecorderManager;
    let queueSpy: QueueSpy;
    let encoderSpy: EncoderSpy;
    let renderPassSpy: RenderPassSpy;
    let computePassSpy: ComputePassSpy;

    beforeEach(() => {
        resetMockIds();
        globalIdGenerator.reset();
        recorderManager = new RecorderManager();
        queueSpy = new QueueSpy();
        encoderSpy = new EncoderSpy();
        renderPassSpy = new RenderPassSpy();
        computePassSpy = new ComputePassSpy();
        session = new CaptureSession(recorderManager);
    });

    afterEach(() => {
        session.dispose();
        queueSpy.dispose();
        encoderSpy.dispose();
        renderPassSpy.dispose();
        computePassSpy.dispose();
    });

    function startCapture(): void {
        session.startCapture(queueSpy, encoderSpy, renderPassSpy, computePassSpy);
    }

    // ─── Basic lifecycle ─────────────────────────────────────────────

    it('startCapture sets isCapturing to true', () => {
        expect(session.isCapturing).toBe(false);
        startCapture();
        expect(session.isCapturing).toBe(true);
    });

    it('stopCapture when not capturing returns null', () => {
        expect(session.stopCapture()).toBeNull();
    });

    it('double startCapture is idempotent', () => {
        startCapture();
        // Trigger a submit to put a command in the tree
        queueSpy.onSubmit.trigger({
            queue: new MockGPUQueue() as unknown as GPUQueue,
            commandBuffers: [],
        });
        // Second start should be a no-op — tree should NOT be reset
        session.startCapture(queueSpy, encoderSpy, renderPassSpy, computePassSpy);
        expect(session.isCapturing).toBe(true);

        const capture = session.stopCapture()!;
        // The submit from before the second startCapture should still be there
        expect(capture.commands.length).toBe(1);
    });

    it('stopCapture produces ICapture with correct structure', () => {
        session.setAdapterInfo({
            vendor: 'test-vendor',
            architecture: 'test-arch',
            device: 'test-device',
            description: 'Test Adapter',
            backend: 'test',
        });

        startCapture();
        const capture = session.stopCapture()!;

        expect(capture).not.toBeNull();
        expect(capture.id).toMatch(/^capture_\d+$/);
        expect(capture.version).toBe('0.1.0');
        expect(capture.timestamp).toBeGreaterThan(0);
        expect(capture.duration).toBeGreaterThanOrEqual(0);
        expect(capture.adapterInfo.vendor).toBe('test-vendor');
        expect(capture.commands).toEqual([]);
        expect(capture.resources).toBeDefined();
        expect(capture.stats).toBeDefined();
        expect(capture.stats.totalCommands).toBe(0);
    });

    it('stopCapture with no adapter info uses empty defaults', () => {
        startCapture();
        const capture = session.stopCapture()!;
        expect(capture.adapterInfo.vendor).toBe('');
        expect(capture.adapterInfo.backend).toBe('');
    });

    it('stopCapture fires onCaptureComplete', () => {
        const received: ICapture[] = [];
        session.onCaptureComplete.add((c) => received.push(c));

        startCapture();
        session.stopCapture();

        expect(received).toHaveLength(1);
        expect(received[0].id).toMatch(/^capture_/);
    });

    it('dispose cleans up and aborts active capture', () => {
        const errors: string[] = [];
        session.onCaptureError.add((e) => errors.push(e));

        startCapture();
        session.dispose();

        expect(session.isCapturing).toBe(false);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('disposed');
    });

    // ─── Queue submit events ─────────────────────────────────────────

    it('queue submit creates Submit scope in command tree', () => {
        startCapture();

        queueSpy.onSubmit.trigger({
            queue: new MockGPUQueue() as unknown as GPUQueue,
            commandBuffers: [{} as GPUCommandBuffer, {} as GPUCommandBuffer],
        });

        const capture = session.stopCapture()!;
        expect(capture.commands).toHaveLength(1);
        expect(capture.commands[0].type).toBe(CommandType.Submit);
        expect(capture.commands[0].args.commandBufferCount).toBe(2);
    });

    it('writeBuffer and writeTexture are recorded', () => {
        startCapture();

        queueSpy.onWriteBuffer.trigger({
            queue: new MockGPUQueue() as unknown as GPUQueue,
            args: [{}, 0, new Float32Array(4)],
        });
        queueSpy.onWriteTexture.trigger({
            queue: new MockGPUQueue() as unknown as GPUQueue,
            args: [{}, new Uint8Array(16), {}, {}],
        });

        const capture = session.stopCapture()!;
        expect(capture.commands).toHaveLength(2);
        expect(capture.commands[0].type).toBe(CommandType.WriteBuffer);
        expect(capture.commands[1].type).toBe(CommandType.WriteTexture);
    });

    // ─── Render pass events ──────────────────────────────────────────

    it('beginRenderPass/end create nested scope', () => {
        startCapture();

        // Submit scope
        queueSpy.onSubmit.trigger({
            queue: new MockGPUQueue() as unknown as GPUQueue,
            commandBuffers: [],
        });

        // Begin render pass
        encoderSpy.onBeginRenderPass.trigger({
            encoder: new MockGPUCommandEncoder() as unknown as GPUCommandEncoder,
            pass: new MockGPURenderPassEncoder() as unknown as GPURenderPassEncoder,
            descriptor: { colorAttachments: [] },
        });

        // Add a draw call inside the pass
        renderPassSpy.onCommand.trigger({
            pass: new MockGPURenderPassEncoder() as unknown as GPURenderPassEncoder,
            methodName: 'draw',
            args: [3, 1, 0, 0],
        });

        // End pass
        renderPassSpy.onEnd.trigger({
            pass: new MockGPURenderPassEncoder() as unknown as GPURenderPassEncoder,
        });

        const capture = session.stopCapture()!;
        // Root: Submit
        expect(capture.commands).toHaveLength(1);
        const submit = capture.commands[0];
        expect(submit.type).toBe(CommandType.Submit);
        // Submit → RenderPass
        expect(submit.children).toHaveLength(1);
        const pass = submit.children[0];
        expect(pass.type).toBe(CommandType.RenderPass);
        // RenderPass → draw
        expect(pass.children).toHaveLength(1);
        expect(pass.children[0].type).toBe(CommandType.Draw);
        expect(pass.children[0].name).toBe('renderPass.draw');

        // Stats
        expect(capture.stats.totalCommands).toBe(3); // submit + renderPass + draw
        expect(capture.stats.drawCalls).toBe(1);
        expect(capture.stats.renderPasses).toBe(1);
    });

    it('draw calls have state snapshots with pipelineId, bindGroups, vertexBuffers', () => {
        // Register resources in RecorderManager so getId works
        const pipeline = new MockGPURenderPipeline({ label: 'testPipeline' });
        const bindGroup = new MockGPUBindGroup({ label: 'testBG' });
        const vertexBuffer = new MockGPUBuffer({ label: 'testVB', size: 256, usage: 0x20 });
        const indexBuffer = new MockGPUBuffer({ label: 'testIB', size: 128, usage: 0x10 });

        recorderManager.trackObject(pipeline, 'rp');
        recorderManager.trackObject(bindGroup, 'bg');
        recorderManager.trackObject(vertexBuffer, 'buf');
        recorderManager.trackObject(indexBuffer, 'buf');

        const pipelineId = recorderManager.getId(pipeline)!;
        const bindGroupId = recorderManager.getId(bindGroup)!;
        const vertexBufferId = recorderManager.getId(vertexBuffer)!;
        const indexBufferId = recorderManager.getId(indexBuffer)!;

        startCapture();

        // Begin render pass
        encoderSpy.onBeginRenderPass.trigger({
            encoder: {} as GPUCommandEncoder,
            pass: {} as GPURenderPassEncoder,
            descriptor: {},
        });

        // Set pipeline
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setPipeline',
            args: [pipeline],
        });

        // Set bind group at index 0
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setBindGroup',
            args: [0, bindGroup],
        });

        // Set vertex buffer at slot 0
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setVertexBuffer',
            args: [0, vertexBuffer],
        });

        // Set index buffer
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setIndexBuffer',
            args: [indexBuffer, 'uint16'],
        });

        // Draw
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'drawIndexed',
            args: [36, 1, 0, 0, 0],
        });

        // End pass
        renderPassSpy.onEnd.trigger({ pass: {} as GPURenderPassEncoder });

        const capture = session.stopCapture()!;
        const pass = capture.commands[0]; // renderPass scope
        // Find the draw node (last child)
        const drawNode = pass.children[pass.children.length - 1];

        expect(drawNode.type).toBe(CommandType.Draw);
        expect(drawNode.pipelineId).toBe(pipelineId);
        expect(drawNode.bindGroups).toEqual([bindGroupId]);
        expect(drawNode.vertexBuffers).toEqual([vertexBufferId]);
        expect(drawNode.indexBufferId).toBe(indexBufferId);
    });

    // ─── Compute pass events ─────────────────────────────────────────

    it('compute pass dispatch calls are recorded with state snapshots', () => {
        const pipeline = new MockGPURenderPipeline({ label: 'computePipe' });
        const bindGroup = new MockGPUBindGroup({ label: 'computeBG' });
        recorderManager.trackObject(pipeline, 'cp');
        recorderManager.trackObject(bindGroup, 'bg');

        const pipelineId = recorderManager.getId(pipeline)!;
        const bindGroupId = recorderManager.getId(bindGroup)!;

        startCapture();

        // Begin compute pass
        encoderSpy.onBeginComputePass.trigger({
            encoder: {} as GPUCommandEncoder,
            pass: {} as GPUComputePassEncoder,
            descriptor: {},
        });

        // Set pipeline
        computePassSpy.onCommand.trigger({
            pass: {} as GPUComputePassEncoder,
            methodName: 'setPipeline',
            args: [pipeline],
        });

        // Set bind group
        computePassSpy.onCommand.trigger({
            pass: {} as GPUComputePassEncoder,
            methodName: 'setBindGroup',
            args: [0, bindGroup],
        });

        // Dispatch
        computePassSpy.onCommand.trigger({
            pass: {} as GPUComputePassEncoder,
            methodName: 'dispatchWorkgroups',
            args: [64, 1, 1],
        });

        // End pass
        computePassSpy.onEnd.trigger({ pass: {} as GPUComputePassEncoder });

        const capture = session.stopCapture()!;
        expect(capture.stats.dispatchCalls).toBe(1);
        expect(capture.stats.computePasses).toBe(1);

        const pass = capture.commands[0]; // computePass scope
        expect(pass.type).toBe(CommandType.ComputePass);
        const dispatchNode = pass.children[pass.children.length - 1];
        expect(dispatchNode.type).toBe(CommandType.Dispatch);
        expect(dispatchNode.pipelineId).toBe(pipelineId);
        expect(dispatchNode.bindGroups).toEqual([bindGroupId]);
    });

    // ─── Encoder commands ────────────────────────────────────────────

    it('encoder transfer commands are recorded (not beginRenderPass/finish)', () => {
        startCapture();

        queueSpy.onSubmit.trigger({
            queue: {} as GPUQueue,
            commandBuffers: [],
        });

        // This should be recorded
        encoderSpy.onCommand.trigger({
            encoder: {} as GPUCommandEncoder,
            methodName: 'copyBufferToBuffer',
            args: [{}, 0, {}, 0, 256],
        });

        // These should be skipped (handled by dedicated listeners)
        encoderSpy.onCommand.trigger({
            encoder: {} as GPUCommandEncoder,
            methodName: 'beginRenderPass',
            args: [{}],
        });
        encoderSpy.onCommand.trigger({
            encoder: {} as GPUCommandEncoder,
            methodName: 'finish',
            args: [],
        });

        const capture = session.stopCapture()!;
        const submit = capture.commands[0];
        // Only copyBufferToBuffer should be a child
        expect(submit.children).toHaveLength(1);
        expect(submit.children[0].type).toBe(CommandType.CopyBufferToBuffer);
    });

    // ─── Abort on device lost ────────────────────────────────────────

    it('abortCapture fires onCaptureError', () => {
        const errors: string[] = [];
        session.onCaptureError.add((e) => errors.push(e));

        startCapture();
        session.abortCapture('Device lost: destroyed');

        expect(session.isCapturing).toBe(false);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Device lost');
    });

    it('abortCapture when not capturing is a no-op', () => {
        const errors: string[] = [];
        session.onCaptureError.add((e) => errors.push(e));

        session.abortCapture('should not fire');
        expect(errors).toHaveLength(0);
    });

    // ─── Timeout ─────────────────────────────────────────────────────

    it('capture timeout fires onCaptureError', () => {
        vi.useFakeTimers();
        try {
            const errors: string[] = [];
            session.onCaptureError.add((e) => errors.push(e));

            startCapture();
            expect(session.isCapturing).toBe(true);

            // Advance past the timeout
            vi.advanceTimersByTime(30_001);

            expect(session.isCapturing).toBe(false);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('timed out');
        } finally {
            vi.useRealTimers();
        }
    });

    it('stopCapture clears timeout', () => {
        vi.useFakeTimers();
        try {
            const errors: string[] = [];
            session.onCaptureError.add((e) => errors.push(e));

            startCapture();
            session.stopCapture();

            // Advance past timeout — should NOT fire
            vi.advanceTimersByTime(60_000);
            expect(errors).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    // ─── Resource stats ──────────────────────────────────────────────

    it('capture includes resource counts from RecorderManager', () => {
        // Register some resources
        const buf = {};
        const tex = {};
        recorderManager.recordBufferCreation(buf, { size: 256, usage: 0x40 });
        recorderManager.recordTextureCreation(tex, {
            size: { width: 128, height: 128 },
            format: 'rgba8unorm',
            usage: 0x10,
        });

        startCapture();
        const capture = session.stopCapture()!;

        expect(capture.stats.bufferCount).toBe(1);
        expect(capture.stats.textureCount).toBe(1);
        expect(capture.resources.buffers.size).toBe(1);
        expect(capture.resources.textures.size).toBe(1);
    });

    // ─── Device info ─────────────────────────────────────────────────

    it('setDeviceInfo extracts limits and features', () => {
        const mockDevice = {
            limits: { maxTextureDimension2D: 8192, maxBindGroups: 4 },
            features: new Set(['texture-compression-bc', 'depth-clip-control']),
        };

        session.setDeviceInfo(mockDevice);
        startCapture();
        const capture = session.stopCapture()!;

        expect(capture.deviceLimits.maxTextureDimension2D).toBe(8192);
        expect(capture.deviceLimits.maxBindGroups).toBe(4);
        expect(capture.deviceFeatures).toContain('texture-compression-bc');
        expect(capture.deviceFeatures).toContain('depth-clip-control');
    });

    // ─── Pass state reset ────────────────────────────────────────────

    it('pass state resets between render passes', () => {
        const pipeline1 = new MockGPURenderPipeline({ label: 'pipe1' });
        const pipeline2 = new MockGPURenderPipeline({ label: 'pipe2' });
        recorderManager.trackObject(pipeline1, 'rp');
        recorderManager.trackObject(pipeline2, 'rp');
        const pipelineId2 = recorderManager.getId(pipeline2)!;

        startCapture();

        // First render pass — set pipeline
        encoderSpy.onBeginRenderPass.trigger({
            encoder: {} as GPUCommandEncoder,
            pass: {} as GPURenderPassEncoder,
            descriptor: {},
        });
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setPipeline',
            args: [pipeline1],
        });
        renderPassSpy.onEnd.trigger({ pass: {} as GPURenderPassEncoder });

        // Second render pass — set different pipeline, draw
        encoderSpy.onBeginRenderPass.trigger({
            encoder: {} as GPUCommandEncoder,
            pass: {} as GPURenderPassEncoder,
            descriptor: {},
        });
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setPipeline',
            args: [pipeline2],
        });
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'draw',
            args: [3],
        });
        renderPassSpy.onEnd.trigger({ pass: {} as GPURenderPassEncoder });

        const capture = session.stopCapture()!;
        // Second pass's draw should have pipeline2's id, not pipeline1's
        const secondPass = capture.commands[1]; // second render pass is root since no submit scope
        const drawNode = secondPass.children[secondPass.children.length - 1];
        expect(drawNode.pipelineId).toBe(pipelineId2);
        // Should NOT carry over bind groups from first pass
        expect(drawNode.bindGroups).toEqual([]);
    });

    // ─── Events after stop ───────────────────────────────────────────

    it('events after stopCapture are not recorded', () => {
        startCapture();

        queueSpy.onSubmit.trigger({
            queue: {} as GPUQueue,
            commandBuffers: [],
        });

        const capture = session.stopCapture()!;
        expect(capture.commands).toHaveLength(1);

        // Events after stop should not affect the frozen capture
        queueSpy.onSubmit.trigger({
            queue: {} as GPUQueue,
            commandBuffers: [],
        });

        // The capture should still have exactly 1 command
        expect(capture.commands).toHaveLength(1);
    });

    // ─── Complex scenario ────────────────────────────────────────────

    it('full frame: submit → renderPass → draw + compute dispatch', () => {
        startCapture();

        // Submit
        queueSpy.onSubmit.trigger({
            queue: {} as GPUQueue,
            commandBuffers: [],
        });

        // RenderPass
        encoderSpy.onBeginRenderPass.trigger({
            encoder: {} as GPUCommandEncoder,
            pass: {} as GPURenderPassEncoder,
            descriptor: { colorAttachments: [{ loadOp: 'clear' }] },
        });
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'setPipeline',
            args: [{}],
        });
        renderPassSpy.onCommand.trigger({
            pass: {} as GPURenderPassEncoder,
            methodName: 'draw',
            args: [6],
        });
        renderPassSpy.onEnd.trigger({ pass: {} as GPURenderPassEncoder });

        // ComputePass
        encoderSpy.onBeginComputePass.trigger({
            encoder: {} as GPUCommandEncoder,
            pass: {} as GPUComputePassEncoder,
            descriptor: {},
        });
        computePassSpy.onCommand.trigger({
            pass: {} as GPUComputePassEncoder,
            methodName: 'setPipeline',
            args: [{}],
        });
        computePassSpy.onCommand.trigger({
            pass: {} as GPUComputePassEncoder,
            methodName: 'dispatchWorkgroups',
            args: [32, 32, 1],
        });
        computePassSpy.onEnd.trigger({ pass: {} as GPUComputePassEncoder });

        const capture = session.stopCapture()!;

        // Structure: Submit → [RenderPass → [setPipeline, draw], ComputePass → [setPipeline, dispatch]]
        expect(capture.commands).toHaveLength(1);
        const submit = capture.commands[0];
        expect(submit.type).toBe(CommandType.Submit);
        expect(submit.children).toHaveLength(2);

        const rp = submit.children[0];
        expect(rp.type).toBe(CommandType.RenderPass);
        expect(rp.children).toHaveLength(2);
        expect(rp.children[0].type).toBe(CommandType.SetPipeline);
        expect(rp.children[1].type).toBe(CommandType.Draw);

        const cp = submit.children[1];
        expect(cp.type).toBe(CommandType.ComputePass);
        expect(cp.children).toHaveLength(2);
        expect(cp.children[0].type).toBe(CommandType.SetPipeline);
        expect(cp.children[1].type).toBe(CommandType.Dispatch);

        expect(capture.stats.totalCommands).toBe(7); // submit + rp + 2 rp cmds + cp + 2 cp cmds
        expect(capture.stats.drawCalls).toBe(1);
        expect(capture.stats.dispatchCalls).toBe(1);
        expect(capture.stats.renderPasses).toBe(1);
        expect(capture.stats.computePasses).toBe(1);
    });
});
