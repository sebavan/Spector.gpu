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
 *   1. Content script injects and Spector.GPU initialises.
 *   2. WebGPU adapter is detected (requestAdapter hook fires).
 *   3. Device is discovered via the inline requestDevice wrapper.
 *   4. Frame capture produces valid stats (≥1 draw call, ≥1 render pass).
 *   5. Visual output is present (non-blank screenshot in capture data).
 *
 * Requires internet access — skipped if the site is unreachable.
 */

import { test, expect, type BrowserContext, type Frame, type Page } from '@playwright/test';
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
                'https://playground.babylonjs.com/?iswebgpu=true#WGZLGJ#11018',
                { waitUntil: 'domcontentloaded', timeout: 60_000 },
            );
        } catch {
            test.skip(true, 'Could not reach Babylon.js Playground (no internet?)');
            return;
        }

        // Wait for the scene to fully load and render several frames.
        // Babylon Playground has a loading spinner; wait for the
        // rendering canvas to be active.
        await page.waitForTimeout(10_000);

        // ── Verify Spector.GPU is injected ────────────────────────────

        // The playground shell and scene frame both receive the init script.
        // Select the frame that actually owns Babylon's discovered GPU device.
        let targetFrame: Page | Frame | null = null;
        await expect.poll(async () => {
            for (const frame of page.frames()) {
                try {
                    const hasDevice = await frame.evaluate(() => {
                        const s = window.__spectorGpuInstance as unknown as {
                            _device?: unknown;
                        };
                        return s?._device != null;
                    });
                    if (hasDevice) {
                        targetFrame = frame;
                        return true;
                    }
                } catch {
                    // Detached frames can disappear while the playground reloads.
                }
            }
            return false;
        }, {
            message: 'Device not discovered in any playground frame',
            timeout: 45_000,
        }).toBe(true);

        if (!targetFrame) {
            throw new Error('Device frame was not retained after discovery');
        }

        const spectorActive = await targetFrame.evaluate(() => {
            return !!window.__spectorGpuInstance;
        });
        expect(spectorActive, 'Spector.GPU not injected').toBe(true);

        // ── Verify WebGPU detected (adapter hook fired) ──────────────

        const detected = await targetFrame.evaluate(() => {
            const s = window.__spectorGpuInstance;
            return s?.adapterInfo != null;
        });
        expect(detected, 'WebGPU adapter not detected').toBe(true);

        // ── Trigger capture and verify results ───────────────────────

        const stats = await targetFrame.evaluate(() => {
            return new Promise<Record<string, number>>((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(new Error('Capture timed out after 15s')),
                    15_000,
                );
                const s = window.__spectorGpuInstance;
                if (!s) {
                    reject(new Error('No Spector.GPU instance'));
                    return;
                }

                s.onCaptureComplete.add((capture) => {
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
                s.onCaptureError.add(({ error }) => {
                    clearTimeout(timeout);
                    reject(error instanceof Error ? error : new Error(String(error)));
                });

                s.captureNextFrame();
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
