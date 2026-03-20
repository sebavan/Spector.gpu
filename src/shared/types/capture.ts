/**
 * Core capture data types for Spector.GPU.
 *
 * Models the complete state of a single captured WebGPU frame:
 * the command tree, device metadata, resource inventory, and stats.
 */

import type {
    IBindGroupInfo,
    IBindGroupLayoutInfo,
    IBufferInfo,
    IComputePipelineInfo,
    IRenderPipelineInfo,
    ISamplerInfo,
    IShaderModuleInfo,
    ITextureInfo,
    ITextureViewInfo,
} from './resources';

// ─── Command hierarchy ───────────────────────────────────────────────

/** Every intercepted WebGPU method maps to exactly one CommandType. */
export enum CommandType {
    // Structural
    Submit              = 'submit',
    CommandBuffer       = 'commandBuffer',
    RenderPass          = 'renderPass',
    ComputePass         = 'computePass',

    // Draw / dispatch
    Draw                = 'draw',
    Dispatch            = 'dispatch',

    // State-setting
    SetPipeline         = 'setPipeline',
    SetBindGroup        = 'setBindGroup',
    SetVertexBuffer     = 'setVertexBuffer',
    SetIndexBuffer      = 'setIndexBuffer',
    SetViewport         = 'setViewport',
    SetScissorRect      = 'setScissorRect',
    SetBlendConstant    = 'setBlendConstant',
    SetStencilReference = 'setStencilReference',

    // Transfer
    WriteBuffer         = 'writeBuffer',
    WriteTexture        = 'writeTexture',
    CopyBufferToBuffer  = 'copyBufferToBuffer',
    CopyBufferToTexture = 'copyBufferToTexture',
    CopyTextureToBuffer = 'copyTextureToBuffer',
    CopyTextureToTexture = 'copyTextureToTexture',
    ClearBuffer         = 'clearBuffer',
    ResolveQuerySet     = 'resolveQuerySet',

    // Debug
    InsertDebugMarker   = 'insertDebugMarker',
    PushDebugGroup      = 'pushDebugGroup',
    PopDebugGroup       = 'popDebugGroup',

    // Occlusion queries
    BeginOcclusionQuery = 'beginOcclusionQuery',
    EndOcclusionQuery   = 'endOcclusionQuery',

    // Misc
    ExecuteBundles      = 'executeBundles',
    End                 = 'end',
    Other               = 'other',
}

// ─── Command tree ────────────────────────────────────────────────────

/**
 * A single node in the captured command tree.
 *
 * The tree mirrors the WebGPU submission hierarchy:
 *   Submit → CommandBuffer → RenderPass/ComputePass → Draw/Dispatch
 *
 * `children` is always a concrete array (never undefined) to avoid
 * null-checks on every tree traversal.
 */
export interface ICommandNode {
    /** Unique identifier within this capture. */
    readonly id: string;
    readonly type: CommandType;
    /** WebGPU method name, e.g. "draw", "setPipeline". */
    readonly name: string;
    /** Serialized call arguments. Values are JSON-safe primitives. */
    readonly args: Record<string, unknown>;
    /** Ordered child commands (empty array for leaf nodes). */
    readonly children: ICommandNode[];
    /** Parent node id, or null for root-level submits. */
    readonly parentId: string | null;
    /** Monotonic timestamp via performance.now() at intercept time. */
    readonly timestamp: number;

    // ── Snapshot of GPU state at this command ──

    /** Currently bound render/compute pipeline id. */
    readonly pipelineId?: string;
    /** Ids of currently bound bind groups (index = group slot). */
    readonly bindGroups?: readonly string[];
    /** Ids of currently bound vertex buffers (index = slot). */
    readonly vertexBuffers?: readonly string[];
    /** Id of currently bound index buffer. */
    readonly indexBufferId?: string;

    /** Base64 data URL of the visual output at this point (e.g., canvas snapshot after submit). */
    readonly visualOutput?: string;
}

// ─── Top-level capture ───────────────────────────────────────────────

/** Complete snapshot of one captured frame. */
export interface ICapture {
    readonly id: string;
    /** Spector.GPU semver at time of capture. */
    readonly version: string;
    /** Unix-epoch ms when capture started. */
    readonly timestamp: number;
    /** Wall-clock capture duration in ms. */
    readonly duration: number;

    // Device metadata
    readonly adapterInfo: IAdapterInfo;
    readonly deviceDescriptor: Record<string, unknown>;
    readonly deviceLimits: Record<string, number>;
    readonly deviceFeatures: readonly string[];

    /** Root nodes are queue.submit() calls, in submission order. */
    readonly commands: readonly ICommandNode[];

    /** All GPU resources alive during the captured frame. */
    readonly resources: IResourceMap;

    readonly stats: ICaptureStats;
}

/** Mirrors GPUAdapterInfo. */
export interface IAdapterInfo {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly backend: string;
}

/** Aggregate counters derived from the command tree. */
export interface ICaptureStats {
    readonly totalCommands: number;
    readonly drawCalls: number;
    readonly dispatchCalls: number;
    readonly renderPasses: number;
    readonly computePasses: number;
    readonly pipelineCount: number;
    readonly bufferCount: number;
    readonly textureCount: number;
    readonly shaderModuleCount: number;
    readonly bindGroupCount: number;
}

/**
 * Lookup tables for every tracked resource kind.
 *
 * Uses Map<id, Info> for O(1) lookups during tree traversal and UI
 * rendering. Keys are the same string ids referenced by ICommandNode
 * state fields (pipelineId, bindGroups, etc.).
 */
export interface IResourceMap {
    readonly buffers: Map<string, IBufferInfo>;
    readonly textures: Map<string, ITextureInfo>;
    readonly samplers: Map<string, ISamplerInfo>;
    readonly shaderModules: Map<string, IShaderModuleInfo>;
    readonly renderPipelines: Map<string, IRenderPipelineInfo>;
    readonly computePipelines: Map<string, IComputePipelineInfo>;
    readonly bindGroups: Map<string, IBindGroupInfo>;
    readonly bindGroupLayouts: Map<string, IBindGroupLayoutInfo>;
    readonly textureViews: Map<string, ITextureViewInfo>;
}
