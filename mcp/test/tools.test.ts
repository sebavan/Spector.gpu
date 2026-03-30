/**
 * MCP Tools Integration Tests
 *
 * Tests all 6 tools end-to-end via InMemoryTransport:
 *   navigate, capture, get_commands, get_resources, get_resource, screenshot
 *
 * Uses a real CaptureManager + mock BrowserManager to exercise the full
 * MCP request→handler→response pipeline without launching a real browser.
 *
 * RULES:
 *  - Every test creates a FRESH server + client pair. Zero shared mutable state.
 *  - The fixture is NEVER mutated. Tests that need bulk data create copies.
 *  - Every assertion exists for a reason. If it can't fail, it shouldn't be here.
 */

import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';
import type { BrowserManager } from '../src/browser.js';
import { CaptureManager } from '../src/capture.js';
import type { Page } from 'playwright';
import sampleCapture from './fixtures/sample-capture.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Playwright Page whose evaluate() resolves with `data`. */
function mockPage(data: object): Page {
    return { evaluate: vi.fn().mockResolvedValue(data) } as unknown as Page;
}

/** Convenience type for mock BrowserManager with vi.fn() accessors. */
type MockBrowserMgr = {
    ensurePage: ReturnType<typeof vi.fn>;
    getPage: ReturnType<typeof vi.fn>;
    screenshot: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
};

interface TestSetup {
    client: Client;
    mockBrowserMgr: MockBrowserMgr;
    captureMgr: CaptureManager;
}

/**
 * Create a fresh MCP server ↔ client pair for a single test.
 *
 * Each call produces an isolated server, client, and CaptureManager.
 * No state bleeds between tests.
 *
 * @param preloadCapture If provided, the CaptureManager is pre-loaded
 *   with this data so query tools work without calling `capture` first.
 */
async function createTestSetup(preloadCapture?: object): Promise<TestSetup> {
    const mockBrowserMgr: MockBrowserMgr = {
        ensurePage: vi.fn(),
        getPage: vi.fn(),
        screenshot: vi.fn(),
        close: vi.fn(),
    };

    const captureMgr = new CaptureManager();

    if (preloadCapture) {
        await captureMgr.capture(mockPage(preloadCapture));
    }

    const server = createServer(
        mockBrowserMgr as unknown as BrowserManager,
        captureMgr,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    return { client, mockBrowserMgr, captureMgr };
}

/**
 * Parse JSON from the first text content block in an MCP tool response.
 * Fails loudly if the response doesn't contain parsable text.
 */
function parseText(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    const item = result.content[0];
    expect(item.type).toBe('text');
    return JSON.parse((item as { type: 'text'; text: string }).text);
}

/**
 * Create a deep copy of sampleCapture with bulk data fields injected.
 *
 * NEVER mutate the original fixture. Tests that need dataBase64,
 * previewDataUrl, or facePreviewUrls call this.
 */
function captureWithBulkData(): Record<string, unknown> {
    const copy = JSON.parse(JSON.stringify(sampleCapture));
    copy.resources.buffers.buf_1.dataBase64 = 'AQIDBA==';
    copy.resources.textures.tex_1.previewDataUrl = 'data:image/png;base64,AAAA';
    copy.resources.textures.tex_1.facePreviewUrls = ['data:image/png;base64,BBBB'];
    return copy;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('MCP Tools Integration', () => {
    // -----------------------------------------------------------------------
    // 1. Tool listing
    // -----------------------------------------------------------------------
    describe('tool listing', () => {
        it('lists exactly 6 tools with the correct names', async () => {
            const { client } = await createTestSetup();
            const { tools } = await client.listTools();

            expect(tools).toHaveLength(6);

            const names = tools.map(t => t.name).sort();
            expect(names).toEqual([
                'capture',
                'get_commands',
                'get_resource',
                'get_resources',
                'navigate',
                'screenshot',
            ]);
        });

        it('every tool has a non-empty description', async () => {
            const { client } = await createTestSetup();
            const { tools } = await client.listTools();

            for (const tool of tools) {
                expect(
                    tool.description,
                    `Tool '${tool.name}' has no description — users can't know what it does`,
                ).toBeTruthy();
            }
        });
    });

    // -----------------------------------------------------------------------
    // 2–3. navigate
    // -----------------------------------------------------------------------
    describe('navigate', () => {
        it('returns success=true with adapterInfo when WebGPU adapter is detected', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            mockBrowserMgr.ensurePage.mockResolvedValue({
                adapterInfo: { vendor: 'nvidia', architecture: 'turing' },
            });

            const result = await client.callTool({
                name: 'navigate',
                arguments: { url: 'https://example.com' },
            });

            expect(result.isError).toBeFalsy();
            const data = parseText(result);
            expect(data.success).toBe(true);
            expect(data.url).toBe('https://example.com');
            expect(data.adapterInfo).toEqual({ vendor: 'nvidia', architecture: 'turing' });
            expect(data.message).toBe('Page loaded with WebGPU adapter detected.');
        });

        it('returns success=true with null adapterInfo when no WebGPU detected', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            mockBrowserMgr.ensurePage.mockResolvedValue({ adapterInfo: null });

            const result = await client.callTool({
                name: 'navigate',
                arguments: { url: 'https://example.com' },
            });

            expect(result.isError).toBeFalsy();
            const data = parseText(result);
            expect(data.success).toBe(true);
            expect(data.adapterInfo).toBeNull();
            expect(data.message).toBe('Page loaded but no WebGPU adapter detected.');
        });

        it('returns isError=true with error message when ensurePage throws', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            mockBrowserMgr.ensurePage.mockRejectedValue(
                new Error('Connection refused'),
            );

            const result = await client.callTool({
                name: 'navigate',
                arguments: { url: 'https://broken.example.com' },
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain('Connection refused');
        });
    });

    // -----------------------------------------------------------------------
    // 4–5. capture
    // -----------------------------------------------------------------------
    describe('capture', () => {
        it('returns a human-readable summary with adapter, stats, and command tree', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            mockBrowserMgr.getPage.mockReturnValue(mockPage(sampleCapture));

            const result = await client.callTool({
                name: 'capture',
                arguments: {},
            });

            expect(result.isError).toBeFalsy();
            // The response is text — buildSummary returns a JSON string
            const content = result.content as Array<{ type: string; text?: string }>;
            expect(content[0].type).toBe('text');
            expect(content[0].text).toBeDefined();
            const summary = JSON.parse(content[0].text!);
            expect(summary).toHaveProperty('adapter');
            expect(summary).toHaveProperty('stats');
            expect(summary).toHaveProperty('commandTree');
        });

        it('returns isError=true when no page is open (getPage throws)', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            mockBrowserMgr.getPage.mockImplementation(() => {
                throw new Error("No page open. Use the 'navigate' tool first.");
            });

            const result = await client.callTool({
                name: 'capture',
                arguments: {},
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain('No page open');
        });
    });

    // -----------------------------------------------------------------------
    // 6. get_commands
    // -----------------------------------------------------------------------
    describe('get_commands', () => {
        it('returns the command tree with correct structure at depth=2', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_commands',
                arguments: { depth: 2 },
            });

            expect(result.isError).toBeFalsy();
            const commands = parseText(result) as unknown;
            expect(Array.isArray(commands)).toBe(true);
            expect(commands).toHaveLength(1);
            // Verify the actual command structure from the fixture
            expect((commands as Array<Record<string, unknown>>)[0]).toMatchObject({
                id: 'cmd_0',
                type: 'renderPass',
                name: 'beginRenderPass',
            });
        });

        it('returns isError=true when no capture is available', async () => {
            const { client } = await createTestSetup(); // No preload

            const result = await client.callTool({
                name: 'get_commands',
                arguments: {},
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain('No capture available');
        });
    });

    // -----------------------------------------------------------------------
    // 7–10. get_resources
    // -----------------------------------------------------------------------
    describe('get_resources', () => {
        it('returns overview with counts and item lists for all 9 categories when no category specified', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_resources',
                arguments: {},
            });

            expect(result.isError).toBeFalsy();
            const data = parseText(result);

            // ALL 9 categories must be present
            const expectedCategories = [
                'buffers', 'textures', 'textureViews', 'samplers', 'shaderModules',
                'renderPipelines', 'computePipelines', 'bindGroups', 'bindGroupLayouts',
            ];
            for (const cat of expectedCategories) {
                expect(data, `Missing category '${cat}' in overview`).toHaveProperty(cat);
                const entry = data[cat] as { count: number; items: Array<{ id: string }> };
                expect(typeof entry.count, `count for '${cat}' should be a number`).toBe('number');
                expect(Array.isArray(entry.items), `items for '${cat}' should be an array`).toBe(true);
            }

            // Spot-check counts from fixture
            expect((data.buffers as { count: number }).count).toBe(2);
            expect((data.textures as { count: number }).count).toBe(1);
            expect((data.shaderModules as { count: number }).count).toBe(1);
            expect((data.bindGroupLayouts as { count: number }).count).toBe(1);

            // Verify items have id and label
            const bufferItems = (data.buffers as { items: Array<{ id: string; label: string }> }).items;
            expect(bufferItems).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'buf_1', label: 'vertex' }),
                    expect.objectContaining({ id: 'buf_2', label: 'uniform' }),
                ]),
            );
        });

        it('returns all resources in a specific category (buffers)', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_resources',
                arguments: { category: 'buffers' },
            });

            expect(result.isError).toBeFalsy();
            const data = parseText(result);
            expect(data).toHaveProperty('buf_1');
            expect(data).toHaveProperty('buf_2');
            expect(data.buf_1).toMatchObject({
                id: 'buf_1',
                label: 'vertex',
                size: 1024,
                usage: 44,
            });
        });

        it('strips dataBase64 from buffers in category listing', async () => {
            // The fixture doesn't have bulk data — create a copy with it
            const { client } = await createTestSetup(captureWithBulkData());

            const result = await client.callTool({
                name: 'get_resources',
                arguments: { category: 'buffers' },
            });

            const data = parseText(result) as Record<string, Record<string, unknown>>;
            // dataBase64 MUST be gone
            expect(data.buf_1.dataBase64).toBeUndefined();
            // But real properties MUST survive
            expect(data.buf_1.id).toBe('buf_1');
            expect(data.buf_1.size).toBe(1024);
        });

        it('strips previewDataUrl and facePreviewUrls from textures in category listing', async () => {
            const { client } = await createTestSetup(captureWithBulkData());

            const result = await client.callTool({
                name: 'get_resources',
                arguments: { category: 'textures' },
            });

            const data = parseText(result) as Record<string, Record<string, unknown>>;
            // Both bulk data fields MUST be stripped
            expect(data.tex_1.previewDataUrl).toBeUndefined();
            expect(data.tex_1.facePreviewUrls).toBeUndefined();
            // Non-bulk properties preserved
            expect(data.tex_1.id).toBe('tex_1');
            expect(data.tex_1.format).toBe('rgba8unorm');
        });

        it('preserves shader code in category listing because code is NOT bulk data', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_resources',
                arguments: { category: 'shaderModules' },
            });

            const data = parseText(result) as Record<string, Record<string, unknown>>;
            expect(data.shd_1).toBeDefined();
            // THIS is the critical assertion: code MUST survive stripping.
            // stripBulkData removes dataBase64/previewDataUrl/facePreviewUrls,
            // but shader source code is essential and must be preserved.
            expect(data.shd_1.code).toBe('@vertex fn main() {}');
        });

        it('returns isError=true for invalid category with list of valid categories', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_resources',
                arguments: { category: 'invalid' },
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain("Invalid category 'invalid'");
            // Must list valid categories so the user knows what's available
            expect(data.error).toContain('buffers');
            expect(data.error).toContain('textures');
            expect(data.error).toContain('shaderModules');
        });

        it('returns isError=true when no capture is available', async () => {
            const { client } = await createTestSetup(); // No preload

            const result = await client.callTool({
                name: 'get_resources',
                arguments: {},
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain('No capture available');
        });
    });

    // -----------------------------------------------------------------------
    // 11–12. get_resource
    // -----------------------------------------------------------------------
    describe('get_resource', () => {
        it('returns full shader resource with code field preserved (NOT stripped)', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_resource',
                arguments: { id: 'shd_1' },
            });

            expect(result.isError).toBeFalsy();
            const data = parseText(result);
            expect(data.category).toBe('shaderModules');
            expect(data.resource).toMatchObject({
                id: 'shd_1',
                label: 'vertex shader',
                code: '@vertex fn main() {}',
            });
        });

        it('preserves dataBase64 in single resource view (unlike get_resources)', async () => {
            // This is the CRITICAL difference: get_resource returns FULL data
            // including all bulk fields. get_resources strips them.
            const { client } = await createTestSetup(captureWithBulkData());

            const result = await client.callTool({
                name: 'get_resource',
                arguments: { id: 'buf_1' },
            });

            expect(result.isError).toBeFalsy();
            const data = parseText(result);
            expect(data.category).toBe('buffers');
            const resource = data.resource as Record<string, unknown>;
            // Full data preserved — NOT stripped
            expect(resource.dataBase64).toBe('AQIDBA==');
            expect(resource.id).toBe('buf_1');
        });

        it('returns isError=true with actionable message when resource is not found', async () => {
            const { client } = await createTestSetup(sampleCapture);

            const result = await client.callTool({
                name: 'get_resource',
                arguments: { id: 'nonexistent_99' },
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain("Resource 'nonexistent_99' not found");
            // Must tell the user how to find valid IDs
            expect(data.error).toContain('get_resources');
        });

        it('returns isError=true when no capture is available', async () => {
            const { client } = await createTestSetup(); // No preload

            const result = await client.callTool({
                name: 'get_resource',
                arguments: { id: 'buf_1' },
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain('No capture available');
        });
    });

    // -----------------------------------------------------------------------
    // 13–14. screenshot
    // -----------------------------------------------------------------------
    describe('screenshot', () => {
        it('returns an image content block with base64 PNG data and correct MIME type', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            const fakeBase64 = 'iVBORw0KGgo=';
            mockBrowserMgr.screenshot.mockResolvedValue(fakeBase64);

            const result = await client.callTool({
                name: 'screenshot',
                arguments: {},
            });

            expect(result.isError).toBeFalsy();
            expect(result.content).toHaveLength(1);
            const item = result.content[0] as { type: string; data?: string; mimeType?: string };
            expect(item.type).toBe('image');
            expect(item.data).toBe(fakeBase64);
            expect(item.mimeType).toBe('image/png');
        });

        it('returns isError=true with error message when no page is open', async () => {
            const { client, mockBrowserMgr } = await createTestSetup();
            mockBrowserMgr.screenshot.mockRejectedValue(
                new Error("No page open. Use the 'navigate' tool first."),
            );

            const result = await client.callTool({
                name: 'screenshot',
                arguments: {},
            });

            expect(result.isError).toBe(true);
            const data = parseText(result);
            expect(data.error).toContain('No page open');
        });
    });
});
