import { describe, it, expect } from 'vitest';
import { buildUsageIndex } from '@extension/resultView/usageIndex';
import type { ICapture, ICommandNode, CommandType } from '@shared/types';

// ─── Test helpers ────────────────────────────────────────────────────

function makeCommand(
    overrides: Partial<ICommandNode> & { id: string; name: string },
): ICommandNode {
    return {
        type: 'other' as unknown as CommandType,
        args: {},
        children: [],
        parentId: null,
        timestamp: 0,
        ...overrides,
    };
}

function emptyCapture(commands: ICommandNode[]): ICapture {
    return {
        id: 'test',
        version: '0.0.0',
        timestamp: 0,
        duration: 0,
        adapterInfo: { vendor: '', architecture: '', device: '', description: '', backend: '' },
        deviceDescriptor: {},
        deviceLimits: {},
        deviceFeatures: [],
        commands,
        resources: {
            buffers: new Map(),
            textures: new Map(),
            samplers: new Map(),
            shaderModules: new Map(),
            renderPipelines: new Map(),
            computePipelines: new Map(),
            bindGroups: new Map(),
            bindGroupLayouts: new Map(),
            textureViews: new Map(),
        },
        stats: {
            totalCommands: 0,
            drawCalls: 0,
            dispatchCalls: 0,
            renderPasses: 0,
            computePasses: 0,
            pipelineCount: 0,
            bufferCount: 0,
            textureCount: 0,
            shaderModuleCount: 0,
            bindGroupCount: 0,
        },
    };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('buildUsageIndex', () => {
    it('indexes state snapshot fields (pipelineId, bindGroups, vertexBuffers, indexBufferId)', () => {
        const cmd = makeCommand({
            id: 'cmd_0',
            name: 'draw',
            pipelineId: 'rp_0',
            bindGroups: ['bg_0', 'bg_1'],
            vertexBuffers: ['buf_0'],
            indexBufferId: 'buf_1',
        });
        const index = buildUsageIndex(emptyCapture([cmd]));

        expect(index.get('rp_0')).toEqual([{ id: 'cmd_0', label: 'draw', type: 'command' }]);
        expect(index.get('bg_0')).toEqual([{ id: 'cmd_0', label: 'draw', type: 'command' }]);
        expect(index.get('bg_1')).toEqual([{ id: 'cmd_0', label: 'draw', type: 'command' }]);
        expect(index.get('buf_0')).toEqual([{ id: 'cmd_0', label: 'draw', type: 'command' }]);
        expect(index.get('buf_1')).toEqual([{ id: 'cmd_0', label: 'draw', type: 'command' }]);
    });

    it('finds __id fields nested inside args arrays', () => {
        const cmd = makeCommand({
            id: 'cmd_1',
            name: 'renderPass.setPipeline',
            args: {
                args: [
                    { __type: 'GPURenderPipeline', __id: 'rp_0', label: 'MyPipeline' },
                ],
            },
        });
        const index = buildUsageIndex(emptyCapture([cmd]));

        expect(index.get('rp_0')).toEqual([
            { id: 'cmd_1', label: 'renderPass.setPipeline', type: 'command' },
        ]);
    });

    it('finds __id fields deeply nested in descriptors (beginRenderPass)', () => {
        const cmd = makeCommand({
            id: 'cmd_2',
            name: 'encoder.beginRenderPass',
            args: {
                descriptor: {
                    colorAttachments: [
                        {
                            view: { __type: 'GPUTextureView', __id: 'tv_0' },
                            resolveTarget: { __type: 'GPUTextureView', __id: 'tv_1' },
                            loadOp: 'clear',
                            storeOp: 'store',
                        },
                    ],
                    depthStencilAttachment: {
                        view: { __type: 'GPUTextureView', __id: 'tv_2' },
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store',
                    },
                },
            },
        });
        const index = buildUsageIndex(emptyCapture([cmd]));

        const usagesTV0 = index.get('tv_0');
        const usagesTV1 = index.get('tv_1');
        const usagesTV2 = index.get('tv_2');

        expect(usagesTV0).toEqual([{ id: 'cmd_2', label: 'encoder.beginRenderPass', type: 'command' }]);
        expect(usagesTV1).toEqual([{ id: 'cmd_2', label: 'encoder.beginRenderPass', type: 'command' }]);
        expect(usagesTV2).toEqual([{ id: 'cmd_2', label: 'encoder.beginRenderPass', type: 'command' }]);
    });

    it('finds __id in copyBufferToBuffer args', () => {
        const cmd = makeCommand({
            id: 'cmd_3',
            name: 'encoder.copyBufferToBuffer',
            args: {
                args: [
                    { __type: 'GPUBuffer', __id: 'buf_0' },
                    0,
                    { __type: 'GPUBuffer', __id: 'buf_1' },
                    0,
                    128,
                ],
            },
        });
        const index = buildUsageIndex(emptyCapture([cmd]));

        expect(index.get('buf_0')).toEqual([
            { id: 'cmd_3', label: 'encoder.copyBufferToBuffer', type: 'command' },
        ]);
        expect(index.get('buf_1')).toEqual([
            { id: 'cmd_3', label: 'encoder.copyBufferToBuffer', type: 'command' },
        ]);
    });

    it('deduplicates entries for the same command referencing the same resource', () => {
        // A command that references the same buffer ID both in state and in args
        const cmd = makeCommand({
            id: 'cmd_4',
            name: 'draw',
            vertexBuffers: ['buf_0'],
            args: {
                args: [
                    { __type: 'GPUBuffer', __id: 'buf_0' },
                ],
            },
        });
        const index = buildUsageIndex(emptyCapture([cmd]));

        // Should only appear once despite being found in both state and args
        expect(index.get('buf_0')).toHaveLength(1);
    });

    it('scans children recursively', () => {
        const child = makeCommand({
            id: 'child_0',
            name: 'renderPass.setVertexBuffer',
            args: {
                args: [0, { __type: 'GPUBuffer', __id: 'buf_5' }],
            },
        });
        const parent = makeCommand({
            id: 'parent_0',
            name: 'encoder.beginRenderPass',
            children: [child],
            args: {
                descriptor: {
                    colorAttachments: [
                        { view: { __type: 'GPUTextureView', __id: 'tv_9' } },
                    ],
                },
            },
        });
        const index = buildUsageIndex(emptyCapture([parent]));

        expect(index.get('buf_5')).toEqual([
            { id: 'child_0', label: 'renderPass.setVertexBuffer', type: 'command' },
        ]);
        expect(index.get('tv_9')).toEqual([
            { id: 'parent_0', label: 'encoder.beginRenderPass', type: 'command' },
        ]);
    });

    it('indexes resource-to-resource references (render pipeline → shader module)', () => {
        const capture = emptyCapture([]);
        (capture.resources.renderPipelines as Map<string, any>).set('rp_0', {
            id: 'rp_0',
            label: 'MainPipeline',
            layout: 'auto',
            vertex: { moduleId: 'shd_0', entryPoint: 'vs_main' },
            fragment: { moduleId: 'shd_1', entryPoint: 'fs_main' },
        });
        const index = buildUsageIndex(capture);

        const shd0 = index.get('shd_0')!;
        expect(shd0).toBeDefined();
        expect(shd0[0].type).toBe('resource');
        expect(shd0[0].id).toBe('rp_0');

        const shd1 = index.get('shd_1')!;
        expect(shd1).toBeDefined();
        expect(shd1[0].type).toBe('resource');
        expect(shd1[0].id).toBe('rp_0');
    });

    it('indexes bind group entries (bind group → buffer/texture view)', () => {
        const capture = emptyCapture([]);
        (capture.resources.bindGroups as Map<string, any>).set('bg_0', {
            id: 'bg_0',
            label: 'SceneBindGroup',
            layoutId: 'bgl_0',
            entries: [
                { binding: 0, resourceType: 'buffer', resourceId: 'buf_0' },
                { binding: 1, resourceType: 'textureView', resourceId: 'tv_0' },
                { binding: 2, resourceType: 'sampler', resourceId: 'smp_0' },
            ],
        });
        const index = buildUsageIndex(capture);

        expect(index.get('bgl_0')![0].id).toBe('bg_0');
        expect(index.get('buf_0')![0].id).toBe('bg_0');
        expect(index.get('tv_0')![0].id).toBe('bg_0');
        expect(index.get('smp_0')![0].id).toBe('bg_0');
    });

    it('handles empty args gracefully', () => {
        const cmd = makeCommand({ id: 'cmd_5', name: 'end', args: {} });
        const index = buildUsageIndex(emptyCapture([cmd]));
        expect(index.size).toBe(0);
    });

    it('finds buffer __id in queue.writeBuffer args', () => {
        const cmd = makeCommand({
            id: 'cmd_6',
            name: 'queue.writeBuffer',
            args: {
                args: [
                    { __type: 'GPUBuffer', __id: 'buf_3', label: 'uniform' },
                    0,
                    { __type: 'ArrayBuffer' },
                    0,
                    64,
                ],
            },
        });
        const index = buildUsageIndex(emptyCapture([cmd]));

        expect(index.get('buf_3')).toEqual([
            { id: 'cmd_6', label: 'queue.writeBuffer', type: 'command' },
        ]);
    });

    it('aggregates buffer references from commands, bind groups, and args', () => {
        // buf_0 is referenced 3 ways: vertex buffer state, bind group entry, writeBuffer args
        const drawCmd = makeCommand({
            id: 'draw_0',
            name: 'draw',
            vertexBuffers: ['buf_0'],
        });
        const writeCmd = makeCommand({
            id: 'write_0',
            name: 'queue.writeBuffer',
            args: {
                args: [
                    { __type: 'GPUBuffer', __id: 'buf_0' },
                    0,
                    { __type: 'ArrayBuffer' },
                ],
            },
        });
        const capture = emptyCapture([drawCmd, writeCmd]);
        (capture.resources.bindGroups as Map<string, any>).set('bg_0', {
            id: 'bg_0',
            entries: [{ binding: 0, resourceType: 'buffer', resourceId: 'buf_0' }],
        });
        const index = buildUsageIndex(capture);

        const usages = index.get('buf_0')!;
        expect(usages).toBeDefined();
        expect(usages).toHaveLength(3);
        expect(usages).toContainEqual({ id: 'draw_0', label: 'draw', type: 'command' });
        expect(usages).toContainEqual({ id: 'write_0', label: 'queue.writeBuffer', type: 'command' });
        expect(usages).toContainEqual(expect.objectContaining({ id: 'bg_0', type: 'resource' }));
    });
});
