import { CommandNodeBuilder } from './commandNode';
import { CommandType, ICommandNode, ICaptureStats } from '@shared/types';

/**
 * Builds the command tree for a single frame capture.
 *
 * Usage during capture:
 *   1. pushScope(Submit) — when queue.submit() is called
 *   2. pushScope(RenderPass) — when beginRenderPass() is called
 *   3. addCommand(Draw, 'draw', args) — when draw() is called
 *   4. popScope() — when pass.end() is called
 *   5. popScope() — when submit completes
 *   6. freeze() — get immutable command tree
 */
export class CommandTreeBuilder {
    private _roots: CommandNodeBuilder[] = [];
    private _scopeStack: CommandNodeBuilder[] = [];
    private _totalCommands = 0;
    private _drawCalls = 0;
    private _dispatchCalls = 0;
    private _renderPasses = 0;
    private _computePasses = 0;

    /**
     * Push a new scope onto the tree (submit, render pass, compute pass, etc.)
     * Returns the created node for state tracking.
     */
    public pushScope(type: CommandType, name: string, args: Record<string, unknown> = {}): CommandNodeBuilder {
        const node = new CommandNodeBuilder(type, name, args);
        this._totalCommands++;

        if (type === CommandType.RenderPass) this._renderPasses++;
        if (type === CommandType.ComputePass) this._computePasses++;

        const parent = this._currentScope;
        if (parent) {
            parent.addChild(node);
        } else {
            this._roots.push(node);
        }
        this._scopeStack.push(node);
        return node;
    }

    /**
     * Pop the current scope (e.g., when pass.end() or submit completes).
     */
    public popScope(): CommandNodeBuilder | undefined {
        return this._scopeStack.pop();
    }

    /**
     * Add a leaf command to the current scope.
     */
    public addCommand(type: CommandType, name: string, args: Record<string, unknown> = {}): CommandNodeBuilder {
        const node = new CommandNodeBuilder(type, name, args);
        this._totalCommands++;

        if (type === CommandType.Draw) this._drawCalls++;
        if (type === CommandType.Dispatch) this._dispatchCalls++;

        const parent = this._currentScope;
        if (parent) {
            parent.addChild(node);
        } else {
            this._roots.push(node);
        }
        return node;
    }

    /**
     * Get the current scope (top of stack).
     */
    public get currentScope(): CommandNodeBuilder | null {
        return this._currentScope;
    }

    private get _currentScope(): CommandNodeBuilder | null {
        return this._scopeStack.length > 0
            ? this._scopeStack[this._scopeStack.length - 1]
            : null;
    }

    /**
     * Freeze the tree into immutable ICommandNode array.
     */
    public freeze(): ICommandNode[] {
        return this._roots.map(r => r.toNode());
    }

    /**
     * Get capture statistics.
     */
    public getStats(): Pick<ICaptureStats, 'totalCommands' | 'drawCalls' | 'dispatchCalls' | 'renderPasses' | 'computePasses'> {
        return {
            totalCommands: this._totalCommands,
            drawCalls: this._drawCalls,
            dispatchCalls: this._dispatchCalls,
            renderPasses: this._renderPasses,
            computePasses: this._computePasses,
        };
    }

    /**
     * Reset the tree for a new capture.
     */
    public reset(): void {
        this._roots = [];
        this._scopeStack = [];
        this._totalCommands = 0;
        this._drawCalls = 0;
        this._dispatchCalls = 0;
        this._renderPasses = 0;
        this._computePasses = 0;
    }

    public get rootCount(): number {
        return this._roots.length;
    }

    public get depth(): number {
        return this._scopeStack.length;
    }
}
