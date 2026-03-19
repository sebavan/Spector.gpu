/**
 * E2E: Real WebGPU site capture — validates iframe injection and
 * late-detection of already-active WebGPU devices.
 *
 * This test loads https://webgpu.github.io/webgpu-samples/ which renders
 * WebGPU content inside an <iframe>. It verifies:
 *   1. Content script injects into the sample iframe (all_frames: true).
 *   2. WebGPU is detected even when adapter/device were created before
 *      the content script ran (late-detection via prototype spy).
 *   3. Frame capture produces valid stats (≥1 draw call, ≥1 render pass).
 *
 * Requires internet access — skipped if the site is unreachable.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension } from './helpers';

// Longer timeout — network-dependent test loading a real site.
test.setTimeout(90_000);

let context: BrowserContext;

test.describe('Real WebGPU Site Capture', () => {
    test.beforeAll(async () => {
        context = await launchWithExtension();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test('captures frame on webgpu-samples helloTriangle', async () => {
        const page: Page = await context.newPage();

        try {
            await page.goto(
                'https://webgpu.github.io/webgpu-samples/?sample=helloTriangle',
                { waitUntil: 'networkidle', timeout: 30_000 },
            );
        } catch {
            test.skip(true, 'Could not reach webgpu-samples site (no internet?)');
            return;
        }

        // Wait for the sample to load and render in the iframe.
        await page.waitForTimeout(5_000);

        // The sample site loads content in an iframe whose URL contains '/sample/'.
        const sampleFrame = page.frames().find((f) => f.url().includes('/sample/'));
        expect(sampleFrame, 'Sample iframe not found — page structure may have changed').toBeDefined();

        // SpectorGPU should be active in the iframe (injected via all_frames: true
        // or via addInitScript which propagates to frames).
        const spectorActive = await sampleFrame!.evaluate(() => {
            return !!(window as any).__spectorGpuInstance;
        });
        expect(spectorActive, 'SpectorGPU not injected into sample iframe').toBe(true);

        // Allow time for late-detection prototype spy to trigger on the
        // next createCommandEncoder / frame cycle.
        await page.waitForTimeout(2_000);

        // WebGPU should be detected — adapterInfo should be non-null.
        // Even late-detected devices produce synthetic adapter info.
        const detected = await sampleFrame!.evaluate(() => {
            const s = (window as any).__spectorGpuInstance;
            return s?.adapterInfo != null;
        });
        expect(detected, 'WebGPU not detected — late-detection may have failed').toBe(true);

        // Trigger a capture and wait for completion.
        const stats = await sampleFrame!.evaluate(() => {
            return new Promise<Record<string, number>>((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(new Error('Capture timed out after 10s')),
                    10_000,
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
                        totalCommands: capture.stats.totalCommands,
                        pipelineCount: capture.stats.pipelineCount,
                        shaderModuleCount: capture.stats.shaderModuleCount,
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

        // helloTriangle: 1 render pass, 1 draw call, at least 1 pipeline + 1 shader.
        expect(stats.drawCalls).toBeGreaterThanOrEqual(1);
        expect(stats.renderPasses).toBeGreaterThanOrEqual(1);
        expect(stats.totalCommands).toBeGreaterThan(1);
        expect(stats.pipelineCount).toBeGreaterThanOrEqual(1);
        expect(stats.shaderModuleCount).toBeGreaterThanOrEqual(1);

        console.log('Real site capture stats:', JSON.stringify(stats));

        await page.close();
    });
});
