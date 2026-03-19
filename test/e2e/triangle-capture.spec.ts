/**
 * E2E: Triangle capture — primary happy-path test.
 *
 * Verifies:
 *  1. Extension loads and injects content script on a WebGPU page.
 *  2. WebGPU triangle renders (page title signals READY).
 *  3. Frame capture produces a valid CaptureResult with correct stats.
 *  4. Canvas remains visible after capture (non-destructive).
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

test.describe('WebGPU Triangle Capture', () => {
    test.beforeAll(async () => {
        context = await launchWithExtension();
        page = await context.newPage();
        await page.goto(fixtureUrl('triangle.html'));
        await waitForPageReady(page, /^READY_\d+/);
    });

    test.afterAll(async () => {
        await context?.close();
    });

    // ── Detection ────────────────────────────────────────────────────

    test('extension loads and WebGPU page reaches READY state', async () => {
        const title = await page.title();
        expect(title).toMatch(/^READY_\d+$/);

        // Canvas should exist and be visible
        await expect(page.locator('#canvas')).toBeVisible();
    });

    test('service worker is running after page load', async () => {
        const workers = context.serviceWorkers();
        expect(workers.length).toBeGreaterThan(0);
        // The service worker URL is within the extension origin
        expect(workers[0].url()).toMatch(/^chrome-extension:\/\//);
    });

    // ── Capture ──────────────────────────────────────────────────────

    test('captures a frame with valid stats', async () => {
        // Let a few frames render so capture has stable data
        await page.waitForTimeout(500);

        const result: CaptureResult = await captureFrame(page);

        // Structural assertions
        expect(result).toBeDefined();
        expect(result.captureId).toBeTruthy();
        expect(result.stats).toBeDefined();

        // A single triangle frame should have:
        //   >= 1 draw call   (draw(3))
        //   >= 1 render pass (beginRenderPass)
        //   >= 1 pipeline    (createRenderPipeline)
        //   >= 1 shader      (createShaderModule)
        //   > 1 total cmds   (setPipeline + draw + end + submit ...)
        expect(result.stats.drawCalls).toBeGreaterThanOrEqual(1);
        expect(result.stats.renderPasses).toBeGreaterThanOrEqual(1);
        expect(result.stats.pipelineCount).toBeGreaterThanOrEqual(1);
        expect(result.stats.shaderModuleCount).toBeGreaterThanOrEqual(1);
        expect(result.stats.totalCommands).toBeGreaterThan(1);

        // Compute stats should be zero for a render-only scene
        expect(result.stats.computePasses).toBe(0);
        expect(result.stats.dispatchCalls).toBe(0);
    });

    // ── Non-destructive ──────────────────────────────────────────────

    test('page keeps rendering after capture', async () => {
        const countBefore = await page.evaluate(
            () => (window as any).__webgpuFrameCount ?? 0,
        );
        await page.waitForTimeout(500);
        const countAfter = await page.evaluate(
            () => (window as any).__webgpuFrameCount ?? 0,
        );

        // Render loop must have advanced
        expect(countAfter).toBeGreaterThan(countBefore);
    });
});
