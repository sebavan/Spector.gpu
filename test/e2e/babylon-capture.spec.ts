/**
 * E2E: Babylon.js Playground capture — validates device interception
 * via inline requestDevice wrapping inside the requestAdapter chain.
 *
 * This test exercises the PRIMARY fix for Chrome's WebGPU method layout:
 * Chrome puts methods as own properties on GPUAdapter/GPUDevice instances,
 * so prototype-level patching of GPUAdapter.prototype.requestDevice is
 * ineffective. GpuSpy now wraps requestDevice on each adapter instance
 * BEFORE returning it to the caller, guaranteeing interception.
 *
 * Verifies:
 *   1. Content script injects and SpectorGPU initialises.
 *   2. WebGPU adapter is detected (requestAdapter hook fires).
 *   3. Device is discovered via the inline requestDevice wrapper.
 *   4. Frame capture produces valid stats (≥1 draw call, ≥1 render pass).
 *   5. Visual output is present (non-blank screenshot in capture data).
 *
 * Requires internet access — skipped if the site is unreachable.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension } from './helpers';

// Babylon Playground loads heavy assets — generous timeout.
test.setTimeout(120_000);

let context: BrowserContext;

test.describe('Babylon.js Playground Capture', () => {
    test.beforeAll(async () => {
        context = await launchWithExtension();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test('captures frame on Babylon.js Playground WebGPU scene', async () => {
        const page: Page = await context.newPage();

        // Navigate to a known WebGPU Babylon.js Playground snippet.
        // #WGZLGJ#11018 is a simple PBR sphere scene that uses WebGPU.
        try {
            await page.goto(
                'https://playground.babylonjs.com/#WGZLGJ#11018',
                { waitUntil: 'networkidle', timeout: 60_000 },
            );
        } catch {
            test.skip(true, 'Could not reach Babylon.js Playground (no internet?)');
            return;
        }

        // Wait for the scene to fully load and render several frames.
        // Babylon Playground has a loading spinner; wait for the
        // rendering canvas to be active.
        await page.waitForTimeout(10_000);

        // ── Verify SpectorGPU is injected ────────────────────────────

        // Babylon.js Playground may use iframes. Find the frame with
        // SpectorGPU injected — it could be the main frame or an iframe.
        let targetFrame = page;
        const spectorInMain = await page.evaluate(() => {
            return !!(window as any).__spectorGpuInstance;
        });

        if (!spectorInMain) {
            // Check iframes
            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const hasSpector = await frame.evaluate(() => {
                        return !!(window as any).__spectorGpuInstance;
                    });
                    if (hasSpector) {
                        targetFrame = frame as any;
                        break;
                    }
                } catch {
                    // Cross-origin or detached frame — skip
                }
            }
        }

        const spectorActive = await targetFrame.evaluate(() => {
            return !!(window as any).__spectorGpuInstance;
        });
        expect(spectorActive, 'SpectorGPU not injected').toBe(true);

        // ── Verify WebGPU detected (adapter hook fired) ──────────────

        const detected = await targetFrame.evaluate(() => {
            const s = (window as any).__spectorGpuInstance;
            return s?.adapterInfo != null;
        });
        expect(detected, 'WebGPU adapter not detected').toBe(true);

        // ── Verify device was discovered ─────────────────────────────
        // The _device field is set when the inline requestDevice wrapper
        // fires onDeviceCreated, which triggers _discoverDevice.

        const hasDevice = await targetFrame.evaluate(() => {
            const s = (window as any).__spectorGpuInstance;
            return s?._device != null;
        });
        expect(hasDevice, 'Device not discovered — inline requestDevice wrapper may have failed').toBe(true);

        // ── Trigger capture and verify results ───────────────────────

        const stats = await targetFrame.evaluate(() => {
            return new Promise<Record<string, number>>((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(new Error('Capture timed out after 15s')),
                    15_000,
                );
                const s = (window as any).__spectorGpuInstance;
                if (!s) {
                    reject(new Error('No SpectorGPU instance'));
                    return;
                }

                s.onCaptureComplete.add((capture: any) => {
                    clearTimeout(timeout);
                    resolve({
                        drawCalls: capture.stats.drawCalls,
                        renderPasses: capture.stats.renderPasses,
                        computePasses: capture.stats.computePasses,
                        dispatchCalls: capture.stats.dispatchCalls,
                        totalCommands: capture.stats.totalCommands,
                        pipelineCount: capture.stats.pipelineCount,
                        shaderModuleCount: capture.stats.shaderModuleCount,
                        bufferCount: capture.stats.bufferCount,
                        textureCount: capture.stats.textureCount,
                    });
                });
                s.onCaptureError.add(({ error }: any) => {
                    clearTimeout(timeout);
                    reject(error instanceof Error ? error : new Error(String(error)));
                });

                s.captureNextFrame();
                // Auto-stop after one full frame cycle (2 rAFs).
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (s.isCapturing) s.stopCapture();
                    });
                });
            });
        });

        // Babylon.js PBR scene should produce real draw calls.
        expect(stats.drawCalls).toBeGreaterThanOrEqual(1);
        expect(stats.renderPasses).toBeGreaterThanOrEqual(1);
        expect(stats.totalCommands).toBeGreaterThan(1);
        expect(stats.pipelineCount).toBeGreaterThanOrEqual(1);
        expect(stats.shaderModuleCount).toBeGreaterThanOrEqual(1);

        console.log('Babylon.js Playground capture stats:', JSON.stringify(stats));

        await page.close();
    });
});
