# Spector.GPU — Type System Reference

Complete type definitions that form the contract between the capture engine,
storage layer, and result viewer UI. Regenerating the codebase requires
implementing these types exactly.

## Capture Types (`src/shared/types/capture.ts`)

### CommandType enum
```typescript
export const CommandType = {
    Submit: 'submit',
    RenderPass: 'renderPass',
    ComputePass: 'computePass',
    Draw: 'draw',
    Dispatch: 'dispatch',
    SetPipeline: 'setPipeline',
    SetBindGroup: 'setBindGroup',
    SetVertexBuffer: 'setVertexBuffer',
    SetIndexBuffer: 'setIndexBuffer',
    SetViewport: 'setViewport',
    SetScissorRect: 'setScissorRect',
    SetBlendConstant: 'setBlendConstant',
    SetStencilReference: 'setStencilReference',
    WriteBuffer: 'writeBuffer',
    WriteTexture: 'writeTexture',
    CopyBufferToBuffer: 'copyBufferToBuffer',
    CopyBufferToTexture: 'copyBufferToTexture',
    CopyTextureToBuffer: 'copyTextureToBuffer',
    CopyTextureToTexture: 'copyTextureToTexture',
    ClearBuffer: 'clearBuffer',
    ResolveQuerySet: 'resolveQuerySet',
    InsertDebugMarker: 'insertDebugMarker',
    PushDebugGroup: 'pushDebugGroup',
    PopDebugGroup: 'popDebugGroup',
    BeginOcclusionQuery: 'beginOcclusionQuery',
    EndOcclusionQuery: 'endOcclusionQuery',
    ExecuteBundles: 'executeBundles',
    End: 'end',
    Other: 'other',
} as const;
```

### ICommandNode
```typescript
export interface ICommandNode {
    readonly id: string;
    readonly type: CommandType;
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly children: ICommandNode[];
    readonly parentId: string | null;
    readonly timestamp: number;
    // GPU state snapshot at this command
    readonly pipelineId?: string;
    readonly bindGroups?: readonly string[];
    readonly vertexBuffers?: readonly string[];
    readonly indexBufferId?: string;
    readonly visualOutput?: string; // base64 data URL screenshot
}
```

### IAdapterInfo
```typescript
export interface IAdapterInfo {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly backend: string;
}
```

### ICaptureStats
```typescript
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
```

### ICapture
```typescript
export interface ICapture {
    readonly id: string;
    readonly version: string;
    readonly timestamp: number;
    readonly duration: number;
    readonly adapterInfo: IAdapterInfo;
    readonly deviceDescriptor: Record<string, unknown>;
    readonly deviceLimits: Record<string, number>;
    readonly deviceFeatures: string[];
    readonly commands: readonly ICommandNode[];
    readonly resources: IResourceMap;
    readonly stats: ICaptureStats;
}
```

## Resource Types (`src/shared/types/resources.ts`)

### IBufferInfo
```typescript
export type BufferState = 'unmapped' | 'mapped' | 'mapping-pending' | 'destroyed';

export interface IBufferInfo {
    readonly id: string;
    readonly label?: string;
    readonly size: number;
    readonly usage: number; // GPUBufferUsageFlags bitmask
    readonly mappedAtCreation: boolean;
    readonly state: BufferState;
    readonly dataBase64?: string; // base64-encoded buffer contents after readback
}
```

### ITextureInfo
```typescript
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
    readonly dimension: TextureDimension;
    readonly format: string;
    readonly usage: number; // GPUTextureUsageFlags bitmask
    readonly isCanvasTexture?: boolean;
    readonly previewDataUrl?: string;
    readonly facePreviewUrls?: readonly string[]; // 6 entries for cubemaps
}
```

### ITextureViewInfo
```typescript
export interface ITextureViewInfo {
    readonly id: string;
    readonly label?: string;
    readonly textureId: string; // parent texture ID
    readonly format: string;
    readonly dimension: string;
    readonly baseMipLevel: number;
    readonly mipLevelCount: number;
    readonly baseArrayLayer: number;
    readonly arrayLayerCount: number;
    readonly aspect: string; // "all" | "depth-only" | "stencil-only"
}
```

### Pipeline Types
```typescript
export interface IVertexAttribute {
    readonly format: string; // e.g. "float32x4"
    readonly offset: number;
    readonly shaderLocation: number;
}

export interface IVertexBufferLayout {
    readonly arrayStride: number;
    readonly stepMode?: string;
    readonly attributes: readonly IVertexAttribute[];
}

export interface IColorTargetState {
    readonly format: string;
    readonly blend?: { readonly color: IBlendComponent; readonly alpha: IBlendComponent; };
    readonly writeMask?: number;
}

export interface IRenderPipelineInfo {
    readonly id: string;
    readonly label?: string;
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
    readonly primitive?: { topology?: string; frontFace?: string; cullMode?: string; };
    readonly depthStencil?: { format: string; depthWriteEnabled?: boolean; depthCompare?: string; };
    readonly multisample?: { count?: number; mask?: number; alphaToCoverageEnabled?: boolean; };
}

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
```

### Bind Group Types
```typescript
export type BindGroupResourceType = 'buffer' | 'sampler' | 'textureView' | 'externalTexture';

export interface IBindGroupEntry {
    readonly binding: number;
    readonly resourceType: BindGroupResourceType;
    readonly resourceId: string;
    readonly offset?: number;
    readonly size?: number;
}

export interface IBindGroupInfo {
    readonly id: string;
    readonly label?: string;
    readonly layoutId: string;
    readonly entries: readonly IBindGroupEntry[];
}
```

### Other Resource Types
```typescript
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

export interface IShaderModuleInfo {
    readonly id: string;
    readonly label?: string;
    readonly code: string; // full WGSL source
    readonly compilationInfo?: readonly ICompilationMessage[];
}

export interface ICompilationMessage {
    readonly message: string;
    readonly type: 'error' | 'warning' | 'info';
    readonly lineNum: number;
    readonly linePos: number;
}
```

### IResourceMap
```typescript
export interface IResourceMap {
    readonly buffers: Map<string, IBufferInfo>;
    readonly textures: Map<string, ITextureInfo>;
    readonly textureViews: Map<string, ITextureViewInfo>;
    readonly samplers: Map<string, ISamplerInfo>;
    readonly shaderModules: Map<string, IShaderModuleInfo>;
    readonly renderPipelines: Map<string, IRenderPipelineInfo>;
    readonly computePipelines: Map<string, IComputePipelineInfo>;
    readonly bindGroups: Map<string, IBindGroupInfo>;
    readonly bindGroupLayouts: Map<string, IBindGroupLayoutInfo>;
}
```

## Message Types (`src/shared/types/messages.ts`)

```typescript
export const MessageType = {
    WEBGPU_DETECTED: 'WEBGPU_DETECTED',
    WEBGPU_NOT_DETECTED: 'WEBGPU_NOT_DETECTED',
    START_CAPTURE: 'START_CAPTURE',
    STOP_CAPTURE: 'STOP_CAPTURE',
    CAPTURE_REQUEST: 'CAPTURE_REQUEST',
    CAPTURE_COMPLETE: 'CAPTURE_COMPLETE',
    CAPTURE_ERROR: 'CAPTURE_ERROR',
    CAPTURE_DATA: 'CAPTURE_DATA',
    STATUS_QUERY: 'STATUS_QUERY',
    STATUS_RESPONSE: 'STATUS_RESPONSE',
} as const;
```

Messages are routed: Content Script (MAIN) → window.postMessage → Content Script Proxy (ISOLATED) → chrome.runtime.sendMessage → Background → popup/result viewer.

## Constants (`src/shared/constants.ts`)

```typescript
export const SPECTOR_GPU_VERSION = '0.1.0';
export const STORAGE_KEY_PREFIX = 'spectorGpu_capture_';
export const MAX_COMMAND_COUNT = 50_000;
export const CAPTURE_TIMEOUT_MS = 30_000;
```

## Usage Flag Bitmasks

### GPUBufferUsageFlags
| Bit | Value | Name |
|-----|-------|------|
| 0 | 0x0001 | MAP_READ |
| 1 | 0x0002 | MAP_WRITE |
| 2 | 0x0004 | COPY_SRC |
| 3 | 0x0008 | COPY_DST |
| 4 | 0x0010 | INDEX |
| 5 | 0x0020 | VERTEX |
| 6 | 0x0040 | UNIFORM |
| 7 | 0x0080 | STORAGE |
| 8 | 0x0100 | INDIRECT |
| 9 | 0x0200 | QUERY_RESOLVE |

### GPUTextureUsageFlags
| Bit | Value | Name |
|-----|-------|------|
| 0 | 0x01 | COPY_SRC |
| 1 | 0x02 | COPY_DST |
| 2 | 0x04 | TEXTURE_BINDING |
| 3 | 0x08 | STORAGE_BINDING |
| 4 | 0x10 | RENDER_ATTACHMENT |
