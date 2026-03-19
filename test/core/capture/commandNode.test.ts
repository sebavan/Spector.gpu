import { describe, it, expect, beforeEach } from 'vitest';
import { CommandNodeBuilder } from '../../../src/core/capture/commandNode';
import { CommandType } from '../../../src/shared/types';
import { globalIdGenerator } from '../../../src/shared/utils';

describe('CommandNodeBuilder', () => {
    beforeEach(() => {
        globalIdGenerator.reset();
    });

    it('creates node with correct type, name, and args', () => {
        const args = { vertexCount: 6, instanceCount: 1 };
        const node = new CommandNodeBuilder(CommandType.Draw, 'draw', args);

        expect(node.type).toBe(CommandType.Draw);
        expect(node.name).toBe('draw');
        expect(node.id).toBe('cmd_1');
    });

    it('uses empty args when none provided', () => {
        const node = new CommandNodeBuilder(CommandType.Submit, 'submit');
        const frozen = node.toNode();
        expect(frozen.args).toEqual({});
    });

    it('addChild sets parent reference on child', () => {
        const parent = new CommandNodeBuilder(CommandType.RenderPass, 'beginRenderPass');
        const child = new CommandNodeBuilder(CommandType.Draw, 'draw');

        parent.addChild(child);

        expect(child.parent).toBe(parent);
        expect(parent.childCount).toBe(1);
        expect(parent.children[0]).toBe(child);
    });

    it('toNode() produces correct ICommandNode with children', () => {
        const parent = new CommandNodeBuilder(CommandType.Submit, 'submit');
        const child = new CommandNodeBuilder(CommandType.Draw, 'draw', { vertexCount: 3 });
        parent.addChild(child);

        const frozen = parent.toNode();

        expect(frozen.id).toBe(parent.id);
        expect(frozen.type).toBe(CommandType.Submit);
        expect(frozen.name).toBe('submit');
        expect(frozen.parentId).toBeNull();
        expect(frozen.children).toHaveLength(1);
        expect(frozen.children[0].type).toBe(CommandType.Draw);
        expect(frozen.children[0].parentId).toBe(parent.id);
        expect(frozen.children[0].args).toEqual({ vertexCount: 3 });
        expect(frozen.timestamp).toBeGreaterThanOrEqual(0);
    });

    it('setStateSnapshot captures pipeline/bindGroup/buffer state', () => {
        const node = new CommandNodeBuilder(CommandType.Draw, 'draw');
        node.setStateSnapshot({
            pipelineId: 'pipe_1',
            bindGroups: ['bg_0', 'bg_1'],
            vertexBuffers: ['vb_0'],
            indexBufferId: 'ib_0',
        });

        const frozen = node.toNode();

        expect(frozen.pipelineId).toBe('pipe_1');
        expect(frozen.bindGroups).toEqual(['bg_0', 'bg_1']);
        expect(frozen.vertexBuffers).toEqual(['vb_0']);
        expect(frozen.indexBufferId).toBe('ib_0');
    });

    it('toNode() omits state snapshot fields when not set', () => {
        const node = new CommandNodeBuilder(CommandType.Draw, 'draw');
        const frozen = node.toNode();

        expect(frozen.pipelineId).toBeUndefined();
        expect(frozen.bindGroups).toBeUndefined();
        expect(frozen.vertexBuffers).toBeUndefined();
        expect(frozen.indexBufferId).toBeUndefined();
    });

    it('nested tree: submit → renderPass → draw produces correct hierarchy', () => {
        const submit = new CommandNodeBuilder(CommandType.Submit, 'submit');
        const pass = new CommandNodeBuilder(CommandType.RenderPass, 'beginRenderPass');
        const draw1 = new CommandNodeBuilder(CommandType.Draw, 'draw', { vertexCount: 3 });
        const draw2 = new CommandNodeBuilder(CommandType.Draw, 'drawIndexed', { indexCount: 6 });

        submit.addChild(pass);
        pass.addChild(draw1);
        pass.addChild(draw2);

        const tree = submit.toNode();

        // submit
        expect(tree.parentId).toBeNull();
        expect(tree.children).toHaveLength(1);

        // renderPass
        const passNode = tree.children[0];
        expect(passNode.type).toBe(CommandType.RenderPass);
        expect(passNode.parentId).toBe(submit.id);
        expect(passNode.children).toHaveLength(2);

        // draws
        expect(passNode.children[0].type).toBe(CommandType.Draw);
        expect(passNode.children[0].parentId).toBe(pass.id);
        expect(passNode.children[0].args).toEqual({ vertexCount: 3 });
        expect(passNode.children[1].args).toEqual({ indexCount: 6 });
        expect(passNode.children[1].children).toEqual([]);
    });

    it('toNode() creates deep copy — mutating builder after freeze does not affect frozen node', () => {
        const parent = new CommandNodeBuilder(CommandType.Submit, 'submit');
        const child1 = new CommandNodeBuilder(CommandType.Draw, 'draw');
        parent.addChild(child1);

        // Freeze
        const frozen = parent.toNode();
        expect(frozen.children).toHaveLength(1);

        // Mutate builder after freeze
        const child2 = new CommandNodeBuilder(CommandType.Draw, 'drawIndexed');
        parent.addChild(child2);

        // Frozen snapshot must be unaffected
        expect(frozen.children).toHaveLength(1);
        expect(parent.childCount).toBe(2);
    });

    it('toNode() copies bindGroups/vertexBuffers arrays so mutations do not leak', () => {
        const sourceBindGroups = ['bg_0', 'bg_1'];
        const sourceVertexBuffers = ['vb_0'];
        const node = new CommandNodeBuilder(CommandType.Draw, 'draw');
        node.setStateSnapshot({
            bindGroups: sourceBindGroups,
            vertexBuffers: sourceVertexBuffers,
        });

        const frozen = node.toNode();

        // Mutate source arrays
        sourceBindGroups.push('bg_2');
        sourceVertexBuffers.push('vb_1');

        // Frozen snapshot must be unaffected
        expect(frozen.bindGroups).toEqual(['bg_0', 'bg_1']);
        expect(frozen.vertexBuffers).toEqual(['vb_0']);
    });

    it('generates unique sequential ids', () => {
        const a = new CommandNodeBuilder(CommandType.Draw, 'draw');
        const b = new CommandNodeBuilder(CommandType.Draw, 'draw');
        const c = new CommandNodeBuilder(CommandType.Draw, 'draw');

        expect(a.id).toBe('cmd_1');
        expect(b.id).toBe('cmd_2');
        expect(c.id).toBe('cmd_3');
    });
});
