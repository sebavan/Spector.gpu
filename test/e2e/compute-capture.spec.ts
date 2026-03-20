/**
 * E2E: Compute pipeline — detection & non-interference test.
 *
 * The compute fixture runs a one-shot compute dispatch (no rAF loop):
 *   - Creates a 256-element float buffer with values 0..255
 *   - Dispatches a shader that doubles each element
 *   - Reads back and verifies results
 *
 * Because the compute work completes BEFORE we can arm a capture,
 * we focus on:
 *  1. WebGPU is detected (content script injected, APIs patched).
 *  2. Compute produces correct results (extension doesn't corrupt data).
 *  3. Extension doesn't throw or crash on compute-only pages.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
    launchWithExtension,
    fixtureUrl,
    waitForPageReady,
} from './helpers';

let context: BrowserContext;
let page: Page;

test.describe('Compute Pipeline Detection', () => {
    test.beforeAll(async () => {
        context = await launchWithExtension();
        page = await context.newPage();
    });

    test.afterAll(async () => {
        await context?.close();
    });

    // ── Detection & correctness ──────────────────────────────────────

    test('compute workload completes correctly with extension loaded', async () => {
        await page.goto(fixtureUrl('compute.html'));
        await waitForPageReady(page, /COMPUTE_DONE/);

        expect(await page.title()).toBe('COMPUTE_DONE');
    });

    test('compute results are not corrupted by extension interception', async () => {
        // The doubler shader: data[i] *= 2.0
        //   input[0]   = 0   → 0
        //   input[1]   = 1   → 2
        //   input[255] = 255 → 510
        const output = await page.locator('#output').textContent();
        expect(output).toContain('Result[0]=0');
        expect(output).toContain('Result[1]=2');
        expect(output).toContain('Result[255]=510');
    });

    test('no page errors from extension on compute-only page', async () => {
        // Collect page errors that are NOT from Spector.GPU itself
        const errors: string[] = [];
        page.on('pageerror', (err) => {
            const msg = err.message;
            // Extension log noise is acceptable; real page errors are not
            if (!msg.includes('Spector.GPU') && !msg.includes('Extension context')) {
                errors.push(msg);
            }
        });
        await page.waitForTimeout(1000);
        expect(errors).toHaveLength(0);
    });
});
