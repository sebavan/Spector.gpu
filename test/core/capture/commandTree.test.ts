import { describe, it, expect, beforeEach } from 'vitest';
import { CommandTreeBuilder } from '../../../src/core/capture/commandTree';
import { CommandType } from '../../../src/shared/types';
import { globalIdGenerator } from '../../../src/shared/utils';

describe('CommandTreeBuilder', () => {
    let tree: CommandTreeBuilder;

    beforeEach(() => {
        globalIdGenerator.reset();
        tree = new CommandTreeBuilder();
    });

    it('pushScope/popScope creates proper nesting', () => {
        const submit = tree.pushScope(CommandType.Submit, 'submit');
        const pass = tree.pushScope(CommandType.RenderPass, 'beginRenderPass');

        expect(tree.depth).toBe(2);
        expect(tree.currentScope).toBe(pass);

        const popped = tree.popScope();
        expect(popped).toBe(pass);
        expect(tree.depth).toBe(1);
        expect(tree.currentScope).toBe(submit);

        tree.popScope();
        expect(tree.depth).toBe(0);
        expect(tree.currentScope).toBeNull();
    });

    it('addCommand adds leaf to current scope', () => {
        tree.pushScope(CommandType.Submit, 'submit');
        tree.pushScope(CommandType.RenderPass, 'beginRenderPass');

        const draw = tree.addCommand(CommandType.Draw, 'draw', { vertexCount: 3 });

        // draw should be a child of the render pass
        const frozen = tree.freeze();
        const submitNode = frozen[0];
        const passNode = submitNode.children[0];
        expect(passNode.children).toHaveLength(1);
        expect(passNode.children[0].type).toBe(CommandType.Draw);
        expect(passNode.children[0].id).toBe(draw.id);
    });

    it('commands at root level (no scope) become root nodes', () => {
        tree.addCommand(CommandType.WriteBuffer, 'writeBuffer', { offset: 0 });
        tree.addCommand(CommandType.WriteTexture, 'writeTexture');

        expect(tree.rootCount).toBe(2);

        const frozen = tree.freeze();
        expect(frozen).toHaveLength(2);
        expect(frozen[0].type).toBe(CommandType.WriteBuffer);
        expect(frozen[0].parentId).toBeNull();
        expect(frozen[1].type).toBe(CommandType.WriteTexture);
        expect(frozen[1].parentId).toBeNull();
    });

    it('stats are counted correctly', () => {
        tree.pushScope(CommandType.Submit, 'submit');
        tree.pushScope(CommandType.RenderPass, 'beginRenderPass');
        tree.addCommand(CommandType.Draw, 'draw');
        tree.addCommand(CommandType.Draw, 'drawIndexed');
        tree.addCommand(CommandType.SetPipeline, 'setPipeline');
        tree.popScope();
        tree.pushScope(CommandType.ComputePass, 'beginComputePass');
        tree.addCommand(CommandType.Dispatch, 'dispatchWorkgroups');
        tree.popScope();
        tree.popScope();

        const stats = tree.getStats();
        // submit(1) + renderPass(1) + draw(1) + drawIndexed(1) + setPipeline(1) + computePass(1) + dispatch(1) = 7
        expect(stats.totalCommands).toBe(7);
        expect(stats.drawCalls).toBe(2);
        expect(stats.dispatchCalls).toBe(1);
        expect(stats.renderPasses).toBe(1);
        expect(stats.computePasses).toBe(1);
    });

    it('freeze() produces immutable snapshot unaffected by later mutations', () => {
        tree.pushScope(CommandType.Submit, 'submit');
        tree.addCommand(CommandType.Draw, 'draw');
        tree.popScope();

        const frozen = tree.freeze();
        expect(frozen).toHaveLength(1);
        expect(frozen[0].children).toHaveLength(1);

        // Add more commands after freeze
        tree.pushScope(CommandType.Submit, 'submit2');
        tree.addCommand(CommandType.Draw, 'draw2');
        tree.popScope();

        // Frozen snapshot must be unaffected
        expect(frozen).toHaveLength(1);
        expect(frozen[0].children).toHaveLength(1);
    });

    it('reset() clears everything', () => {
        tree.pushScope(CommandType.Submit, 'submit');
        tree.addCommand(CommandType.Draw, 'draw');
        tree.popScope();

        tree.reset();

        expect(tree.rootCount).toBe(0);
        expect(tree.depth).toBe(0);
        expect(tree.currentScope).toBeNull();

        const stats = tree.getStats();
        expect(stats.totalCommands).toBe(0);
        expect(stats.drawCalls).toBe(0);
        expect(stats.dispatchCalls).toBe(0);
        expect(stats.renderPasses).toBe(0);
        expect(stats.computePasses).toBe(0);

        expect(tree.freeze()).toEqual([]);
    });

    it('complex scenario: 2 submits with render passes, draws, and state changes', () => {
        // Submit 1: render pass with 2 draws
        tree.pushScope(CommandType.Submit, 'submit');
        tree.pushScope(CommandType.RenderPass, 'beginRenderPass');

        tree.addCommand(CommandType.SetPipeline, 'setPipeline', { pipelineId: 'pipe_a' });
        tree.addCommand(CommandType.SetBindGroup, 'setBindGroup', { index: 0 });
        tree.addCommand(CommandType.SetVertexBuffer, 'setVertexBuffer', { slot: 0 });
        const draw1 = tree.addCommand(CommandType.Draw, 'draw', { vertexCount: 36 });
        draw1.setStateSnapshot({
            pipelineId: 'pipe_a',
            bindGroups: ['bg_0'],
            vertexBuffers: ['vb_0'],
        });

        tree.addCommand(CommandType.SetPipeline, 'setPipeline', { pipelineId: 'pipe_b' });
        const draw2 = tree.addCommand(CommandType.Draw, 'drawIndexed', { indexCount: 12 });
        draw2.setStateSnapshot({
            pipelineId: 'pipe_b',
            bindGroups: ['bg_0'],
            vertexBuffers: ['vb_0'],
            indexBufferId: 'ib_0',
        });

        tree.popScope(); // end render pass
        tree.popScope(); // end submit 1

        // Submit 2: compute pass with 1 dispatch
        tree.pushScope(CommandType.Submit, 'submit');
        tree.pushScope(CommandType.ComputePass, 'beginComputePass');
        tree.addCommand(CommandType.SetPipeline, 'setPipeline', { pipelineId: 'comp_pipe' });
        tree.addCommand(CommandType.Dispatch, 'dispatchWorkgroups', { x: 64, y: 1, z: 1 });
        tree.popScope(); // end compute pass
        tree.popScope(); // end submit 2

        // Validate structure
        const frozen = tree.freeze();
        expect(frozen).toHaveLength(2);

        // Submit 1
        const s1 = frozen[0];
        expect(s1.type).toBe(CommandType.Submit);
        expect(s1.children).toHaveLength(1);

        const rp = s1.children[0];
        expect(rp.type).toBe(CommandType.RenderPass);
        expect(rp.children).toHaveLength(6); // setPipeline, setBindGroup, setVertexBuffer, draw, setPipeline, drawIndexed

        // Verify draw state snapshots
        const drawNode1 = rp.children[3];
        expect(drawNode1.type).toBe(CommandType.Draw);
        expect(drawNode1.pipelineId).toBe('pipe_a');
        expect(drawNode1.bindGroups).toEqual(['bg_0']);
        expect(drawNode1.vertexBuffers).toEqual(['vb_0']);
        expect(drawNode1.indexBufferId).toBeUndefined();

        const drawNode2 = rp.children[5];
        expect(drawNode2.type).toBe(CommandType.Draw);
        expect(drawNode2.pipelineId).toBe('pipe_b');
        expect(drawNode2.indexBufferId).toBe('ib_0');

        // Submit 2
        const s2 = frozen[1];
        expect(s2.children).toHaveLength(1);
        const cp = s2.children[0];
        expect(cp.type).toBe(CommandType.ComputePass);
        expect(cp.children).toHaveLength(2);

        // Stats
        const stats = tree.getStats();
        // 2 submits + 1 renderPass + 1 computePass + 3 setPipeline + 1 setBindGroup + 1 setVertexBuffer + 2 draws + 1 dispatch = 12
        expect(stats.totalCommands).toBe(12);
        expect(stats.drawCalls).toBe(2);
        expect(stats.dispatchCalls).toBe(1);
        expect(stats.renderPasses).toBe(1);
        expect(stats.computePasses).toBe(1);
    });

    it('popScope on empty stack returns undefined and does not crash', () => {
        const result = tree.popScope();
        expect(result).toBeUndefined();
        expect(tree.depth).toBe(0);

        // Should still be usable after bad pop
        tree.pushScope(CommandType.Submit, 'submit');
        expect(tree.depth).toBe(1);
    });

    it('parentId chain is correct through the full hierarchy', () => {
        tree.pushScope(CommandType.Submit, 'submit');
        tree.pushScope(CommandType.RenderPass, 'beginRenderPass');
        tree.addCommand(CommandType.Draw, 'draw');
        tree.popScope();
        tree.popScope();

        const frozen = tree.freeze();
        const submit = frozen[0];
        const pass = submit.children[0];
        const draw = pass.children[0];

        expect(submit.parentId).toBeNull();
        expect(pass.parentId).toBe(submit.id);
        expect(draw.parentId).toBe(pass.id);
    });
});
