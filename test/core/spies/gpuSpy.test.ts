import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GpuSpy } from '@core/spies/gpuSpy';
import { createMockWebGPU, resetMockIds, type MockGPU } from '../../mocks';
import type { IAdapterInfo } from '@shared/types';

describe('GpuSpy', () => {
    let spy: GpuSpy;
    let mockResult: ReturnType<typeof createMockWebGPU>;

    beforeEach(() => {
        resetMockIds();
        mockResult = createMockWebGPU();
        mockResult.installGlobal();
        spy = new GpuSpy();
    });

    afterEach(() => {
        spy.dispose();
        mockResult.removeGlobal();
    });

    it('install patches navigator.gpu.requestAdapter via prototype', () => {
        const proto = Object.getPrototypeOf(navigator.gpu);
        const originalRequestAdapter = proto.requestAdapter;

        spy.install();

        // The prototype method should have been replaced
        expect(proto.requestAdapter).not.toBe(originalRequestAdapter);
        // Instance lookup resolves through prototype
        expect(navigator.gpu.requestAdapter).not.toBe(originalRequestAdapter);
        expect(spy.isInstalled).toBe(true);
    });

    it('calling requestAdapter triggers onAdapterCreated with adapter and info', async () => {
        spy.install();

        const received: { adapter: GPUAdapter; info: IAdapterInfo }[] = [];
        spy.onAdapterCreated.add((data) => received.push(data));

        const adapter = await navigator.gpu.requestAdapter();

        expect(received).toHaveLength(1);
        expect(received[0].adapter).toBe(adapter);
        expect(received[0].info).toEqual({
            vendor: 'mock-vendor',
            architecture: 'mock-arch',
            device: 'mock-device',
            description: 'Mock WebGPU Adapter',
            backend: 'mock',
        });
    });

    it('requestAdapter returning null does not trigger event', async () => {
        // Override requestAdapter on the prototype (not the instance)
        // so our spy wrapper properly wraps the null-returning method.
        const proto = Object.getPrototypeOf(navigator.gpu);
        const realOriginal = proto.requestAdapter;
        proto.requestAdapter = function () {
            return Promise.resolve(null);
        };

        spy.install();

        const received: unknown[] = [];
        spy.onAdapterCreated.add((data) => received.push(data));

        const adapter = await navigator.gpu.requestAdapter();

        expect(adapter).toBeNull();
        expect(received).toHaveLength(0);

        // Dispose restores the null-returning fn; put the real one back.
        spy.dispose();
        proto.requestAdapter = realOriginal;
    });

    it('dispose restores original prototype method', () => {
        const proto = Object.getPrototypeOf(navigator.gpu);
        const originalRequestAdapter = proto.requestAdapter;

        spy.install();
        expect(proto.requestAdapter).not.toBe(originalRequestAdapter);

        spy.dispose();
        expect(proto.requestAdapter).toBe(originalRequestAdapter);
        expect(spy.isInstalled).toBe(false);
    });

    it('double install is idempotent', () => {
        spy.install();
        const proto = Object.getPrototypeOf(navigator.gpu);
        const patchedMethod = proto.requestAdapter;

        spy.install(); // second call
        // Should be the same patched method — not double-wrapped
        expect(proto.requestAdapter).toBe(patchedMethod);
        expect(spy.isInstalled).toBe(true);
    });

    it('WebGPU not available: install logs warning and returns', () => {
        // Remove WebGPU
        mockResult.removeGlobal();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        spy.install();

        expect(spy.isInstalled).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[Spector.GPU]',
            'WebGPU not available',
        );

        warnSpy.mockRestore();
        // Re-install for cleanup
        mockResult.installGlobal();
    });

    it('dispose is safe to call when not installed', () => {
        // Should not throw
        expect(() => spy.dispose()).not.toThrow();
    });

    it('dispose clears all listeners', async () => {
        spy.install();

        const received: unknown[] = [];
        spy.onAdapterCreated.add((data) => received.push(data));

        spy.dispose();

        // Re-install mock and re-install spy
        mockResult.installGlobal();
        // The listener should have been cleared, even though we could
        // re-request an adapter
        expect(spy.onAdapterCreated.hasListeners).toBe(false);
    });

    // ── Inline requestDevice wrapping ────────────────────────────────

    it('requestAdapter wraps requestDevice on the returned adapter', async () => {
        spy.install();

        const adapter = await navigator.gpu.requestAdapter();
        expect(adapter).not.toBeNull();

        // The adapter's requestDevice should be wrapped (not the original).
        // Calling it should fire onDeviceCreated.
        const received: GPUDevice[] = [];
        spy.onDeviceCreated.add((device) => received.push(device));

        const device = await adapter!.requestDevice();

        expect(received).toHaveLength(1);
        expect(received[0]).toBe(device);
    });

    it('onDeviceCreated fires before caller sees the device', async () => {
        spy.install();

        const order: string[] = [];

        spy.onDeviceCreated.add(() => {
            order.push('onDeviceCreated');
        });

        const adapter = await navigator.gpu.requestAdapter();
        const devicePromise = adapter!.requestDevice();

        // The onDeviceCreated fires inside the .then() chain,
        // so by the time our await resolves, it has already fired.
        const device = await devicePromise;
        order.push('caller_got_device');

        expect(order).toEqual(['onDeviceCreated', 'caller_got_device']);
        expect(device).toBeDefined();
    });

    it('requestAdapter returning null does not wrap requestDevice', async () => {
        const proto = Object.getPrototypeOf(navigator.gpu);
        const realOriginal = proto.requestAdapter;
        proto.requestAdapter = function () {
            return Promise.resolve(null);
        };

        spy.install();

        const received: GPUDevice[] = [];
        spy.onDeviceCreated.add((device) => received.push(device));

        const adapter = await navigator.gpu.requestAdapter();

        expect(adapter).toBeNull();
        expect(received).toHaveLength(0);

        spy.dispose();
        proto.requestAdapter = realOriginal;
    });

    it('dispose clears onDeviceCreated listeners', async () => {
        spy.install();

        spy.onDeviceCreated.add(() => {});
        expect(spy.onDeviceCreated.hasListeners).toBe(true);

        spy.dispose();
        expect(spy.onDeviceCreated.hasListeners).toBe(false);
    });

    it('multiple adapters each get requestDevice wrapped independently', async () => {
        spy.install();

        const devices: GPUDevice[] = [];
        spy.onDeviceCreated.add((device) => devices.push(device));

        const adapter1 = await navigator.gpu.requestAdapter();
        const adapter2 = await navigator.gpu.requestAdapter();

        const device1 = await adapter1!.requestDevice();
        const device2 = await adapter2!.requestDevice();

        expect(devices).toHaveLength(2);
        expect(devices[0]).toBe(device1);
        expect(devices[1]).toBe(device2);
        // Devices should be distinct instances
        expect(device1).not.toBe(device2);
    });
});
