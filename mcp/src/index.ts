/**
 * MCP server for Spector.GPU — exposes WebGPU capture and inspection
 * tools over the Model Context Protocol.
 *
 * All diagnostic output goes to console.error() because stdout is
 * reserved for the MCP JSON-RPC transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrowserManager } from './browser.js';
import { CaptureManager, RESOURCE_CATEGORIES } from './capture.js';
import { buildSummary } from './summary.js';

// ------------------------------------------------------------------
// AsyncMutex — serializes tool execution to prevent concurrent
// browser/capture operations that would corrupt shared state.
// ------------------------------------------------------------------

/**
 * Simple single-permit async mutex with FIFO ordering and timeout.
 *
 * Invariants:
 *  - At most one holder at a time.
 *  - Waiters are served in FIFO order.
 *  - A release function is idempotent — double-release is a no-op.
 */
class AsyncMutex {
    private _queue: Array<() => void> = [];
    private _locked = false;

    /**
     * Acquire the mutex. Resolves with a release function.
     * @param timeoutMs — Maximum milliseconds to wait (default 60 000).
     * @throws If the timeout expires before the mutex is acquired.
     */
    async acquire(timeoutMs = 60_000): Promise<() => void> {
        if (!this._locked) {
            this._locked = true;
            return this._createRelease();
        }

        return new Promise<() => void>((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this._queue.indexOf(waiter);
                if (idx !== -1) this._queue.splice(idx, 1);
                reject(new Error('Mutex acquire timeout'));
            }, timeoutMs);

            const waiter = (): void => {
                clearTimeout(timer);
                resolve(this._createRelease());
            };

            this._queue.push(waiter);
        });
    }

    private _createRelease(): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this._queue.shift();
            if (next) {
                // Hand lock directly to next waiter — no unlock/relock gap.
                next();
            } else {
                this._locked = false;
            }
        };
    }
}

// ------------------------------------------------------------------
// Pure helper functions (no side effects, no state)
// ------------------------------------------------------------------

/** Truncate a command tree to a maximum nesting depth. */
function truncateCommands(commands: unknown[], depth: number, current = 0): unknown[] {
    return commands.map(cmd => {
        const node = { ...(cmd as Record<string, unknown>) };
        const children = node.children as unknown[] | undefined;
        if (children && children.length > 0) {
            if (current + 1 >= depth) {
                node.children = [{ _truncated: true, childCount: children.length }];
            } else {
                node.children = truncateCommands(children, depth, current + 1);
            }
        }
        return node;
    });
}

/**
 * Strip binary/image bulk data from a resource object.
 * Preserves shader source `code` — only removes base64 blobs and preview URLs.
 */
function stripBulkData(resource: Record<string, unknown>): Record<string, unknown> {
    const stripped = { ...resource };
    delete stripped.dataBase64;
    delete stripped.previewDataUrl;
    delete stripped.facePreviewUrls;
    return stripped;
}

// ------------------------------------------------------------------
// Server factory
// ------------------------------------------------------------------

/**
 * Create an MCP server with all 6 Spector.GPU tools registered.
 *
 * Uses dependency injection: tests supply mock BrowserManager /
 * CaptureManager instances; the real entrypoint wires production ones.
 *
 * @param browserMgr — Manages Playwright browser lifecycle and navigation.
 * @param captureMgr — Executes WebGPU frame captures and queries resources.
 * @returns A configured McpServer ready to connect to a transport.
 */
export function createServer(browserMgr: BrowserManager, captureMgr: CaptureManager): McpServer {
    const server = new McpServer({
        name: 'spector-gpu',
        version: '0.1.0',
    });

    const mutex = new AsyncMutex();

    // --------------------------------------------------------------
    // Tool 1: navigate
    // --------------------------------------------------------------
    server.tool(
        'navigate',
        'Navigate to a URL and detect the WebGPU adapter',
        {
            url: z.string().url(),
            wait: z.number().optional().default(5000),
        },
        async ({ url, wait }) => {
            try {
                const release = await mutex.acquire();
                try {
                    const { adapterInfo } = await browserMgr.ensurePage(url, wait);
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({
                                success: true,
                                url,
                                adapterInfo,
                                message: adapterInfo
                                    ? 'Page loaded with WebGPU adapter detected.'
                                    : 'Page loaded but no WebGPU adapter detected.',
                            }),
                        }],
                    };
                } finally {
                    release();
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );

    // --------------------------------------------------------------
    // Tool 2: capture
    // --------------------------------------------------------------
    server.tool(
        'capture',
        'Capture one WebGPU frame and return a human-readable summary',
        {
            timeout: z.number().optional().default(30000),
        },
        async ({ timeout }) => {
            try {
                const release = await mutex.acquire();
                try {
                    const page = browserMgr.getPage();
                    const capture = await captureMgr.capture(page, timeout);
                    const summary = buildSummary(capture);
                    return {
                        content: [{ type: 'text' as const, text: summary }],
                    };
                } finally {
                    release();
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );

    // --------------------------------------------------------------
    // Tool 3: get_commands
    // --------------------------------------------------------------
    server.tool(
        'get_commands',
        'Get the captured GPU command tree, optionally truncated to a depth',
        {
            depth: z.number().int().min(1).optional().default(10),
        },
        async ({ depth }) => {
            try {
                const release = await mutex.acquire();
                try {
                    const capture = captureMgr.getCapture() as Record<string, unknown>;
                    const commands = capture.commands;
                    if (!Array.isArray(commands)) {
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify([]) }],
                        };
                    }
                    const truncated = truncateCommands(commands, depth);
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify(truncated) }],
                    };
                } finally {
                    release();
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );

    // --------------------------------------------------------------
    // Tool 4: get_resources
    // --------------------------------------------------------------
    server.tool(
        'get_resources',
        'List GPU resources by category, or get an overview of all categories',
        {
            category: z.string().optional(),
        },
        async ({ category }) => {
            try {
                const release = await mutex.acquire();
                try {
                    // Throws with a clear message if no capture exists.
                    captureMgr.getCapture();

                    if (category !== undefined) {
                        // Validate category name
                        if (!(RESOURCE_CATEGORIES as readonly string[]).includes(category)) {
                            return {
                                content: [{
                                    type: 'text' as const,
                                    text: JSON.stringify({
                                        error: `Invalid category '${category}'. ` +
                                            `Valid categories: ${RESOURCE_CATEGORIES.join(', ')}`,
                                    }),
                                }],
                                isError: true,
                            };
                        }

                        const resources = captureMgr.getResourcesByCategory(category);
                        const stripped: Record<string, unknown> = {};
                        if (resources) {
                            for (const [id, resource] of Object.entries(resources)) {
                                stripped[id] = stripBulkData(resource as Record<string, unknown>);
                            }
                        }
                        return {
                            content: [{ type: 'text' as const, text: JSON.stringify(stripped) }],
                        };
                    }

                    // No category: return overview with counts + id/label lists.
                    const counts = captureMgr.getResourceCounts();
                    const overview: Record<string, unknown> = {};
                    for (const cat of RESOURCE_CATEGORIES) {
                        const resources = captureMgr.getResourcesByCategory(cat);
                        const items: Array<{ id: string; label: unknown }> = [];
                        if (resources) {
                            for (const [id, resource] of Object.entries(resources)) {
                                items.push({
                                    id,
                                    label: (resource as Record<string, unknown>).label,
                                });
                            }
                        }
                        overview[cat] = { count: counts[cat], items };
                    }
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify(overview) }],
                    };
                } finally {
                    release();
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );

    // --------------------------------------------------------------
    // Tool 5: get_resource
    // --------------------------------------------------------------
    server.tool(
        'get_resource',
        'Get full details of a specific GPU resource by ID (includes shader code, base64 data)',
        {
            id: z.string(),
        },
        async ({ id }) => {
            try {
                const release = await mutex.acquire();
                try {
                    // Ensure capture exists — throws with actionable message if not.
                    captureMgr.getCapture();

                    const result = captureMgr.findResource(id);
                    if (!result) {
                        return {
                            content: [{
                                type: 'text' as const,
                                text: JSON.stringify({
                                    error: `Resource '${id}' not found. Use 'get_resources' to list available resource IDs.`,
                                }),
                            }],
                            isError: true,
                        };
                    }
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
                    };
                } finally {
                    release();
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );

    // --------------------------------------------------------------
    // Tool 6: screenshot
    // --------------------------------------------------------------
    server.tool(
        'screenshot',
        'Take a PNG screenshot of the current page',
        {},
        async () => {
            try {
                const release = await mutex.acquire();
                try {
                    const data = await browserMgr.screenshot();
                    return {
                        content: [{ type: 'image' as const, data, mimeType: 'image/png' }],
                    };
                } finally {
                    release();
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );

    return server;
}

// ------------------------------------------------------------------
// Entrypoint — wire real instances and connect via stdio transport.
// Guarded so that importing createServer for tests doesn't launch
// the browser or connect stdio.
// ------------------------------------------------------------------
const isDirectRun = process.argv[1] &&
    (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'));

if (isDirectRun) {
    const browserMgr = new BrowserManager();
    const captureMgr = new CaptureManager();
    const server = createServer(browserMgr, captureMgr);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
