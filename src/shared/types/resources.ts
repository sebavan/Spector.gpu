/**
 * Resource info types for SpectorGPU.
 *
 * Each interface models the serialized descriptor + runtime state of a
 * single WebGPU resource. All resource types carry `id` (unique within
 * capture) and optional `label` (user-provided debug name).
 *
 * Numeric flag fields (usage, visibility, writeMask) are stored as raw
 * bitmasks — the UI layer is responsible for decoding them.
 */

// ─── Buffer ──────────────────────────────────────────────────────────

export type BufferState = 'unmapped' | 'mapped' | 'mapping-pending' | 'destroyed';

export interface IBufferInfo {
    readonly id: string;
    readonly label?: string;
    /** Byte length. */
    readonly size: number;
    /** GPUBufferUsageFlags bitmask. */
    readonly usage: number;
    readonly mappedAtCreation: boolean;
    readonly state: BufferState;
}

// ─── Texture / TextureView ───────────────────────────────────────────

export interface ITextureSize {
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
}

export type TextureDimension = '1d' | '2d' | '3d';

export interface ITextureInfo {
    readonly id: string;
    readonly label?: string;
    readonly size: ITextureSize;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    /** GPUTextureDimension. */
    readonly dimension: TextureDimension;
    /** GPUTextureFormat string, e.g. "rgba8unorm". */
    readonly format: string;
    /** GPUTextureUsageFlags bitmask. */
    readonly usage: number;
    /** Base64 data-URL preview; populated only after readback. */
    readonly previewDataUrl?: string;
}

export interface ITextureViewInfo {
    readonly id: string;
    readonly label?: string;
    /** Id of the parent ITextureInfo. */
    readonly textureId: string;
    readonly format: string;
    readonly dimension: string;
    readonly baseMipLevel: number;
    readonly mipLevelCount: number;
    readonly baseArrayLayer: number;
    readonly arrayLayerCount: number;
    /** "all" | "depth-only" | "stencil-only". */
    readonly aspect: string;
}

// ─── Sampler ─────────────────────────────────────────────────────────

export interface ISamplerInfo {
    readonly id: string;
    readonly label?: string;
    readonly addressModeU: string;
    readonly addressModeV: string;
    readonly addressModeW: string;
    readonly magFilter: string;
    readonly minFilter: string;
    readonly mipmapFilter: string;
    readonly lodMinClamp: number;
    readonly lodMaxClamp: number;
    readonly compare?: string;
    readonly maxAnisotropy: number;
}

// ─── Shader module ───────────────────────────────────────────────────

export type CompilationMessageType = 'error' | 'warning' | 'info';

export interface ICompilationMessage {
    readonly message: string;
    readonly type: CompilationMessageType;
    /** 1-based line number in the WGSL source. */
    readonly lineNum: number;
    /** 1-based column offset within the line. */
    readonly linePos: number;
}

export interface IShaderModuleInfo {
    readonly id: string;
    readonly label?: string;
    /** Full WGSL source text. */
    readonly code: string;
    readonly compilationInfo?: readonly ICompilationMessage[];
}

// ─── Render pipeline ─────────────────────────────────────────────────

export interface IVertexAttribute {
    /** GPUVertexFormat string, e.g. "float32x4". */
    readonly format: string;
    /** Byte offset within the vertex buffer stride. */
    readonly offset: number;
    /** Attribute location consumed by the vertex shader. */
    readonly shaderLocation: number;
}

export interface IVertexBufferLayout {
    /** Byte stride between consecutive vertices. */
    readonly arrayStride: number;
    /** "vertex" | "instance". */
    readonly stepMode?: string;
    readonly attributes: readonly IVertexAttribute[];
}

export interface IBlendComponent {
    readonly operation?: string;
    readonly srcFactor?: string;
    readonly dstFactor?: string;
}

export interface IColorTargetState {
    readonly format: string;
    readonly blend?: {
        readonly color: IBlendComponent;
        readonly alpha: IBlendComponent;
    };
    /** GPUColorWriteFlags bitmask. */
    readonly writeMask?: number;
}

export interface IStencilFaceState {
    readonly compare?: string;
    readonly failOp?: string;
    readonly depthFailOp?: string;
    readonly passOp?: string;
}

export interface IRenderPipelineInfo {
    readonly id: string;
    readonly label?: string;
    /** Bind group layout id, or the literal string "auto". */
    readonly layout: string | 'auto';
    readonly vertex: {
        readonly moduleId: string;
        readonly entryPoint?: string;
        readonly buffers?: readonly IVertexBufferLayout[];
        readonly constants?: Record<string, number>;
    };
    readonly fragment?: {
        readonly moduleId: string;
        readonly entryPoint?: string;
        readonly targets: readonly IColorTargetState[];
        readonly constants?: Record<string, number>;
    };
    readonly primitive?: {
        readonly topology?: string;
        readonly stripIndexFormat?: string;
        readonly frontFace?: string;
        readonly cullMode?: string;
        readonly unclippedDepth?: boolean;
    };
    readonly depthStencil?: {
        readonly format: string;
        readonly depthWriteEnabled?: boolean;
        readonly depthCompare?: string;
        readonly stencilFront?: IStencilFaceState;
        readonly stencilBack?: IStencilFaceState;
        readonly stencilReadMask?: number;
        readonly stencilWriteMask?: number;
        readonly depthBias?: number;
        readonly depthBiasSlopeScale?: number;
        readonly depthBiasClamp?: number;
    };
    readonly multisample?: {
        readonly count?: number;
        readonly mask?: number;
        readonly alphaToCoverageEnabled?: boolean;
    };
}

// ─── Compute pipeline ────────────────────────────────────────────────

export interface IComputePipelineInfo {
    readonly id: string;
    readonly label?: string;
    readonly layout: string | 'auto';
    readonly compute: {
        readonly moduleId: string;
        readonly entryPoint?: string;
        readonly constants?: Record<string, number>;
    };
}

// ─── Bind group / layout ─────────────────────────────────────────────

export type BindGroupResourceType = 'buffer' | 'sampler' | 'textureView' | 'externalTexture';

export interface IBindGroupEntry {
    readonly binding: number;
    readonly resourceType: BindGroupResourceType;
    /** Id of the bound resource (IBufferInfo, ISamplerInfo, etc.). */
    readonly resourceId: string;
    /** Buffer binding offset in bytes (buffer resources only). */
    readonly offset?: number;
    /** Buffer binding size in bytes (buffer resources only). */
    readonly size?: number;
}

export interface IBindGroupInfo {
    readonly id: string;
    readonly label?: string;
    /** Id of the associated IBindGroupLayoutInfo. */
    readonly layoutId: string;
    readonly entries: readonly IBindGroupEntry[];
}

export type BindGroupLayoutEntryType =
    | 'buffer'
    | 'sampler'
    | 'texture'
    | 'storageTexture'
    | 'externalTexture';

export interface IBindGroupLayoutEntry {
    readonly binding: number;
    /** GPUShaderStageFlags bitmask. */
    readonly visibility: number;
    readonly type: BindGroupLayoutEntryType;
    /**
     * Type-specific descriptor fields.
     * The shape depends on `type` — e.g. for 'buffer' this holds
     * { type, hasDynamicOffset, minBindingSize }.
     */
    readonly descriptor: Record<string, unknown>;
}

export interface IBindGroupLayoutInfo {
    readonly id: string;
    readonly label?: string;
    readonly entries: readonly IBindGroupLayoutEntry[];
}

// ─── Render pass descriptors ─────────────────────────────────────────

export interface IClearColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface IColorAttachment {
    readonly viewId: string;
    readonly resolveTargetId?: string;
    readonly loadOp: string;
    readonly storeOp: string;
    readonly clearValue?: IClearColor;
}

export interface IDepthStencilAttachment {
    readonly viewId: string;
    readonly depthLoadOp?: string;
    readonly depthStoreOp?: string;
    readonly depthClearValue?: number;
    readonly depthReadOnly?: boolean;
    readonly stencilLoadOp?: string;
    readonly stencilStoreOp?: string;
    readonly stencilClearValue?: number;
    readonly stencilReadOnly?: boolean;
}

export interface IRenderPassInfo {
    readonly colorAttachments: readonly IColorAttachment[];
    readonly depthStencilAttachment?: IDepthStencilAttachment;
    readonly occlusionQuerySet?: string;
    readonly label?: string;
    readonly maxDrawCount?: number;
}
