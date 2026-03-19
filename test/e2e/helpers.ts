/**
 * E2E test helpers for SpectorGPU.
 *
 * Provides Chrome launch (with extension), fixture URLs, and capture
 * trigger/wait utilities that work with the extension's actual message
 * protocol (SPECTOR_GPU_* prefixed window.postMessage).
 *
 * Content script injection: Chrome's manifest-based content script
 * injection is unreliable under Playwright automation (service worker
 * loads but content scripts don't inject). We work around this by
 * using `context.addInitScript()` to inject the compiled content
 * script bundle into every new page's MAIN world before any page
 * script runs — equivalent to manifest `run_at: document_start`.
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { readFileSync } from 'fs';

// ── Paths ────────────────────────────────────────────────────────────

const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const CONTENT_SCRIPT_PATH = path.resolve(EXTENSION_PATH, 'contentScript.js');
const FIXTURE_PORT = 8765;

// Pre-read the compiled content script bundle (once per worker process).
// This is a self-executing webpack IIFE — safe to inject directly.
const CONTENT_SCRIPT_SOURCE = readFileSync(CONTENT_SCRIPT_PATH, 'utf-8');

// ── Browser launch ───────────────────────────────────────────────────

/**
 * Launch Chrome with the SpectorGPU extension loaded.
 *
 * Uses launchPersistentContext because Chrome extension loading
 * requires --load-extension, which is only available with a persistent
 * (i.e. user-data-dir-backed) context.
 *
 * Because Chrome's manifest-based content script injection doesn't work
 * reliably under Playwright automation, we inject the compiled content
 * script via `context.addInitScript()`. This runs in every new page's
 * MAIN world before any page script — equivalent to the manifest's
 * `run_at: document_start, world: MAIN` configuration.
 *
 * Callers MUST call context.close() when done.
 */
export async function launchWithExtension(): Promise<BrowserContext> {
    const context = await chromium.launchPersistentContext('', {
        headless: false,
        channel: 'chrome',
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan',
            '--disable-vulkan-surface',
            '--disable-gpu-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
        ],
        viewport: { width: 800, height: 600 },
        // Keep the background-pages extension flag (MV3 service workers need it)
        // Also remove --disable-extensions which suppresses content script injection
        ignoreDefaultArgs: [
            '--disable-component-extensions-with-background-pages',
            '--disable-extensions',
        ],
    });

    // Give the service worker time to initialise.
    if (context.serviceWorkers().length === 0) {
        await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }

    // Inject the compiled content script into every new page's MAIN world.
    // This replaces Chrome's manifest-based injection which is unreliable
    // under Playwright automation.
    await context.addInitScript(CONTENT_SCRIPT_SOURCE);

    return context;
}

// ── Fixture URLs ─────────────────────────────────────────────────────

/**
 * Return the HTTP URL for a fixture file served by the local static
 * server.  Content scripts match http host patterns so they will inject.
 */
export function fixtureUrl(name: string): string {
    return `http://localhost:${FIXTURE_PORT}/${name}`;
}

// ── Page readiness ───────────────────────────────────────────────────

/**
 * Wait until the page title matches `pattern`.
 *
 * Our fixture pages set `document.title` to signal state:
 *   READY_<n>    — frame loop running (triangle / multi-pass)
 *   COMPUTE_DONE — compute work finished
 *   NO_WEBGPU    — navigator.gpu unavailable
 *   ERROR_*      — fatal error
 */
export async function waitForPageReady(
    page: Page,
    titlePattern: RegExp,
    timeout = 15_000,
): Promise<void> {
    await page.waitForFunction(
        (src: string) => new RegExp(src).test(document.title),
        titlePattern.source,
        { timeout },
    );
}

// ── Capture utilities ────────────────────────────────────────────────

/**
 * Post a START_CAPTURE message on the window, mimicking the path:
 *   popup -> background -> ISOLATED proxy -> window.postMessage
 *
 * The MAIN-world content script listens for `SPECTOR_GPU_START_CAPTURE`.
 */
export async function triggerCapture(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.postMessage(
            { type: 'SPECTOR_GPU_START_CAPTURE', payload: {} },
            '*',
        );
    });
}

/**
 * Arm a one-shot listener for `SPECTOR_GPU_CAPTURE_COMPLETE`, trigger
 * the capture, and return the payload `{ captureId, stats }`.
 *
 * The listener is registered BEFORE the trigger — both happen inside
 * a single `page.evaluate()` call to eliminate any race window.
 *
 * On error the `SPECTOR_GPU_CAPTURE_ERROR` message rejects the promise.
 */
export async function captureFrame(
    page: Page,
    timeout = 15_000,
): Promise<CaptureResult> {
    // Single evaluate call: install listener -> trigger -> await result.
    // page.evaluate() auto-awaits the returned Promise.
    return page.evaluate((ms: number) => {
        return new Promise<any>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Capture timed out')),
                ms,
            );

            function onMessage(event: MessageEvent): void {
                const d = event.data;
                if (!d || typeof d.type !== 'string') return;

                if (d.type === 'SPECTOR_GPU_CAPTURE_COMPLETE') {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    resolve(d.payload);
                }

                if (d.type === 'SPECTOR_GPU_CAPTURE_ERROR') {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    reject(new Error(d.payload?.message ?? 'Capture error'));
                }
            }

            window.addEventListener('message', onMessage);

            // Trigger capture AFTER listener is installed (same microtask)
            window.postMessage(
                { type: 'SPECTOR_GPU_START_CAPTURE', payload: {} },
                '*',
            );
        });
    }, timeout);
}

// ── Types ────────────────────────────────────────────────────────────

/** Shape of the CAPTURE_COMPLETE payload posted by the content script. */
export interface CaptureResult {
    captureId: string;
    stats: CaptureStats;
}

export interface CaptureStats {
    totalCommands: number;
    drawCalls: number;
    dispatchCalls: number;
    renderPasses: number;
    computePasses: number;
    pipelineCount: number;
    bufferCount: number;
    textureCount: number;
    shaderModuleCount: number;
    bindGroupCount: number;
}
