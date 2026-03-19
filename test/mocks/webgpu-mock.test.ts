/**
 * Validation tests for the WebGPU mock.
 * Covers: compilation, call tracking, async behavior, buffer state machine,
 * device lost simulation, canvas context, and label propagation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    createMockWebGPU,
    resetMockIds,
    MockGPUDevice,
    MockGPUBuffer,
    MockGPUTexture,
    MockGPURenderPassEncoder,
    MockGPUComputePassEncoder,
    MockGPUCommandEncoder,
    MockGPUCanvasContext,
    type MockCall,
} from '../mocks';

describe('WebGPU Mock', () => {
    beforeEach(() => {
        resetMockIds();
    });

    // ── Factory & Global Install ──

    describe('createMockWebGPU', () => {
        it('returns gpu, installGlobal, removeGlobal', () => {
            const result = createMockWebGPU();
            expect(result.gpu).toBeDefined();
            expect(typeof result.installGlobal).toBe('function');
            expect(typeof result.removeGlobal).toBe('function');
        });

        it('installGlobal sets navigator.gpu', () => {
            const { gpu, installGlobal, removeGlobal } = createMockWebGPU();
            installGlobal();
            expect((navigator as any).gpu).toBe(gpu);
            removeGlobal();
            expect((navigator as any).gpu).toBeUndefined();
        });

        it('installGlobal is idempotent', () => {
            const { installGlobal, removeGlobal } = createMockWebGPU();
            installGlobal();
            installGlobal(); // should not throw
            removeGlobal();
        });
    });

    // ── Async Pipeline ──

    describe('async pipeline', () => {
        it('requestAdapter → requestDevice → createBuffer', async () => {
            const { gpu } = createMockWebGPU();
            const adapter = await gpu.requestAdapter();
            expect(adapter).not.toBeNull();
            expect(gpu.__calls[0].method).toBe('requestAdapter');

            const device = await adapter!.requestDevice();
            expect(device).toBeInstanceOf(MockGPUDevice);

            const buffer = device.createBuffer({ size: 256, usage: 0x40 });
            expect(buffer).toBeInstanceOf(MockGPUBuffer);
            expect(buffer.size).toBe(256);
            expect(buffer.usage).toBe(0x40);
        });

        it('requestAdapter returns a real Promise (not sync)', async () => {
            const { gpu } = createMockWebGPU();
            const promise = gpu.requestAdapter();
            expect(promise).toBeInstanceOf(Promise);
            const adapter = await promise;
            expect(adapter).not.toBeNull();
        });
    });

    // ── Call Tracking ──

    describe('call tracking', () => {
        it('tracks device.createBuffer calls', () => {
            const device = new MockGPUDevice();
            device.createBuffer({ size: 64, usage: 1 });
            device.createBuffer({ size: 128, usage: 2, label: 'vbo' });

            expect(device.__calls).toHaveLength(2);
            expect(device.__calls[0].method).toBe('createBuffer');
            expect(device.__calls[1].method).toBe('createBuffer');
            expect((device.__calls[1].args[0] as any).label).toBe('vbo');
        });

        it('tracks queue.submit calls', () => {
            const device = new MockGPUDevice();
            const encoder = device.createCommandEncoder();
            const cmdBuf = encoder.finish();
            device.queue.submit([cmdBuf]);

            expect(device.queue.__calls).toHaveLength(1);
            expect(device.queue.__calls[0].method).toBe('submit');
        });

        it('timestamps are monotonically increasing', () => {
            const device = new MockGPUDevice();
            device.createBuffer({ size: 64, usage: 1 });
            device.createBuffer({ size: 128, usage: 2 });
            expect(device.__calls[1].timestamp).toBeGreaterThanOrEqual(
                device.__calls[0].timestamp,
            );
        });

        it('tracks all 19 render pass encoder methods', () => {
            const rpe = new MockGPURenderPassEncoder();
            rpe.setPipeline({});
            rpe.setBindGroup(0, {});
            rpe.setVertexBuffer(0, {});
            rpe.setIndexBuffer({}, 'uint16');
            rpe.draw(3);
            rpe.drawIndexed(6);
            rpe.drawIndirect({}, 0);
            rpe.drawIndexedIndirect({}, 0);
            rpe.setViewport(0, 0, 800, 600, 0, 1);
            rpe.setScissorRect(0, 0, 800, 600);
            rpe.setBlendConstant({ r: 1, g: 1, b: 1, a: 1 });
            rpe.setStencilReference(0);
            rpe.insertDebugMarker('marker');
            rpe.pushDebugGroup('group');
            rpe.popDebugGroup();
            rpe.beginOcclusionQuery(0);
            rpe.endOcclusionQuery();
            rpe.executeBundles([]);
            rpe.end();

            expect(rpe.__calls).toHaveLength(19);
            const methods = rpe.__calls.map((c: MockCall) => c.method);
            expect(methods).toEqual([
                'setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer',
                'draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect',
                'setViewport', 'setScissorRect', 'setBlendConstant', 'setStencilReference',
                'insertDebugMarker', 'pushDebugGroup', 'popDebugGroup',
                'beginOcclusionQuery', 'endOcclusionQuery',
                'executeBundles', 'end',
            ]);
        });

        it('tracks all 8 compute pass encoder methods', () => {
            const cpe = new MockGPUComputePassEncoder();
            cpe.setPipeline({});
            cpe.setBindGroup(0, {});
            cpe.dispatchWorkgroups(8, 8, 1);
            cpe.dispatchWorkgroupsIndirect({}, 0);
            cpe.insertDebugMarker('marker');
            cpe.pushDebugGroup('group');
            cpe.popDebugGroup();
            cpe.end();

            expect(cpe.__calls).toHaveLength(8);
        });
    });

    // ── Buffer State Machine ──

    describe('buffer state machine', () => {
        it('starts unmapped', () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x40 });
            expect(buf.mapState).toBe('unmapped');
        });

        it('mapAsync transitions: unmapped → pending → mapped', async () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            const p = buf.mapAsync(1);

            // After calling mapAsync but before microtask fires: pending
            expect(buf.mapState).toBe('pending');

            await p;
            expect(buf.mapState).toBe('mapped');
        });

        it('getMappedRange works in mapped state', async () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            await buf.mapAsync(1);
            const range = buf.getMappedRange();
            expect(range).toBeInstanceOf(ArrayBuffer);
            expect(range.byteLength).toBe(256);
        });

        it('getMappedRange throws in unmapped state', () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            expect(() => buf.getMappedRange()).toThrow();
        });

        it('getMappedRange throws in pending state', () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            buf.mapAsync(1); // don't await — state is pending
            expect(() => buf.getMappedRange()).toThrow();
        });

        it('unmap transitions back to unmapped', async () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            await buf.mapAsync(1);
            expect(buf.mapState).toBe('mapped');
            buf.unmap();
            expect(buf.mapState).toBe('unmapped');
        });

        it('mappedAtCreation starts in mapped state', () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x40, mappedAtCreation: true });
            expect(buf.mapState).toBe('mapped');
            const range = buf.getMappedRange();
            expect(range.byteLength).toBe(256);
        });

        it('mapAsync rejects if buffer is destroyed', async () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            buf.destroy();
            await expect(buf.mapAsync(1)).rejects.toThrow('destroyed');
        });

        it('mapAsync rejects if already mapped', async () => {
            const buf = new MockGPUBuffer({ size: 256, usage: 0x41 });
            await buf.mapAsync(1);
            await expect(buf.mapAsync(1)).rejects.toThrow();
        });
    });

    // ── Device Lost ──

    describe('device lost simulation', () => {
        it('lost promise resolves when simulateLost is called', async () => {
            const device = new MockGPUDevice();
            device.simulateLost('test-reason');
            const info = await device.lost;
            expect(info.reason).toBe('test-reason');
            expect(info.message).toContain('test-reason');
        });

        it('destroy() resolves lost with reason "destroyed"', async () => {
            const device = new MockGPUDevice();
            device.destroy();
            const info = await device.lost;
            expect(info.reason).toBe('destroyed');
        });

        it('simulateLost is idempotent', async () => {
            const device = new MockGPUDevice();
            device.simulateLost('first');
            device.simulateLost('second'); // should not throw or change reason
            const info = await device.lost;
            expect(info.reason).toBe('first');
        });

        it('device still creates resources after lost', async () => {
            const device = new MockGPUDevice();
            device.simulateLost('unknown');
            await device.lost;
            // Per spec, create* still returns objects (validation errors happen separately)
            const buf = device.createBuffer({ size: 64, usage: 1 });
            expect(buf).toBeInstanceOf(MockGPUBuffer);
        });
    });

    // ── Label Support ──

    describe('label support', () => {
        it('propagates labels through create methods', () => {
            const device = new MockGPUDevice({ label: 'my-device' });
            expect(device.label).toBe('my-device');

            const buf = device.createBuffer({ label: 'vbo', size: 64, usage: 1 });
            expect(buf.label).toBe('vbo');

            const tex = device.createTexture({
                label: 'diffuse',
                size: { width: 512, height: 512 },
                format: 'rgba8unorm',
                usage: 4,
            });
            expect(tex.label).toBe('diffuse');
        });

        it('defaults label to empty string', () => {
            const device = new MockGPUDevice();
            expect(device.label).toBe('');
        });
    });

    // ── Texture ──

    describe('MockGPUTexture', () => {
        it('parses object-style size', () => {
            const tex = new MockGPUTexture({
                size: { width: 1024, height: 768, depthOrArrayLayers: 6 },
                format: 'rgba16float',
                usage: 0x04,
            });
            expect(tex.width).toBe(1024);
            expect(tex.height).toBe(768);
            expect(tex.depthOrArrayLayers).toBe(6);
            expect(tex.format).toBe('rgba16float');
        });

        it('parses array-style size', () => {
            const tex = new MockGPUTexture({ size: [256, 128, 4] });
            expect(tex.width).toBe(256);
            expect(tex.height).toBe(128);
            expect(tex.depthOrArrayLayers).toBe(4);
        });

        it('createView returns MockGPUTextureView', () => {
            const tex = new MockGPUTexture({ size: [64, 64], format: 'rgba8unorm', usage: 4 });
            const view = tex.createView({ label: 'my-view' });
            expect(view.label).toBe('my-view');
            expect(tex.__calls[0].method).toBe('createView');
        });
    });

    // ── Command Encoder ──

    describe('MockGPUCommandEncoder', () => {
        it('beginRenderPass returns MockGPURenderPassEncoder', () => {
            const enc = new MockGPUCommandEncoder({ label: 'enc' });
            const rp = enc.beginRenderPass({ colorAttachments: [], label: 'rp' });
            expect(rp).toBeInstanceOf(MockGPURenderPassEncoder);
            expect(rp.label).toBe('rp');
            expect(enc.__calls[0].method).toBe('beginRenderPass');
        });

        it('beginComputePass returns MockGPUComputePassEncoder', () => {
            const enc = new MockGPUCommandEncoder();
            const cp = enc.beginComputePass({ label: 'cp' });
            expect(cp).toBeInstanceOf(MockGPUComputePassEncoder);
        });

        it('finish returns MockGPUCommandBuffer', () => {
            const enc = new MockGPUCommandEncoder();
            const cb = enc.finish({ label: 'cb' });
            expect(cb.label).toBe('cb');
        });

        it('tracks copy operations', () => {
            const enc = new MockGPUCommandEncoder();
            enc.copyBufferToBuffer({}, 0, {}, 0, 256);
            enc.copyTextureToBuffer({}, {}, {});
            enc.copyBufferToTexture({}, {}, {});
            enc.copyTextureToTexture({}, {}, {});
            enc.clearBuffer({}, 0, 64);
            expect(enc.__calls.map(c => c.method)).toEqual([
                'copyBufferToBuffer',
                'copyTextureToBuffer',
                'copyBufferToTexture',
                'copyTextureToTexture',
                'clearBuffer',
            ]);
        });
    });

    // ── Canvas Context ──

    describe('MockGPUCanvasContext', () => {
        it('getCurrentTexture returns a MockGPUTexture', () => {
            const ctx = new MockGPUCanvasContext();
            const device = new MockGPUDevice();
            ctx.configure({ device, format: 'bgra8unorm' });
            const tex = ctx.getCurrentTexture();
            expect(tex).toBeInstanceOf(MockGPUTexture);
            expect(tex.format).toBe('bgra8unorm');
        });

        it('getCurrentTexture returns same texture until _nextFrame', () => {
            const ctx = new MockGPUCanvasContext();
            ctx.configure({ device: {}, format: 'rgba8unorm' });
            const t1 = ctx.getCurrentTexture();
            const t2 = ctx.getCurrentTexture();
            expect(t1).toBe(t2); // same object

            ctx._nextFrame();
            const t3 = ctx.getCurrentTexture();
            expect(t3).not.toBe(t1); // new texture
        });

        it('unconfigure clears the texture', () => {
            const ctx = new MockGPUCanvasContext();
            ctx.configure({ device: {}, format: 'rgba8unorm' });
            ctx.getCurrentTexture();
            ctx.unconfigure();
            // After unconfigure, getting a new texture should create a fresh one
            const tex = ctx.getCurrentTexture();
            expect(tex).toBeInstanceOf(MockGPUTexture);
        });
    });

    // ── Error Scopes ──

    describe('error scopes', () => {
        it('pushErrorScope and popErrorScope track calls', async () => {
            const device = new MockGPUDevice();
            device.pushErrorScope('validation');
            device.pushErrorScope('out-of-memory');
            const error = await device.popErrorScope();
            expect(error).toBeNull();

            expect(device.__calls.map(c => c.method)).toEqual([
                'pushErrorScope', 'pushErrorScope', 'popErrorScope',
            ]);
        });
    });

    // ── EventTarget on Device ──

    describe('device event listeners', () => {
        it('addEventListener + dispatchEvent works', () => {
            const device = new MockGPUDevice();
            const received: unknown[] = [];
            const listener = (e: unknown) => received.push(e);

            device.addEventListener('uncapturederror', listener);
            device.dispatchEvent({ type: 'uncapturederror' });

            expect(received).toHaveLength(1);
        });

        it('removeEventListener prevents further dispatches', () => {
            const device = new MockGPUDevice();
            const received: unknown[] = [];
            const listener = (e: unknown) => received.push(e);

            device.addEventListener('uncapturederror', listener);
            device.removeEventListener('uncapturederror', listener);
            device.dispatchEvent({ type: 'uncapturederror' });

            expect(received).toHaveLength(0);
        });
    });

    // ── Shader Module ──

    describe('MockGPUShaderModule', () => {
        it('getCompilationInfo returns a promise with empty messages', async () => {
            const device = new MockGPUDevice();
            const sm = device.createShaderModule({ code: '@vertex fn main() {}' });
            const info = await sm.getCompilationInfo();
            expect(info.messages).toEqual([]);
        });
    });

    // ── Pipeline getBindGroupLayout ──

    describe('pipeline getBindGroupLayout', () => {
        it('render pipeline returns MockGPUBindGroupLayout', () => {
            const device = new MockGPUDevice();
            const rp = device.createRenderPipeline({});
            const bgl = rp.getBindGroupLayout(0);
            expect(bgl.label).toBe('auto-bgl-0');
        });

        it('compute pipeline returns MockGPUBindGroupLayout', () => {
            const device = new MockGPUDevice();
            const cp = device.createComputePipeline({});
            const bgl = cp.getBindGroupLayout(1);
            expect(bgl.label).toBe('auto-bgl-1');
        });
    });

    // ── Queue ──

    describe('MockGPUQueue', () => {
        it('onSubmittedWorkDone returns a Promise', async () => {
            const device = new MockGPUDevice();
            await device.queue.onSubmittedWorkDone();
            expect(device.queue.__calls[0].method).toBe('onSubmittedWorkDone');
        });

        it('writeBuffer tracks call', () => {
            const device = new MockGPUDevice();
            const buf = device.createBuffer({ size: 64, usage: 0x48 });
            const data = new Float32Array([1, 2, 3, 4]);
            device.queue.writeBuffer(buf, 0, data);
            expect(device.queue.__calls[0].method).toBe('writeBuffer');
            expect(device.queue.__calls[0].args[0]).toBe(buf);
        });
    });

    // ── Adapter Info ──

    describe('MockGPUAdapter', () => {
        it('has info property', async () => {
            const { gpu } = createMockWebGPU();
            const adapter = await gpu.requestAdapter();
            expect(adapter!.info.vendor).toBe('mock-vendor');
            expect(adapter!.info.backend).toBe('mock');
        });

        it('requestAdapterInfo returns a Promise', async () => {
            const { gpu } = createMockWebGPU();
            const adapter = await gpu.requestAdapter();
            const info = await adapter!.requestAdapterInfo();
            expect(info.vendor).toBe('mock-vendor');
        });
    });

    // ── Mock IDs ──

    describe('mock IDs', () => {
        it('IDs are unique across objects', () => {
            const device = new MockGPUDevice();
            const buf1 = device.createBuffer({ size: 64, usage: 1 });
            const buf2 = device.createBuffer({ size: 64, usage: 1 });
            expect(buf1.__mockId).not.toBe(buf2.__mockId);
        });

        it('resetMockIds resets counter', () => {
            const d1 = new MockGPUDevice();
            resetMockIds();
            const d2 = new MockGPUDevice();
            // After reset, both get id device_1 (same counter)
            expect(d1.__mockId).toBe(d2.__mockId);
        });
    });
});
