import { bench, describe } from 'vitest';
import { CommandTreeBuilder } from '../../src/core/capture/commandTree';
import { CommandType } from '../../src/shared/types';

const COMMANDS_PER_CAPTURE = 10_000;
const DRAW_ARGS = { vertexCount: 3 };

describe('capture command recording', () => {
    bench('record and finalize 10,000 commands', () => {
        const tree = new CommandTreeBuilder();
        tree.pushScope(CommandType.Submit, 'submit');
        tree.pushScope(CommandType.RenderPass, 'beginRenderPass');
        for (let i = 0; i < COMMANDS_PER_CAPTURE; i++) {
            tree.addCommand(CommandType.Draw, 'draw', DRAW_ARGS);
        }
        tree.popScope();
        tree.popScope();
        tree.freeze();
    });
});
