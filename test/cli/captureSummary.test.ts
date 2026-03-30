import { describe, it, expect } from 'vitest';
import { buildSummary } from '../../skills/spector-gpu-capture/summary.js';

// Minimal capture fixture with one shader module
function makeCapture(shaderOverrides = {}) {
    return {
        adapterInfo: { vendor: 'nvidia', architecture: 'turing', description: '' },
        stats: {
            totalCommands: 4,
            drawCalls: 1,
            dispatchCalls: 0,
            renderPasses: 1,
            computePasses: 0,
        },
        duration: 100.5,
        commands: [
            { type: 'renderPass', name: 'beginRenderPass', children: [] },
        ],
        resources: {
            textures: {},
            buffers: {},
            shaderModules: {
                shd_1: {
                    id: 'shd_1',
                    label: 'triangle shader',
                    code: '@vertex\nfn vs_main() -> @builtin(position) vec4f {\n  return vec4f(0.0);\n}\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n  return vec4f(1.0, 0.0, 0.0, 1.0);\n}',
                    ...shaderOverrides,
                },
            },
            renderPipelines: {},
            computePipelines: {},
        },
    };
}

describe('buildSummary', () => {
    it('excludes shader source code from summary (available via get_resource)', () => {
        const capture = makeCapture();
        const summary = JSON.parse(buildSummary(capture));

        expect(summary.shaderModules).toHaveLength(1);
        const shader = summary.shaderModules[0];
        expect(shader.id).toBe('shd_1');
        expect(shader.label).toBe('triangle shader');
        expect(shader.code).toBeUndefined();
    });

    it('includes line count for shader modules', () => {
        const capture = makeCapture();
        const summary = JSON.parse(buildSummary(capture));
        const shader = summary.shaderModules[0];

        expect(shader.lines).toBe(9);
    });

    it('handles shader with no code gracefully', () => {
        const capture = makeCapture({ code: undefined });
        const summary = JSON.parse(buildSummary(capture));
        const shader = summary.shaderModules[0];

        expect(shader.code).toBeUndefined();
        expect(shader.lines).toBe(0);
    });

    it('includes compilationInfo when present', () => {
        const capture = makeCapture({
            compilationInfo: [
                { type: 'warning', message: 'unused variable', lineNum: 3, linePos: 5 },
            ],
        });
        const summary = JSON.parse(buildSummary(capture));
        const shader = summary.shaderModules[0];

        expect(shader.compilationInfo).toBeDefined();
        expect(shader.compilationInfo).toHaveLength(1);
        expect(shader.compilationInfo[0].type).toBe('warning');
    });

    it('excludes buffer dataBase64 from summary (available via get_resource)', () => {
        const capture = makeCapture();
        capture.resources.buffers = {
            buf_1: {
                id: 'buf_1',
                label: 'uniform',
                size: 8,
                usage: 0x0044, // COPY_SRC | UNIFORM
                state: 'unmapped',
                dataBase64: 'AAAAAAAAAAA=',
            },
        };
        const summary = JSON.parse(buildSummary(capture));

        expect(summary.buffers).toHaveLength(1);
        const buf = summary.buffers[0];
        expect(buf.id).toBe('buf_1');
        expect(buf.dataBase64).toBeUndefined();
        expect(buf.hasData).toBe(true);
    });

    it('omits dataBase64 when buffer has no data', () => {
        const capture = makeCapture();
        capture.resources.buffers = {
            buf_2: {
                id: 'buf_2',
                size: 16,
                usage: 0x0009, // MAP_READ | COPY_DST
                state: 'unmapped',
            },
        };
        const summary = JSON.parse(buildSummary(capture));

        const buf = summary.buffers[0];
        expect(buf.hasData).toBe(false);
        expect(buf.dataBase64).toBeUndefined();
    });
});
