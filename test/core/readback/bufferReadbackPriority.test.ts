import { describe, it, expect } from 'vitest';
import { selectBuffersForReadback } from '../../../src/core/readbackPriority';
import type { IBufferInfo, ICommandNode, CommandType } from '@shared/types';

// ─── Test helpers ────────────────────────────────────────────────────

function makeBuf(id: string, overrides: Partial<IBufferInfo> = {}): IBufferInfo {
    return {
        id,
        size: 64,
        usage: 0x0044, // COPY_SRC | UNIFORM
        mappedAtCreation: false,
        state: 'unmapped',
        ...overrides,
    };
}

function makeCmd(overrides: Partial<ICommandNode> & { id: string; name: string }): ICommandNode {
    return {
        type: 'other' as unknown as CommandType,
        args: {},
        children: [],
        parentId: null,
        timestamp: 0,
        ...overrides,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('selectBuffersForReadback', () => {
    it('prioritizes command-referenced buffers over unreferenced ones', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_1', makeBuf('buf_1')],
            ['buf_2', makeBuf('buf_2')],
            ['buf_3', makeBuf('buf_3')],
        ]);
        const commands: ICommandNode[] = [
            makeCmd({
                id: 'cmd_0', name: 'draw',
                vertexBuffers: ['buf_3'],
            }),
        ];

        const selected = selectBuffersForReadback(buffers, commands, 2);

        // buf_3 should come first (referenced by draw command)
        expect(selected[0]).toBe('buf_3');
        expect(selected).toHaveLength(2);
    });

    it('skips buffers that already have dataBase64', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_1', makeBuf('buf_1', { dataBase64: 'AAAA' })],
            ['buf_2', makeBuf('buf_2')],
        ]);

        const selected = selectBuffersForReadback(buffers, [], 10);

        // buf_1 already has data — skip it
        expect(selected).toEqual(['buf_2']);
    });

    it('skips destroyed buffers', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_1', makeBuf('buf_1', { state: 'destroyed' })],
            ['buf_2', makeBuf('buf_2')],
        ]);

        const selected = selectBuffersForReadback(buffers, [], 10);
        expect(selected).toEqual(['buf_2']);
    });

    it('skips mapped buffers', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_1', makeBuf('buf_1', { state: 'mapped' })],
            ['buf_2', makeBuf('buf_2', { state: 'mapping-pending' })],
            ['buf_3', makeBuf('buf_3')],
        ]);

        const selected = selectBuffersForReadback(buffers, [], 10);
        expect(selected).toEqual(['buf_3']);
    });

    it('skips buffers without COPY_SRC flag', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_1', makeBuf('buf_1', { usage: 0x0009 })], // MAP_READ | COPY_DST, no COPY_SRC
            ['buf_2', makeBuf('buf_2', { usage: 0x0044 })], // COPY_SRC | UNIFORM
        ]);

        const selected = selectBuffersForReadback(buffers, [], 10);
        expect(selected).toEqual(['buf_2']);
    });

    it('skips zero-size and oversized buffers', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_1', makeBuf('buf_1', { size: 0 })],
            ['buf_2', makeBuf('buf_2', { size: 32 * 1024 * 1024 })], // 32MB
            ['buf_3', makeBuf('buf_3', { size: 64 })],
        ]);

        const selected = selectBuffersForReadback(buffers, [], 10);
        expect(selected).toEqual(['buf_3']);
    });

    it('respects the max buffer count limit', () => {
        const buffers = new Map<string, IBufferInfo>();
        for (let i = 0; i < 10; i++) {
            buffers.set(`buf_${i}`, makeBuf(`buf_${i}`));
        }

        const selected = selectBuffersForReadback(buffers, [], 3);
        expect(selected).toHaveLength(3);
    });

    it('finds buffer references from vertexBuffers, indexBufferId, and deep args', () => {
        const buffers = new Map<string, IBufferInfo>([
            ['buf_v', makeBuf('buf_v')],
            ['buf_i', makeBuf('buf_i')],
            ['buf_w', makeBuf('buf_w')],
            ['buf_x', makeBuf('buf_x')],
        ]);
        const commands: ICommandNode[] = [
            makeCmd({
                id: 'draw_0', name: 'draw',
                vertexBuffers: ['buf_v'],
                indexBufferId: 'buf_i',
            }),
            makeCmd({
                id: 'write_0', name: 'queue.writeBuffer',
                args: { args: [{ __type: 'GPUBuffer', __id: 'buf_w' }, 0] },
            }),
        ];

        const selected = selectBuffersForReadback(buffers, commands, 3);

        // All 3 referenced buffers should come first
        expect(selected.slice(0, 3)).toContain('buf_v');
        expect(selected.slice(0, 3)).toContain('buf_i');
        expect(selected.slice(0, 3)).toContain('buf_w');
    });

    it('handles a realistic Babylon.js-like scenario with 127 buffers', () => {
        const buffers = new Map<string, IBufferInfo>();

        // 32 early uniform buffers (created first, all eligible)
        for (let i = 1; i <= 32; i++) {
            buffers.set(`buf_${i}`, makeBuf(`buf_${i}`, { usage: 0x004C })); // COPY_SRC|COPY_DST|UNIFORM
        }
        // 7 vertex/index buffers created later (the ones we NEED data for)
        for (let i = 39; i <= 45; i++) {
            buffers.set(`buf_${i}`, makeBuf(`buf_${i}`, { usage: 0x002C, size: 200 })); // COPY_SRC|COPY_DST|VERTEX
        }
        // 50 MAP_READ staging buffers (not eligible)
        for (let i = 100; i < 150; i++) {
            buffers.set(`buf_${i}`, makeBuf(`buf_${i}`, { usage: 0x0009 })); // MAP_READ|COPY_DST
        }

        // Draw commands reference the vertex buffers
        const commands: ICommandNode[] = [
            makeCmd({
                id: 'draw_0', name: 'draw',
                vertexBuffers: ['buf_39', 'buf_40'],
                indexBufferId: 'buf_41',
            }),
            makeCmd({
                id: 'draw_1', name: 'draw',
                vertexBuffers: ['buf_42', 'buf_43'],
                indexBufferId: 'buf_44',
            }),
        ];

        const selected = selectBuffersForReadback(buffers, commands, 128);

        // All 6 draw-referenced buffers should be in the selection
        expect(selected).toContain('buf_39');
        expect(selected).toContain('buf_40');
        expect(selected).toContain('buf_41');
        expect(selected).toContain('buf_42');
        expect(selected).toContain('buf_43');
        expect(selected).toContain('buf_44');

        // And they should appear BEFORE unreferenced buffers
        const refIndices = ['buf_39', 'buf_40', 'buf_41', 'buf_42', 'buf_43', 'buf_44']
            .map(id => selected.indexOf(id));
        const maxRefIndex = Math.max(...refIndices);
        // The first unreferenced buffer should come after all referenced ones
        const firstUnref = selected.find(id => !['buf_39', 'buf_40', 'buf_41', 'buf_42', 'buf_43', 'buf_44'].includes(id));
        if (firstUnref) {
            expect(selected.indexOf(firstUnref)).toBeGreaterThan(maxRefIndex);
        }
    });
});
