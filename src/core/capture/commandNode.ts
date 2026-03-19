import { ICommandNode, CommandType } from '@shared/types';
import { globalIdGenerator } from '@shared/utils';

/**
 * Mutable builder for command tree nodes.
 * During capture, nodes are built bottom-up (draw calls first,
 * then grouped under passes, then under encoders, then under submits).
 */
export class CommandNodeBuilder {
    private _id: string;
    private _type: CommandType;
    private _name: string;
    private _args: Record<string, unknown>;
    private _children: CommandNodeBuilder[] = [];
    private _parent: CommandNodeBuilder | null = null;
    private _timestamp: number;

    // State snapshot at this command
    private _pipelineId?: string;
    private _bindGroups?: string[];
    private _vertexBuffers?: string[];
    private _indexBufferId?: string;
    private _visualOutput?: string;

    constructor(type: CommandType, name: string, args: Record<string, unknown> = {}) {
        this._id = globalIdGenerator.next('cmd');
        this._type = type;
        this._name = name;
        this._args = args;
        this._timestamp = performance.now();
    }

    public addChild(child: CommandNodeBuilder): void {
        child._parent = this;
        this._children.push(child);
    }

    public setStateSnapshot(state: {
        pipelineId?: string;
        bindGroups?: string[];
        vertexBuffers?: string[];
        indexBufferId?: string;
    }): void {
        this._pipelineId = state.pipelineId;
        this._bindGroups = state.bindGroups;
        this._vertexBuffers = state.vertexBuffers;
        this._indexBufferId = state.indexBufferId;
    }

    public setVisualOutput(dataUrl: string): void {
        this._visualOutput = dataUrl;
    }

    /**
     * Freeze this node into an immutable ICommandNode.
     * Children are recursively frozen. Arrays are copied to prevent
     * mutation of the frozen tree through retained builder references.
     */
    public toNode(): ICommandNode {
        return {
            id: this._id,
            type: this._type,
            name: this._name,
            args: this._args,
            children: this._children.map(c => c.toNode()),
            parentId: this._parent?._id ?? null,
            timestamp: this._timestamp,
            pipelineId: this._pipelineId,
            bindGroups: this._bindGroups ? [...this._bindGroups] : undefined,
            vertexBuffers: this._vertexBuffers ? [...this._vertexBuffers] : undefined,
            indexBufferId: this._indexBufferId,
            visualOutput: this._visualOutput,
        };
    }

    // Getters
    public get id(): string { return this._id; }
    public get type(): CommandType { return this._type; }
    public get name(): string { return this._name; }
    public get children(): readonly CommandNodeBuilder[] { return this._children; }
    public get parent(): CommandNodeBuilder | null { return this._parent; }
    public get childCount(): number { return this._children.length; }
}
