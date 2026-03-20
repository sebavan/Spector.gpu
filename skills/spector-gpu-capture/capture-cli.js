#!/usr/bin/env node

/**
 * Spector.GPU Capture CLI
 *
 * A command-line tool for AI agents to capture and introspect WebGPU frames.
 * Injects the Spector.GPU content script into a page via Playwright,
 * captures a frame, and outputs structured JSON for analysis.
 *
 * Usage:
 *   npx spector-gpu-capture <url> [options]
 *
 * Options:
 *   --output, -o <file>     Write capture JSON to file (default: stdout)
 *   --screenshot, -s <file> Save a screenshot of the page
 *   --wait, -w <ms>         Wait time before capture (default: 5000)
 *   --timeout, -t <ms>      Capture timeout (default: 30000)
 *   --summary               Output a summary instead of full capture JSON
 *   --textures              Include texture preview data URLs
 *   --buffers               Include buffer base64 data
 *   --headed                Run in headed mode (visible browser)
 *   --help, -h              Show help
 *
 * Examples:
 *   # Capture a frame and get summary
 *   npx spector-gpu-capture https://playground.babylonjs.com/?iswebgpu=true --summary
 *
 *   # Full capture to file
 *   npx spector-gpu-capture https://myapp.com --output capture.json
 *
 *   # Screenshot + summary
 *   npx spector-gpu-capture https://myapp.com --summary --screenshot page.png
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ── CLI argument parsing ─────────────────────────────────────────────

function parseArgs(argv) {
    const args = {
        url: null,
        output: null,
        screenshot: null,
        wait: 5000,
        timeout: 30000,
        summary: false,
        textures: false,
        buffers: false,
        headed: false,
        help: false,
    };

    let i = 2; // skip node and script path
    while (i < argv.length) {
        const arg = argv[i];
        switch (arg) {
            case '--help': case '-h':
                args.help = true; break;
            case '--output': case '-o':
                args.output = argv[++i]; break;
            case '--screenshot': case '-s':
                args.screenshot = argv[++i]; break;
            case '--wait': case '-w':
                args.wait = parseInt(argv[++i], 10); break;
            case '--timeout': case '-t':
                args.timeout = parseInt(argv[++i], 10); break;
            case '--summary':
                args.summary = true; break;
            case '--textures':
                args.textures = true; break;
            case '--buffers':
                args.buffers = true; break;
            case '--headed':
                args.headed = true; break;
            default:
                if (!arg.startsWith('-') && !args.url) {
                    args.url = arg;
                } else {
                    console.error(`Unknown argument: ${arg}`);
                    process.exit(1);
                }
        }
        i++;
    }
    return args;
}

function showHelp() {
    console.log(`
Spector.GPU Capture CLI — WebGPU frame introspection for AI agents

Usage:
  npx spector-gpu-capture <url> [options]

Options:
  --output, -o <file>     Write capture JSON to file (default: stdout)
  --screenshot, -s <file> Save page screenshot
  --wait, -w <ms>         Wait before capture (default: 5000)
  --timeout, -t <ms>      Capture timeout (default: 30000)
  --summary               Output summary instead of full JSON
  --textures              Include texture preview data URLs in output
  --buffers               Include buffer base64 data in output
  --headed                Show browser window
  --help, -h              Show this help

Examples:
  npx spector-gpu-capture https://playground.babylonjs.com/?iswebgpu=true --summary
  npx spector-gpu-capture https://myapp.com -o capture.json -s screenshot.png
`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv);

    if (args.help || !args.url) {
        showHelp();
        process.exit(args.help ? 0 : 1);
    }

    // Resolve the content script path (built extension)
    const contentScriptPath = path.resolve(__dirname, '..', '..', 'dist', 'contentScript.js');
    if (!fs.existsSync(contentScriptPath)) {
        console.error(`Content script not found at ${contentScriptPath}`);
        console.error('Run "npm run build" in the Spector.GPU root first.');
        process.exit(1);
    }

    const browser = await chromium.launch({
        headless: !args.headed,
        args: ['--enable-features=Vulkan,UseSkiaRenderer'],
    });

    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        // Inject content script before page loads (mirrors document_start)
        await page.addInitScript({ path: contentScriptPath });

        // Navigate
        console.error(`[Spector.GPU CLI] Navigating to ${args.url}...`);
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: args.timeout });
        await page.waitForTimeout(args.wait);

        // Take screenshot if requested
        if (args.screenshot) {
            await page.screenshot({ path: args.screenshot, type: 'png' });
            console.error(`[Spector.GPU CLI] Screenshot saved: ${args.screenshot}`);
        }

        // Check if SpectorGPU is loaded
        const hasSpector = await page.evaluate(() => !!window.__spectorGpuInstance);
        if (!hasSpector) {
            console.error('[Spector.GPU CLI] SpectorGPU not detected on page');
            process.exit(1);
        }

        // Check if WebGPU was detected
        const adapterInfo = await page.evaluate(() => window.__spectorGpuInstance?.adapterInfo);
        if (!adapterInfo) {
            console.error('[Spector.GPU CLI] No WebGPU adapter detected');
            process.exit(1);
        }
        console.error(`[Spector.GPU CLI] WebGPU detected: ${adapterInfo.vendor} ${adapterInfo.architecture}`);

        // Capture a frame
        console.error('[Spector.GPU CLI] Capturing frame...');
        const includeTextures = args.textures;
        const includeBuffers = args.buffers;

        const captureResult = await page.evaluate(({ includeTextures, includeBuffers, timeout }) => {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Capture timeout')), timeout);

                const s = window.__spectorGpuInstance;
                s.onCaptureComplete.add((capture) => {
                    clearTimeout(timer);

                    // Convert Maps to plain objects for JSON serialization
                    function mapsToObjects(obj) {
                        if (obj instanceof Map) {
                            const result = {};
                            for (const [k, v] of obj) result[k] = mapsToObjects(v);
                            return result;
                        }
                        if (Array.isArray(obj)) return obj.map(mapsToObjects);
                        if (obj && typeof obj === 'object') {
                            const result = {};
                            for (const k of Object.keys(obj)) result[k] = mapsToObjects(obj[k]);
                            return result;
                        }
                        return obj;
                    }

                    const serialized = mapsToObjects(capture);

                    // Strip large data if not requested
                    if (!includeTextures && serialized.resources?.textures) {
                        for (const tex of Object.values(serialized.resources.textures)) {
                            delete tex.previewDataUrl;
                            delete tex.facePreviewUrls;
                        }
                    }
                    if (!includeBuffers && serialized.resources?.buffers) {
                        for (const buf of Object.values(serialized.resources.buffers)) {
                            delete buf.dataBase64;
                        }
                    }

                    resolve(serialized);
                });

                s.onCaptureError.add(({ error }) => {
                    clearTimeout(timer);
                    reject(new Error(error?.message || String(error)));
                });

                s.captureNextFrame();
            });
        }, { includeTextures, includeBuffers, timeout: args.timeout });

        console.error(`[Spector.GPU CLI] Capture complete: ${captureResult.stats.totalCommands} commands, ${captureResult.stats.drawCalls} draw calls`);

        // Output
        let output;
        if (args.summary) {
            output = buildSummary(captureResult);
        } else {
            output = JSON.stringify(captureResult, null, 2);
        }

        if (args.output) {
            fs.writeFileSync(args.output, output, 'utf8');
            console.error(`[Spector.GPU CLI] Output written to ${args.output}`);
        } else {
            console.log(output);
        }

    } finally {
        await browser.close();
    }
}

// ── Summary builder ──────────────────────────────────────────────────

function buildSummary(capture) {
    const { stats, adapterInfo, resources, commands } = capture;

    const textures = resources.textures ? Object.values(resources.textures) : [];
    const buffers = resources.buffers ? Object.values(resources.buffers) : [];
    const shaders = resources.shaderModules ? Object.values(resources.shaderModules) : [];
    const renderPipelines = resources.renderPipelines ? Object.values(resources.renderPipelines) : [];
    const computePipelines = resources.computePipelines ? Object.values(resources.computePipelines) : [];

    // Decode buffer usage flags
    function decodeBufferUsage(usage) {
        const flags = [];
        if (usage & 0x0001) flags.push('MAP_READ');
        if (usage & 0x0002) flags.push('MAP_WRITE');
        if (usage & 0x0004) flags.push('COPY_SRC');
        if (usage & 0x0008) flags.push('COPY_DST');
        if (usage & 0x0010) flags.push('INDEX');
        if (usage & 0x0020) flags.push('VERTEX');
        if (usage & 0x0040) flags.push('UNIFORM');
        if (usage & 0x0080) flags.push('STORAGE');
        if (usage & 0x0100) flags.push('INDIRECT');
        return flags.join('|');
    }

    function decodeTextureUsage(usage) {
        const flags = [];
        if (usage & 0x01) flags.push('COPY_SRC');
        if (usage & 0x02) flags.push('COPY_DST');
        if (usage & 0x04) flags.push('TEXTURE_BINDING');
        if (usage & 0x08) flags.push('STORAGE_BINDING');
        if (usage & 0x10) flags.push('RENDER_ATTACHMENT');
        return flags.join('|');
    }

    function formatBytes(n) {
        if (n < 1024) return `${n}B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
        return `${(n / 1024 / 1024).toFixed(1)}MB`;
    }

    // Build command tree outline
    function outlineCommands(nodes, depth = 0) {
        const lines = [];
        for (const node of nodes) {
            const indent = '  '.repeat(depth);
            const childInfo = node.children?.length ? ` (${node.children.length} children)` : '';
            lines.push(`${indent}[${node.type}] ${node.name}${childInfo}`);
            if (node.children?.length && depth < 3) {
                lines.push(...outlineCommands(node.children, depth + 1));
            }
        }
        return lines;
    }

    const summary = {
        adapter: {
            vendor: adapterInfo.vendor,
            architecture: adapterInfo.architecture,
            description: adapterInfo.description,
        },
        stats,
        duration: `${capture.duration?.toFixed(1)}ms`,
        commandTree: outlineCommands(commands),
        textures: textures.map(t => ({
            id: t.id,
            label: t.label,
            format: t.format,
            size: `${t.size?.width}×${t.size?.height}${(t.size?.depthOrArrayLayers || 1) > 1 ? `×${t.size.depthOrArrayLayers}` : ''}`,
            usage: decodeTextureUsage(t.usage || 0),
            hasPreview: !!t.previewDataUrl,
            isCube: (t.size?.depthOrArrayLayers || 1) === 6,
        })),
        buffers: buffers.map(b => ({
            id: b.id,
            label: b.label,
            size: formatBytes(b.size),
            usage: decodeBufferUsage(b.usage || 0),
            hasData: !!b.dataBase64,
        })),
        shaderModules: shaders.map(s => ({
            id: s.id,
            label: s.label,
            lines: s.code?.split('\n').length || 0,
        })),
        pipelines: {
            render: renderPipelines.map(p => ({ id: p.id, label: p.label })),
            compute: computePipelines.map(p => ({ id: p.id, label: p.label })),
        },
    };

    return JSON.stringify(summary, null, 2);
}

main().catch(err => {
    console.error(`[Spector.GPU CLI] Fatal: ${err.message}`);
    process.exit(1);
});
