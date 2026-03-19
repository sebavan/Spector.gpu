/**
 * E2E: Capture quality — visual output and pipeline association tests.
 *
 * Verifies two critical bugs are fixed:
 *   Bug 1: Screenshots are captured during queue.submit() while the WebGPU
 *           back buffer is still valid (not after frame presentation when
 *           the content has been cleared), producing non-blank visual output.
 *   Bug 2: Draw call nodes carry pipelineId linking to actual pipelines
 *           and shaders in the resource map.
 *
 * Uses captureFrameWithData() to intercept the full serialized ICapture
 * (command tree + resources) via the CAPTURE_DATA message.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
    launchWithExtension,
    fixtureUrl,
    waitForPageReady,
    captureFrameWithData,
    type FullCaptureResult,
    type SerializedCommandNode,
} from './helpers';

// ── Helpers ──────────────────────────────────────────────────────────

/** Recursively collect all nodes matching a predicate from the command tree. */
function findNodes(
    roots: SerializedCommandNode[],
    predicate: (n: SerializedCommandNode) => boolean,
): SerializedCommandNode[] {
    const result: SerializedCommandNode[] = [];
    function walk(nodes: SerializedCommandNode[]): void {
        for (const node of nodes) {
            if (predicate(node)) result.push(node);
            if (node.children?.length) walk(node.children);
        }
    }
    walk(roots);
    return result;
}

// ═════════════════════════════════════════════════════════════════════
// Test suite 1: Triangle fixture — visual output + basic pipeline
// ═════════════════════════════════════════════════════════════════════

test.describe('Capture Quality — Triangle', () => {
    let context: BrowserContext;
    let page: Page;
    let result: FullCaptureResult;

    test.beforeAll(async () => {
        context = await launchWithExtension();
        page = await context.newPage();
        await page.goto(fixtureUrl('triangle.html'));
        await waitForPageReady(page, /^READY_\d+/);

        // Let several frames render so capture has stable data.
        await page.waitForTimeout(500);
        result = await captureFrameWithData(page);
    });

    test.afterAll(async () => {
        await context?.close();
    });

    // ── Bug 1: Visual output is non-blank ────────────────────────────

    test('render pass nodes have non-blank visual output', async () => {
        expect(result.capture).toBeDefined();

        const renderPasses = findNodes(
            result.capture.commands,
            (n) => n.type === 'renderPass',
        );
        expect(renderPasses.length).toBeGreaterThanOrEqual(1);

        // Every render pass should have a visual output attached.
        for (const rp of renderPasses) {
            expect(rp.visualOutput).toBeDefined();
            expect(typeof rp.visualOutput).toBe('string');

            // A real PNG screenshot of a 256px-wide canvas with content.
            // Blank images at this resolution are ~200-300 chars as data URLs.
            // Simple scenes (solid-color triangles on dark bg) compress well
            // in PNG, so we use a conservative threshold above blank territory.
            expect(rp.visualOutput!.length).toBeGreaterThan(500);
            expect(rp.visualOutput).toContain('data:image/png');
        }
    });

    test('submit nodes have visual output', async () => {
        const submits = findNodes(
            result.capture.commands,
            (n) => n.type === 'submit',
        );
        expect(submits.length).toBeGreaterThanOrEqual(1);

        for (const s of submits) {
            expect(s.visualOutput).toBeDefined();
            expect(s.visualOutput!.length).toBeGreaterThan(500);
        }
    });

    // ── Bug 2: Draw calls have pipeline association ──────────────────

    test('draw call nodes have pipelineId set', async () => {
        const drawNodes = findNodes(
            result.capture.commands,
            (n) => n.type === 'draw',
        );
        expect(drawNodes.length).toBeGreaterThanOrEqual(1);

        for (const draw of drawNodes) {
            expect(draw.pipelineId).toBeDefined();
            expect(typeof draw.pipelineId).toBe('string');
            expect(draw.pipelineId!.length).toBeGreaterThan(0);
        }
    });

    test('pipelineId resolves to a pipeline with shader modules', async () => {
        const drawNodes = findNodes(
            result.capture.commands,
            (n) => n.type === 'draw',
        );
        expect(drawNodes.length).toBeGreaterThanOrEqual(1);

        const pipelines = result.capture.resources.renderPipelines;
        const shaders = result.capture.resources.shaderModules;

        for (const draw of drawNodes) {
            const pipelineId = draw.pipelineId!;
            const pipeline = pipelines[pipelineId];
            expect(pipeline).toBeDefined();

            // Vertex stage must reference a shader module.
            expect(pipeline.vertex).toBeDefined();
            expect(pipeline.vertex.moduleId).toBeDefined();
            const vertexShader = shaders[pipeline.vertex.moduleId];
            expect(vertexShader).toBeDefined();
            expect(vertexShader.code).toContain('@vertex');

            // Fragment stage (present on this pipeline).
            if (pipeline.fragment) {
                const fragShader = shaders[pipeline.fragment.moduleId];
                expect(fragShader).toBeDefined();
                expect(fragShader.code).toContain('@fragment');
            }
        }
    });
});

// ═════════════════════════════════════════════════════════════════════
// Test suite 2: Multi-pass fixture — different pipelines per pass
// ═════════════════════════════════════════════════════════════════════

test.describe('Capture Quality — Multi-Pass', () => {
    let context: BrowserContext;
    let page: Page;
    let result: FullCaptureResult;

    test.beforeAll(async () => {
        context = await launchWithExtension();
        page = await context.newPage();
        await page.goto(fixtureUrl('multi-pass.html'));
        await waitForPageReady(page, /^READY_\d+/);

        await page.waitForTimeout(500);
        result = await captureFrameWithData(page);
    });

    test.afterAll(async () => {
        await context?.close();
    });

    test('two draw calls have different pipelineIds', async () => {
        const drawNodes = findNodes(
            result.capture.commands,
            (n) => n.type === 'draw',
        );
        expect(drawNodes.length).toBeGreaterThanOrEqual(2);

        // The two draws should use different pipelines (red vs green).
        const pipelineIds = new Set(drawNodes.map((d) => d.pipelineId));
        expect(pipelineIds.size).toBeGreaterThanOrEqual(2);
    });

    test('each pipeline references a different shader', async () => {
        const drawNodes = findNodes(
            result.capture.commands,
            (n) => n.type === 'draw',
        );
        const pipelines = result.capture.resources.renderPipelines;
        const shaders = result.capture.resources.shaderModules;

        const vertexModuleIds = new Set<string>();
        for (const draw of drawNodes) {
            const pipeline = pipelines[draw.pipelineId!];
            expect(pipeline).toBeDefined();
            vertexModuleIds.add(pipeline.vertex.moduleId);

            // Verify shader code is real WGSL
            const shader = shaders[pipeline.vertex.moduleId];
            expect(shader).toBeDefined();
            expect(shader.code).toContain('@vertex');
            expect(shader.code).toContain('@fragment');
        }

        // Multi-pass fixture uses two DIFFERENT shader modules.
        expect(vertexModuleIds.size).toBeGreaterThanOrEqual(2);
    });

    test('second draw has bind group state', async () => {
        // The multi-pass fixture sets a bind group on the second pass.
        // The second draw (draw(6) for the green quad) should have
        // bindGroups set.
        const drawNodes = findNodes(
            result.capture.commands,
            (n) => n.type === 'draw',
        );

        // Find the draw(6) — the green quad draw call.
        const quadDraw = drawNodes.find(
            (d) => d.args?.['0'] === 6,
        );
        expect(quadDraw).toBeDefined();
        expect(quadDraw!.bindGroups).toBeDefined();
        expect(quadDraw!.bindGroups!.length).toBeGreaterThanOrEqual(1);
        expect(quadDraw!.bindGroups![0].length).toBeGreaterThan(0);
    });

    test('all render passes have visual output', async () => {
        const renderPasses = findNodes(
            result.capture.commands,
            (n) => n.type === 'renderPass',
        );
        expect(renderPasses.length).toBeGreaterThanOrEqual(2);

        for (const rp of renderPasses) {
            expect(rp.visualOutput).toBeDefined();
            expect(rp.visualOutput!.length).toBeGreaterThan(500);        }
    });
});
