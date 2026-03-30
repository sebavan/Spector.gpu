/**
 * BrowserManager — manages a single Playwright Chromium instance with lazy
 * initialization. The browser is launched on the first `ensurePage()` call
 * and reused for subsequent navigations.
 *
 * All diagnostic output goes to `console.error()` because stdout is reserved
 * for the MCP JSON-RPC transport.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Protocols that must be rejected for security reasons. */
const BLOCKED_PROTOCOLS = new Set(['file:', 'javascript:', 'data:']);

export class BrowserManager {
    private readonly _contentScriptPath: string;
    private _browser: Browser | null = null;
    private _context: BrowserContext | null = null;
    private _page: Page | null = null;

    /**
     * @param contentScriptPath — Absolute path to the Spector.GPU content
     *   script that will be injected into every page via `addInitScript`.
     *   Defaults to `../../dist/contentScript.js` relative to the compiled
     *   output (i.e. `spector-gpu/dist/contentScript.js`).
     */
    constructor(contentScriptPath?: string) {
        this._contentScriptPath = contentScriptPath
            ?? resolve(__dirname, '../../dist/contentScript.js');

        // Best-effort cleanup on process signals. We intentionally avoid
        // process.exit() — just close the browser and let the runtime decide.
        const shutdown = (): void => {
            void this.close();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }

    /**
     * Navigate to `url`, lazily launching the browser on the first call.
     *
     * On the first invocation the content script is verified, Chromium is
     * launched headless with GPU flags, and the content script is injected
     * via `context.addInitScript`. Subsequent calls reuse the existing
     * browser/context/page and simply navigate to the new URL.
     *
     * @param url — The HTTP(S) URL to navigate to.
     * @param waitMs — Milliseconds to wait after `domcontentloaded` before
     *   probing for the WebGPU adapter. Defaults to 5 000.
     * @returns An object containing the adapter info reported by the content
     *   script, or `null` if no adapter was detected.
     * @throws If the content script is missing, the URL uses a blocked
     *   protocol, or navigation fails.
     */
    async ensurePage(
        url: string,
        waitMs: number = 5_000,
    ): Promise<{ adapterInfo: object | null }> {
        this._validateUrl(url);

        if (!this._browser) {
            // --- First call: full bootstrap ---
            if (!existsSync(this._contentScriptPath)) {
                throw new Error(
                    `Content script not found at ${this._contentScriptPath}. ` +
                    `Run 'npm run build' in the Spector.GPU root first.`,
                );
            }

            // WebGPU requires a real GPU — headless Chromium's software
            // renderer doesn't expose a capable enough adapter for most
            // engines (e.g. Babylon.js falls back to WebGL2). We launch
            // headed Chrome so the system GPU is available for WebGPU.
            console.error('[BrowserManager] Launching Chrome (headed for WebGPU)…');
            this._browser = await chromium.launch({
                headless: false,
                channel: 'chrome',
                args: [
                    '--enable-unsafe-webgpu',
                    '--enable-features=Vulkan,UseSkiaRenderer',
                    '--ignore-gpu-blocklist',
                ],
            });

            this._context = await this._browser.newContext();
            await this._context.addInitScript({ path: this._contentScriptPath });

            this._page = await this._context.newPage();
        }

        // _page is guaranteed non-null after the block above.
        const page = this._page!;

        console.error(`[BrowserManager] Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(waitMs);

        const adapterInfo: object | null = await page.evaluate(
            // Runs in browser context where globalThis === window.
            // We use globalThis to avoid needing DOM lib types in this Node package.
            () => (globalThis as any).__spectorGpuInstance?.adapterInfo ?? null,
        );

        return { adapterInfo };
    }

    /**
     * Return the current Playwright `Page`.
     *
     * @throws If no page has been opened yet via `ensurePage()`.
     */
    getPage(): Page {
        if (!this._page) {
            throw new Error("No page open. Use the 'navigate' tool first.");
        }
        return this._page;
    }

    /**
     * Capture a full-page screenshot and return it as a base64-encoded PNG.
     *
     * @throws If no page has been opened yet via `ensurePage()`.
     */
    async screenshot(): Promise<string> {
        const page = this.getPage(); // throws if null
        const buffer = await page.screenshot({ type: 'png' });
        return buffer.toString('base64');
    }

    /**
     * Close the browser and release all resources. Idempotent — safe to call
     * multiple times or when no browser is running.
     */
    async close(): Promise<void> {
        if (this._browser) {
            console.error('[BrowserManager] Closing browser.');
            await this._browser.close();
            this._browser = null;
            this._context = null;
            this._page = null;
        }
    }

    // ------------------------------------------------------------------
    // Private helpers
    // ------------------------------------------------------------------

    /**
     * Reject URLs with dangerous or unsupported protocols.
     * Only `http:` and `https:` are allowed.
     */
    private _validateUrl(url: string): void {
        let protocol: string;
        try {
            protocol = new URL(url).protocol;
        } catch {
            throw new Error(
                `Invalid URL: '${url}'. Provide a fully-qualified http:// or https:// URL.`,
            );
        }

        if (BLOCKED_PROTOCOLS.has(protocol)) {
            throw new Error(
                `URL protocol '${protocol}' is not allowed. Use http:// or https://.`,
            );
        }
    }
}
