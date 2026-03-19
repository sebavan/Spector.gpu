import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GpuSpy } from '@core/spies/gpuSpy';
import { globalOriginStore } from '@core/proxy/originStore';
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
        // Ensure origin store is clean
        if (navigator.gpu) {
            globalOriginStore.restoreAll(navigator.gpu);
        }
    });

    it('install patches navigator.gpu.requestAdapter', () => {
        const originalRequestAdapter = navigator.gpu.requestAdapter;

        spy.install();

        // The method should have been replaced
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
        // Override requestAdapter to return null
        const gpu = navigator.gpu as unknown as MockGPU;
        const origRA = gpu.requestAdapter.bind(gpu);
        (gpu as any).requestAdapter = () => Promise.resolve(null);

        spy.install();

        const received: unknown[] = [];
        spy.onAdapterCreated.add((data) => received.push(data));

        const adapter = await navigator.gpu.requestAdapter();

        expect(adapter).toBeNull();
        expect(received).toHaveLength(0);

        // Restore so cleanup works
        (gpu as any).requestAdapter = origRA;
    });

    it('dispose restores original methods', () => {
        const originalRequestAdapter = navigator.gpu.requestAdapter;

        spy.install();
        expect(navigator.gpu.requestAdapter).not.toBe(originalRequestAdapter);

        spy.dispose();
        expect(navigator.gpu.requestAdapter).toBe(originalRequestAdapter);
        expect(spy.isInstalled).toBe(false);
    });

    it('double install is idempotent', () => {
        spy.install();
        const patchedMethod = navigator.gpu.requestAdapter;

        spy.install(); // second call
        // Should be the same patched method — not double-wrapped
        expect(navigator.gpu.requestAdapter).toBe(patchedMethod);
        expect(spy.isInstalled).toBe(true);
    });

    it('WebGPU not available: install logs warning and returns', () => {
        // Remove WebGPU
        mockResult.removeGlobal();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        spy.install();

        expect(spy.isInstalled).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[SpectorGPU]',
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
});
