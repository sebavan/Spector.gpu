/**
 * E2E: Multi-pass capture — complex scene test.
 *
 * The multi-pass fixture renders TWO render passes per frame:
 *   Pass 1: clear + red triangle   (pipeline1, shader1, draw(3))
 *   Pass 2: load + green quad      (pipeline2, shader2, draw(6), bindGroup, uniformBuffer)
 *
 * Verifies:
 *  1. Capture detects multiple render passes and pipelines.
 *  2. Bind groups and uniform buffers are tracked.
 *  3. Multiple sequential captures produce independent results.
 *  4. Page continues rendering between and after captures.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
    launchWithExtension,
    fixtureUrl,
    waitForPageReady,
    captureFrame,
    type CaptureResult,
} from './helpers';

let context: BrowserContext;
let page: Page;

test.describe('Multi-Pass Capture', () => {
    test.beforeAll(async () => {
        context = await launchWithExtension();
        page = await context.newPage();
        await page.goto(fixtureUrl('multi-pass.html'));
        await waitForPageReady(page, /^READY_\d+/);
    });

    test.afterAll(async () => {
        await context?.close();
    });

    // ── Complex scene capture ────────────────────────────────────────

    test('captures multiple render passes and pipelines', async () => {
        await page.waitForTimeout(500);

        const result: CaptureResult = await captureFrame(page);

        // Multi-pass scene: 2 passes, 2 pipelines, 2 shaders, 2 draws
        expect(result.stats.renderPasses).toBeGreaterThanOrEqual(2);
        expect(result.stats.drawCalls).toBeGreaterThanOrEqual(2);
        expect(result.stats.pipelineCount).toBeGreaterThanOrEqual(2);
        expect(result.stats.shaderModuleCount).toBeGreaterThanOrEqual(2);

        // Uniform buffer + bind group for the offset
        expect(result.stats.bufferCount).toBeGreaterThanOrEqual(1);
        expect(result.stats.bindGroupCount).toBeGreaterThanOrEqual(1);

        // No compute in this scene
        expect(result.stats.computePasses).toBe(0);
        expect(result.stats.dispatchCalls).toBe(0);
    });

    // ── Non-destructive ──────────────────────────────────────────────

    test('page continues rendering after capture', async () => {
        const countBefore = await page.evaluate(
            () => (window as any).__webgpuFrameCount ?? 0,
        );
        await page.waitForTimeout(500);
        const countAfter = await page.evaluate(
            () => (window as any).__webgpuFrameCount ?? 0,
        );

        expect(countAfter).toBeGreaterThan(countBefore);
    });

    // ── Independent captures ─────────────────────────────────────────

    test('multiple captures produce independent results', async () => {
        const result1: CaptureResult = await captureFrame(page);
        await page.waitForTimeout(300);
        const result2: CaptureResult = await captureFrame(page);

        // Both should have valid, distinct IDs
        expect(result1.captureId).toBeTruthy();
        expect(result2.captureId).toBeTruthy();
        expect(result1.captureId).not.toBe(result2.captureId);

        // Same scene → same stats (deterministic)
        expect(result2.stats.drawCalls).toBe(result1.stats.drawCalls);
        expect(result2.stats.renderPasses).toBe(result1.stats.renderPasses);
        expect(result2.stats.pipelineCount).toBe(result1.stats.pipelineCount);
    });
});
