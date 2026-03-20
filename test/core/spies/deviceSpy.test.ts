import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeviceSpy } from '@core/spies/deviceSpy';
import { RecorderManager } from '@core/recorders';
import {
    createMockWebGPU,
    resetMockIds,
    MockGPUDevice,
    MockGPUAdapter,
} from '../../mocks';

describe('DeviceSpy', () => {
    let recorderManager: RecorderManager;
    let device: MockGPUDevice;
    let adapter: MockGPUAdapter;
    let deviceSpy: DeviceSpy;
    let commandLog: { methodName: string; args: unknown[]; result: unknown }[];
    let mockResult: ReturnType<typeof createMockWebGPU>;

    beforeEach(async () => {
        resetMockIds();
        mockResult = createMockWebGPU();
        mockResult.installGlobal();

        recorderManager = new RecorderManager();
        commandLog = [];

        adapter = (await mockResult.gpu.requestAdapter()) as unknown as MockGPUAdapter;
        device = (await adapter.requestDevice()) as unknown as MockGPUDevice;

        deviceSpy = new DeviceSpy(recorderManager, {
            onCommand(methodName, args, result) {
                commandLog.push({ methodName, args, result });
            },
        });
    });

    afterEach(() => {
        deviceSpy.dispose();
        recorderManager.reset();
        mockResult.removeGlobal();
    });

    it('spyOnDevice patches create* methods', () => {
        const originalCreateBuffer = device.createBuffer;

        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        expect(device.createBuffer).not.toBe(originalCreateBuffer);
    });

    it('spyOnDevice fires onDeviceCreated', () => {
        const received: GPUDevice[] = [];
        deviceSpy.onDeviceCreated.add((d) => received.push(d));

        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        expect(received).toHaveLength(1);
        expect(received[0]).toBe(device);
    });

    it('createBuffer triggers recorder and onCommand callback', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const descriptor = { size: 256, usage: 0x40, label: 'test-buf' };
        const buffer = device.createBuffer(descriptor);

        // Recorder should have tracked it
        const id = recorderManager.getId(buffer);
        expect(id).toBeDefined();
        expect(id!.startsWith('buf_')).toBe(true);

        // onCommand callback should have fired
        expect(commandLog).toHaveLength(1);
        expect(commandLog[0].methodName).toBe('createBuffer');
        expect(commandLog[0].result).toBe(buffer);
    });

    it('createTexture triggers recorder and patches createView on the result', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const texDescriptor = {
            label: 'test-tex',
            size: { width: 512, height: 512 },
            format: 'rgba8unorm',
            usage: 0x10,
        };
        const texture = device.createTexture(texDescriptor);

        // Texture should be recorded
        const texId = recorderManager.getId(texture);
        expect(texId).toBeDefined();
        expect(texId!.startsWith('tex_')).toBe(true);

        // createView should be patched on the texture instance
        // The instance method should differ from the prototype
        // (instance method is patched)
        const view = texture.createView({ label: 'test-view' });
        const viewId = recorderManager.getId(view);
        expect(viewId).toBeDefined();
        expect(viewId!.startsWith('tv_')).toBe(true);
    });

    it('createShaderModule captures WGSL code via recorder', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const wgslCode = '@vertex fn main() -> @builtin(position) vec4f { return vec4f(0); }';
        const descriptor = { code: wgslCode, label: 'test-shader' };
        const module = device.createShaderModule(descriptor);

        const id = recorderManager.getId(module);
        expect(id).toBeDefined();
        expect(id!.startsWith('shd_')).toBe(true);

        // Verify it was recorded in onCommand
        const shaderCmd = commandLog.find((c) => c.methodName === 'createShaderModule');
        expect(shaderCmd).toBeDefined();
        expect(shaderCmd!.result).toBe(module);
    });

    it('createRenderPipeline records pipeline info', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const shaderModule = device.createShaderModule({ code: '' });
        const descriptor = {
            label: 'test-pipeline',
            layout: 'auto',
            vertex: { module: shaderModule, entryPoint: 'main' },
        };
        const pipeline = device.createRenderPipeline(descriptor);

        const id = recorderManager.getId(pipeline);
        expect(id).toBeDefined();
        expect(id!.startsWith('rp_')).toBe(true);

        const pipelineCmd = commandLog.find((c) => c.methodName === 'createRenderPipeline');
        expect(pipelineCmd).toBeDefined();
    });

    it('createBindGroup records bind group entries', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const layout = device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: 0x1, buffer: { type: 'uniform' } }],
        });
        const buffer = device.createBuffer({ size: 64, usage: 0x40 });
        const descriptor = {
            label: 'test-bg',
            layout,
            entries: [{ binding: 0, resource: { buffer } }],
        };
        const bindGroup = device.createBindGroup(descriptor);

        const id = recorderManager.getId(bindGroup);
        expect(id).toBeDefined();
        expect(id!.startsWith('bg_')).toBe(true);

        const bgCmd = commandLog.find((c) => c.methodName === 'createBindGroup');
        expect(bgCmd).toBeDefined();
    });

    it('device.lost triggers onDeviceLost', async () => {
        const lostEvents: { device: GPUDevice; reason: string }[] = [];
        deviceSpy.onDeviceLost.add((e) => lostEvents.push(e));

        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        // Simulate device loss
        device.simulateLost('unknown');

        // Wait for the promise to resolve
        await new Promise<void>((r) => setTimeout(r, 0));

        expect(lostEvents).toHaveLength(1);
        expect(lostEvents[0].device).toBe(device);
        expect(lostEvents[0].reason).toBe('unknown');
    });

    it('double spyOnDevice is idempotent', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);
        const patchedCreateBuffer = device.createBuffer;

        deviceSpy.spyOnDevice(device as unknown as GPUDevice);
        // Same patched method — not double-wrapped
        expect(device.createBuffer).toBe(patchedCreateBuffer);
    });

    it('createSampler records sampler info', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const sampler = device.createSampler({ label: 'test-sampler' });

        const id = recorderManager.getId(sampler);
        expect(id).toBeDefined();
        expect(id!.startsWith('smp_')).toBe(true);
    });

    it('createComputePipeline records pipeline info', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const shaderModule = device.createShaderModule({ code: '' });
        const pipeline = device.createComputePipeline({
            label: 'test-compute',
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });

        const id = recorderManager.getId(pipeline);
        expect(id).toBeDefined();
        expect(id!.startsWith('cp_')).toBe(true);
    });

    it('createRenderPipelineAsync records pipeline info', async () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const shaderModule = device.createShaderModule({ code: '' });
        const pipeline = await device.createRenderPipelineAsync({
            label: 'async-pipeline',
            layout: 'auto',
            vertex: { module: shaderModule, entryPoint: 'main' },
        });

        const id = recorderManager.getId(pipeline);
        expect(id).toBeDefined();
        expect(id!.startsWith('rp_')).toBe(true);
    });

    it('createComputePipelineAsync records pipeline info', async () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const shaderModule = device.createShaderModule({ code: '' });
        const pipeline = await device.createComputePipelineAsync({
            label: 'async-compute',
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });

        const id = recorderManager.getId(pipeline);
        expect(id).toBeDefined();
        expect(id!.startsWith('cp_')).toBe(true);
    });

    it('error scope methods are patched and logged', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        device.pushErrorScope('validation');

        const pushCmd = commandLog.find((c) => c.methodName === 'pushErrorScope');
        expect(pushCmd).toBeDefined();
    });

    it('destroy is patched and logged', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        device.destroy();

        const destroyCmd = commandLog.find((c) => c.methodName === 'destroy');
        expect(destroyCmd).toBeDefined();
    });

    it('spyOnAdapter patches requestDevice and auto-spies the device', async () => {
        const freshAdapter = (await mockResult.gpu.requestAdapter()) as unknown as MockGPUAdapter;

        const received: GPUDevice[] = [];
        deviceSpy.onDeviceCreated.add((d) => received.push(d));

        deviceSpy.spyOnAdapter(freshAdapter as unknown as GPUAdapter);

        const newDevice = await freshAdapter.requestDevice();

        expect(received).toHaveLength(1);
        expect(received[0]).toBe(newDevice);
    });

    it('createBindGroupLayout records layout info', () => {
        deviceSpy.spyOnDevice(device as unknown as GPUDevice);

        const layout = device.createBindGroupLayout({
            label: 'test-bgl',
            entries: [
                { binding: 0, visibility: 0x1, buffer: { type: 'uniform' } },
            ],
        });

        const id = recorderManager.getId(layout);
        expect(id).toBeDefined();
        expect(id!.startsWith('bgl_')).toBe(true);
    });

    // ── Prototype-level patching tests ──────────────────────────────

    describe('installPrototypeSpy', () => {
        let savedGPUAdapter: unknown;

        beforeEach(() => {
            // Expose MockGPUAdapter as the global GPUAdapter so
            // _getAdapterPrototype() can find it.
            savedGPUAdapter = (globalThis as any).GPUAdapter;
            (globalThis as any).GPUAdapter = MockGPUAdapter;
        });

        afterEach(() => {
            if (savedGPUAdapter === undefined) {
                delete (globalThis as any).GPUAdapter;
            } else {
                (globalThis as any).GPUAdapter = savedGPUAdapter;
            }
        });

        it('patches GPUAdapter.prototype.requestDevice', async () => {
            const originalRD = MockGPUAdapter.prototype.requestDevice;

            deviceSpy.installPrototypeSpy();

            expect(MockGPUAdapter.prototype.requestDevice).not.toBe(originalRD);

            // Clean up
            deviceSpy.dispose();
            expect(MockGPUAdapter.prototype.requestDevice).toBe(originalRD);
        });

        it('intercepts requestDevice on any adapter instance', async () => {
            const received: GPUDevice[] = [];
            deviceSpy.onDeviceCreated.add((d) => received.push(d));

            deviceSpy.installPrototypeSpy();

            // Create a fresh adapter AFTER installing prototype spy
            const freshAdapter = new MockGPUAdapter();
            const newDevice = await freshAdapter.requestDevice();

            expect(received).toHaveLength(1);
            expect(received[0]).toBe(newDevice);
        });

        it('intercepts requestDevice on adapter obtained BEFORE install', async () => {
            // Obtain adapter BEFORE installing spy
            const earlyAdapter = new MockGPUAdapter();

            const received: GPUDevice[] = [];
            deviceSpy.onDeviceCreated.add((d) => received.push(d));

            // Now install prototype spy
            deviceSpy.installPrototypeSpy();

            // Call requestDevice on the early adapter — should still be intercepted
            const device = await earlyAdapter.requestDevice();

            expect(received).toHaveLength(1);
            expect(received[0]).toBe(device);
        });

        it('double installPrototypeSpy is idempotent', () => {
            deviceSpy.installPrototypeSpy();
            const patched = MockGPUAdapter.prototype.requestDevice;

            deviceSpy.installPrototypeSpy();
            expect(MockGPUAdapter.prototype.requestDevice).toBe(patched);
        });

        it('dispose restores GPUAdapter.prototype.requestDevice', () => {
            const original = MockGPUAdapter.prototype.requestDevice;

            deviceSpy.installPrototypeSpy();
            expect(MockGPUAdapter.prototype.requestDevice).not.toBe(original);

            deviceSpy.dispose();
            expect(MockGPUAdapter.prototype.requestDevice).toBe(original);
        });

        it('no-op when GPUAdapter is not available', () => {
            // Remove global GPUAdapter
            delete (globalThis as any).GPUAdapter;

            // Should not throw
            expect(() => deviceSpy.installPrototypeSpy()).not.toThrow();
        });
    });
});
