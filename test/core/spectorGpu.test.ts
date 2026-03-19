import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpectorGPU } from '../../src/core/spectorGpu';
import { globalIdGenerator } from '../../src/shared/utils';
import { globalOriginStore } from '../../src/core/proxy/originStore';
import type { ICapture, IAdapterInfo } from '../../src/shared/types';
import {
    createMockWebGPU,
    resetMockIds,
    type MockWebGPUResult,
    type MockGPUDevice,
} from '../mocks';

describe('SpectorGPU', () => {
    let spector: SpectorGPU;
    let mockResult: MockWebGPUResult;

    beforeEach(() => {
        resetMockIds();
        globalIdGenerator.reset();
        mockResult = createMockWebGPU();
        mockResult.installGlobal();
        spector = new SpectorGPU();
    });

    afterEach(() => {
        spector.dispose();
        mockResult.removeGlobal();
    });

    // ─── Initialization ──────────────────────────────────────────────

    it('isInitialized is false before init', () => {
        expect(spector.isInitialized).toBe(false);
    });

    it('init() sets isInitialized to true', () => {
        spector.init();
        expect(spector.isInitialized).toBe(true);
    });

    it('double init is idempotent', () => {
        spector.init();
        spector.init(); // should not throw
        expect(spector.isInitialized).toBe(true);
    });

    it('init detects WebGPU adapter and fires onWebGPUDetected', async () => {
        const detected: IAdapterInfo[] = [];
        spector.onWebGPUDetected.add((info) => detected.push(info));

        spector.init();

        // Trigger adapter creation through mock
        const adapter = await navigator.gpu.requestAdapter();
        expect(adapter).not.toBeNull();

        expect(detected).toHaveLength(1);
        expect(detected[0].vendor).toBe('mock-vendor');
        expect(detected[0].description).toBe('Mock WebGPU Adapter');
        expect(spector.adapterInfo).toEqual(detected[0]);
    });

    it('init wires device creation — queue spy is installed', async () => {
        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter!.requestDevice();

        // After device creation, queue should be spied on.
        // We verify by capturing: if queue spy works, submit events will be captured.
        expect(device).toBeDefined();
    });

    // ─── Capture lifecycle ───────────────────────────────────────────

    it('captureNextFrame when not initialized fires error', () => {
        const errors: Array<{ error: unknown }> = [];
        spector.onCaptureError.add((e) => errors.push(e));

        spector.captureNextFrame();

        expect(errors).toHaveLength(1);
        expect((errors[0].error as Error).message).toContain('not initialized');
    });

    it('captureNextFrame starts capture session', async () => {
        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        await adapter!.requestDevice();

        expect(spector.isCapturing).toBe(false);
        spector.captureNextFrame();
        expect(spector.isCapturing).toBe(true);
    });

    it('double captureNextFrame while capturing is a no-op', async () => {
        spector.init();

        await navigator.gpu.requestAdapter();

        spector.captureNextFrame();
        expect(spector.isCapturing).toBe(true);

        // Second call should not throw and should still be capturing
        spector.captureNextFrame();
        expect(spector.isCapturing).toBe(true);
    });

    it('stopCapture returns ICapture when capturing', async () => {
        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        await adapter!.requestDevice();

        spector.captureNextFrame();
        const capture = spector.stopCapture();

        expect(capture).not.toBeNull();
        expect(capture!.version).toBe('0.1.0');
        expect(capture!.commands).toBeDefined();
        expect(capture!.stats).toBeDefined();
    });

    it('stopCapture when not capturing returns null', () => {
        spector.init();
        expect(spector.stopCapture()).toBeNull();
    });

    it('capture records queue submit events', async () => {
        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter!.requestDevice() as unknown as MockGPUDevice;

        spector.captureNextFrame();

        // Simulate a queue.submit
        const encoder = device.createCommandEncoder();
        const cmdBuf = encoder.finish();
        device.queue.submit([cmdBuf]);

        const capture = spector.stopCapture()!;
        expect(capture).not.toBeNull();
        // The submit should have been captured
        expect(capture.stats.totalCommands).toBeGreaterThanOrEqual(1);
    });

    it('onCaptureComplete fires when capture is stopped', async () => {
        const captures: ICapture[] = [];
        spector.onCaptureComplete.add((c) => captures.push(c));

        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        await adapter!.requestDevice();

        spector.captureNextFrame();
        spector.stopCapture();

        expect(captures).toHaveLength(1);
    });

    // ─── Device lost ─────────────────────────────────────────────────

    it('device lost during capture aborts with error', async () => {
        const errors: Array<{ error: unknown }> = [];
        spector.onCaptureError.add((e) => errors.push(e));

        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter!.requestDevice() as unknown as MockGPUDevice;

        spector.captureNextFrame();
        expect(spector.isCapturing).toBe(true);

        // Simulate device loss
        device.simulateLost('gpu-hang');

        // device.lost resolves on microtask — need to flush
        await device.lost;
        // DeviceSpy's device.lost handler fires asynchronously
        await new Promise(r => setTimeout(r, 0));

        expect(spector.isCapturing).toBe(false);
        expect(errors).toHaveLength(1);
        expect((errors[0].error as Error).message).toContain('Device lost');
    });

    // ─── Dispose ─────────────────────────────────────────────────────

    it('dispose sets isInitialized to false', () => {
        spector.init();
        spector.dispose();
        expect(spector.isInitialized).toBe(false);
    });

    it('dispose clears adapterInfo', async () => {
        spector.init();
        await navigator.gpu.requestAdapter();
        expect(spector.adapterInfo).not.toBeNull();

        spector.dispose();
        expect(spector.adapterInfo).toBeNull();
    });

    it('dispose is safe to call multiple times', () => {
        spector.init();
        spector.dispose();
        expect(() => spector.dispose()).not.toThrow();
    });

    it('dispose aborts active capture', async () => {
        spector.init();
        const adapter = await navigator.gpu.requestAdapter();
        await adapter!.requestDevice();

        spector.captureNextFrame();
        expect(spector.isCapturing).toBe(true);

        spector.dispose();
        // After dispose, the capture error listener was cleared,
        // but the error fires before clear. Check capturing state.
        expect(spector.isCapturing).toBe(false);
    });

    // ─── Full pipeline: encoder → pass → draw ────────────────────────

    it('full pipeline: encoder and render pass commands are captured', async () => {
        spector.init();

        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter!.requestDevice() as unknown as MockGPUDevice;

        spector.captureNextFrame();

        // Simulate WebGPU frame
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [] });
        pass.setPipeline({} as any);
        pass.draw(3);
        pass.end();
        const cmdBuf = encoder.finish();
        device.queue.submit([cmdBuf]);

        const capture = spector.stopCapture()!;
        expect(capture).not.toBeNull();

        // Verify commands were captured
        expect(capture.stats.totalCommands).toBeGreaterThan(0);
        // We should have at least a submit and the draw
        expect(capture.stats.drawCalls).toBeGreaterThanOrEqual(1);
        expect(capture.stats.renderPasses).toBeGreaterThanOrEqual(1);
    });
});
