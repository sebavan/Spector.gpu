import { defineConfig } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for Spector.GPU E2E tests.
 *
 * Key constraints:
 *  - WebGPU requires headed mode (no headless GPU context in most CI).
 *  - Real Chrome (channel: 'chrome') has better WebGPU support than stock Chromium.
 *  - Extension loading requires launchPersistentContext (handled in helpers.ts).
 *  - Fixture pages are served via a local HTTP server so content scripts
 *    match the http host patterns in manifest.json.
 */
export default defineConfig({
    testDir: './test/e2e',
    testMatch: '**/*.spec.ts',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    retries: 1,
    workers: 1,  // Serial — each test suite launches its own browser with the extension
    reporter: [['list'], ['html', { open: 'never' }]],

    // Local static server for fixture HTML pages
    webServer: {
        command: 'node test/e2e/fixtures/server.mjs',
        port: 8765,
        reuseExistingServer: !process.env.CI,
        timeout: 10_000,
    },

    // We don't define projects/use here because extension loading requires
    // chromium.launchPersistentContext (not the built-in browser launch).
    // The helpers.ts file handles the actual browser launch.
});
