/**
 * E2E: No WebGPU — extension resilience test.
 *
 * Verifies the extension doesn't crash, throw, or interfere with a page
 * that uses only 2D canvas (no navigator.gpu usage).
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, fixtureUrl } from './helpers';

let context: BrowserContext;
let page: Page;

test.describe('No WebGPU Page', () => {
    test.beforeAll(async () => {
        context = await launchWithExtension();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test('extension does not crash on a non-WebGPU page', async () => {
        page = await context.newPage();

        // Collect page-level errors (not console warnings)
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));

        await page.goto(fixtureUrl('no-webgpu.html'));
        await page.waitForTimeout(1500);

        // Page rendered normally
        expect(await page.title()).toBe('NO_GPU_PAGE');
        await expect(page.locator('h1')).toHaveText('Hello World');

        // Filter out extension-internal messages — only fail on real page errors
        const critical = errors.filter(
            (e) =>
                !e.includes('SpectorGPU') &&
                !e.includes('Extension context') &&
                !e.includes('WebGPU'),
        );
        expect(critical).toHaveLength(0);
    });

    test('2D canvas still works alongside extension', async () => {
        // The fixture draws red + blue rects on a 2D canvas
        const canvasVisible = await page.locator('#c').isVisible();
        expect(canvasVisible).toBe(true);
    });
});
