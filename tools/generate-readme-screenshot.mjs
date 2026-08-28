/**
 * Generate the README result-viewer screenshot from the local triangle fixture.
 * Run `npm run build` first so the extension bundles exist in dist/.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'dist');
const fixtureUrl = 'http://localhost:8765/triangle.html';
const outputPath = path.join(root, 'docs', 'images', 'result-view.png');

async function waitForFixtureServer() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(fixtureUrl);
            if (response.ok) return;
        } catch {
            // The child process may still be starting.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Fixture server did not start at ${fixtureUrl}`);
}

const server = spawn(
    process.execPath,
    [path.join(root, 'test', 'e2e', 'fixtures', 'server.mjs')],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
);

let context;
try {
    await waitForFixtureServer();

    context = await chromium.launchPersistentContext('', {
        headless: false,
        channel: 'chrome',
        args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan',
            '--disable-vulkan-surface',
            '--disable-gpu-sandbox',
            '--no-first-run',
            '--no-default-browser-check',
        ],
        viewport: { width: 1440, height: 900 },
    });

    const contentScript = await readFile(
        path.join(extensionPath, 'contentScript.js'),
        'utf8',
    );
    await context.addInitScript(contentScript);

    const targetPage = await context.newPage();
    await targetPage.goto(fixtureUrl);
    await targetPage.waitForFunction(() => /^READY_\d+$/.test(document.title));
    await targetPage.waitForTimeout(500);

    const result = await targetPage.evaluate(() => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Capture timed out')),
                15_000,
            );
            let captureData = null;

            function onMessage(event) {
                const message = event.data;
                if (message?.type === 'SPECTOR_GPU_CAPTURE_DATA') {
                    captureData = message.payload.data;
                }
                if (message?.type === 'SPECTOR_GPU_CAPTURE_COMPLETE') {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    resolve({
                        captureId: message.payload.captureId,
                        captureData,
                    });
                }
                if (message?.type === 'SPECTOR_GPU_CAPTURE_ERROR') {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    reject(new Error(message.payload?.message ?? 'Capture failed'));
                }
            }

            window.addEventListener('message', onMessage);
            window.postMessage(
                { type: 'SPECTOR_GPU_START_CAPTURE', payload: {} },
                '*',
            );
        });
    });

    if (typeof result.captureData !== 'string') {
        throw new Error('Capture data was not serialized');
    }

    await context.addInitScript(
        ({ captureId, captureData }) => {
            const storedCapture = { [captureId]: captureData };
            globalThis.chrome = {
                storage: {
                    local: {
                        get: async key => {
                            if (typeof key !== 'string' || !(key in storedCapture)) {
                                return {};
                            }
                            return { [key]: storedCapture[key] };
                        },
                    },
                },
            };
        },
        result,
    );

    const resultPage = await context.newPage();
    const resultUrl = pathToFileURL(path.join(extensionPath, 'result.html'));
    resultUrl.searchParams.set('captureId', result.captureId);
    await resultPage.goto(resultUrl.href);
    await resultPage.locator('.result-app').waitFor({ timeout: 10_000 });
    await resultPage.locator('.tree-node').first().click();
    await resultPage.waitForTimeout(500);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await resultPage.screenshot({
        path: outputPath,
        type: 'png',
        fullPage: false,
    });
    console.log(`Wrote ${path.relative(root, outputPath)}`);
} finally {
    await context?.close();
    server.kill();
}
