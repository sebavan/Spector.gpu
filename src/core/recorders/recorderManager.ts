import type {
    IResourceMap,
    IBufferInfo,
    ITextureInfo,
    ITextureViewInfo,
    ISamplerInfo,
    IShaderModuleInfo,
    IRenderPipelineInfo,
    IComputePipelineInfo,
    IBindGroupInfo,
    IBindGroupLayoutInfo,
    IBindGroupEntry,
    IBindGroupLayoutEntry,
    ICaptureStats,
    BufferState,
    BindGroupResourceType,
    BindGroupLayoutEntryType,
} from '@shared/types';
import { globalIdGenerator } from '@shared/utils';
import { serializeDescriptor } from '@shared/utils/serialization';

/**
 * Manages the lifecycle tracking of all GPU resources.
 * Always active (passive mode) — records create/destroy.
 * During capture, provides a snapshot of all live resources.
 *
 * Invariants:
 *  - Every tracked object has exactly one ID (idempotent via WeakMap).
 *  - Resource info objects are never mutated in-place after storage;
 *    state changes produce a new object (enables zero-cost snapshots).
 *  - WeakMap keys allow GC of destroyed GPU objects.
 */
export class RecorderManager {
    /** Object → tracking ID. WeakMap so GC of GPU objects is not blocked. */
    private _objectIds = new WeakMap<object, string>();
    /** Tracking ID → object (weak). Reverse lookup for readback. */
    private _idToObject = new Map<string, WeakRef<object>>();

    // Live resource inventories — keyed by tracking ID.
    private _buffers = new Map<string, IBufferInfo>();
    private _textures = new Map<string, ITextureInfo>();
    private _textureViews = new Map<string, ITextureViewInfo>();
    private _samplers = new Map<string, ISamplerInfo>();
    private _shaderModules = new Map<string, IShaderModuleInfo>();
    private _renderPipelines = new Map<string, IRenderPipelineInfo>();
    private _computePipelines = new Map<string, IComputePipelineInfo>();
    private _bindGroups = new Map<string, IBindGroupInfo>();
    private _bindGroupLayouts = new Map<string, IBindGroupLayoutInfo>();
    private _destroyedTextures = new Set<string>();
    private _lastCanvasTextureId: string | null = null;
    private _destroyedBuffers = new Set<string>();

    // ─── Object ID tracking ──────────────────────────────────────────

    /**
     * Assign a tracking ID to a GPU object. Idempotent — returns the
     * existing ID if the object was already tracked.
     */
    public trackObject(obj: object, prefix: string): string {
        let id = this._objectIds.get(obj);
        if (id === undefined) {
            id = globalIdGenerator.next(prefix);
            this._objectIds.set(obj, id);
            this._idToObject.set(id, new WeakRef(obj));
        }
        return id;
    }

    /** Get the tracking ID for a GPU object (undefined if not tracked). */
    public getId(obj: object): string | undefined {
        return this._objectIds.get(obj);
    }

    /** Resolve a tracking ID back to the GPU object (may return undefined if GC'd). */
    public getObject(id: string): object | undefined {
        const ref = this._idToObject.get(id);
        return ref?.deref();
    }

    /** Get a read-only view of all tracked textures. */
    public getTextures(): ReadonlyMap<string, ITextureInfo> {
        return this._textures;
    }

    /** Get a read-only view of all tracked buffers. */
    public getBuffers(): ReadonlyMap<string, IBufferInfo> {
        return this._buffers;
    }

    /** Update a buffer info with readback data. */
    public setBufferData(bufferId: string, dataBase64: string): void {
        const info = this._buffers.get(bufferId);
        if (info) {
            this._buffers.set(bufferId, { ...info, dataBase64 });
        }
    }

    /** Update a texture info with a readback preview image. */
    public setTexturePreview(textureId: string, dataUrl: string): void {
        const info = this._textures.get(textureId);
        if (info) {
            this._textures.set(textureId, { ...info, previewDataUrl: dataUrl });
        }
    }

    /** Set per-face preview URLs for a cube texture. */
    public setTextureFacePreviews(textureId: string, faceUrls: string[]): void {
        const info = this._textures.get(textureId);
        if (info) {
            this._textures.set(textureId, { ...info, facePreviewUrls: faceUrls });
        }
    }

    /**
     * Safely resolve a value to a tracking ID. Guards against non-object
     * values (strings like 'auto', undefined, null) that would throw on
     * WeakMap.get().
     */
    private _resolveId(value: unknown, fallback: string = 'unknown'): string {
        if (typeof value !== 'object' || value === null) return fallback;
        return this._objectIds.get(value) ?? fallback;
    }

    // ─── Buffer ──────────────────────────────────────────────────────

    public recordBufferCreation(buffer: object, descriptor: any): string {
        const id = this.trackObject(buffer, 'buf');
        this._buffers.set(id, {
            id,
            label: descriptor.label,
            size: descriptor.size,
            usage: descriptor.usage,
            mappedAtCreation: descriptor.mappedAtCreation ?? false,
            state: descriptor.mappedAtCreation ? 'mapped' : 'unmapped',
        });
        return id;
    }

    /**
     * Update a buffer's lifecycle state. Creates a new info object
     * (replace-not-mutate) so that prior snapshots are not affected.
     */
    public updateBufferState(buffer: object, state: BufferState): void {
        const id = this._objectIds.get(buffer);
        if (id === undefined) return;
        const info = this._buffers.get(id);
        if (info) {
            this._buffers.set(id, { ...info, state });
        }
    }

    public recordBufferDestroy(buffer: object): void {
        const id = this._objectIds.get(buffer);
        if (id) {
            this._destroyedBuffers.add(id);
        }
        this.updateBufferState(buffer, 'destroyed');
    }

    /** Check if a buffer has been destroyed. */
    public isBufferDestroyed(bufferId: string): boolean {
        return this._destroyedBuffers.has(bufferId);
    }

    // ─── Texture ─────────────────────────────────────────────────────

    public recordTextureCreation(texture: object, descriptor: any): string {
        const id = this.trackObject(texture, 'tex');
        const size = descriptor.size;
        this._textures.set(id, {
            id,
            label: descriptor.label,
            size: typeof size === 'object' && size !== null
                ? {
                    width: size.width ?? size[0] ?? 1,
                    height: size.height ?? size[1] ?? 1,
                    depthOrArrayLayers: size.depthOrArrayLayers ?? size[2] ?? 1,
                }
                : { width: size as number, height: 1, depthOrArrayLayers: 1 },
            mipLevelCount: descriptor.mipLevelCount ?? 1,
            sampleCount: descriptor.sampleCount ?? 1,
            dimension: descriptor.dimension ?? '2d',
            format: descriptor.format,
            usage: descriptor.usage,
        });
        return id;
    }

    /**
     * Record a canvas texture obtained via GPUCanvasContext.getCurrentTexture().
     * These bypass device.createTexture() and would otherwise be invisible.
     * Idempotent per object. Only keeps the LATEST canvas texture — removes
     * previous ones to prevent unbounded accumulation (one new texture per frame).
     */
    public recordCanvasTexture(texture: object, format: string, width: number, height: number): string {
        const existingId = this._objectIds.get(texture);
        if (existingId !== undefined) return existingId;

        // Remove previous canvas texture entries — only keep the latest.
        if (this._lastCanvasTextureId) {
            this._textures.delete(this._lastCanvasTextureId);
            this._idToObject.delete(this._lastCanvasTextureId);
        }

        const id = this.trackObject(texture, 'tex');
        this._textures.set(id, {
            id,
            label: 'Canvas Texture',
            size: { width, height, depthOrArrayLayers: 1 },
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            format,
            usage: 0x10, // RENDER_ATTACHMENT (at minimum)
            isCanvasTexture: true,
        });
        this._lastCanvasTextureId = id;
        return id;
    }

    public recordTextureDestroy(texture: object): void {
        // Mark as destroyed so readback can skip it, but keep the info
        // because captures, texture views, and bind groups may still reference it.
        const id = this._objectIds.get(texture);
        if (id) {
            this._destroyedTextures.add(id);
        }
    }

    /** Check if a texture has been destroyed. */
    public isTextureDestroyed(textureId: string): boolean {
        return this._destroyedTextures.has(textureId);
    }

    /** Check if any texture view of this texture uses a cube dimension. */
    public hasTextureCubeView(textureId: string): boolean {
        for (const view of this._textureViews.values()) {
            if (view.textureId === textureId &&
                (view.dimension === 'cube' || view.dimension === 'cube-array')) {
                return true;
            }
        }
        return false;
    }

    // ─── Texture View ────────────────────────────────────────────────

    public recordTextureViewCreation(view: object, texture: object, descriptor: any): string {
        const id = this.trackObject(view, 'tv');
        const textureId = this._objectIds.get(texture) ?? 'unknown';
        const textureInfo = this._textures.get(textureId);
        this._textureViews.set(id, {
            id,
            label: descriptor?.label,
            textureId,
            format: descriptor?.format ?? textureInfo?.format ?? 'unknown',
            dimension: descriptor?.dimension ?? textureInfo?.dimension ?? '2d',
            baseMipLevel: descriptor?.baseMipLevel ?? 0,
            mipLevelCount: descriptor?.mipLevelCount ?? (textureInfo?.mipLevelCount ?? 1),
            baseArrayLayer: descriptor?.baseArrayLayer ?? 0,
            arrayLayerCount: descriptor?.arrayLayerCount ?? 1,
            aspect: descriptor?.aspect ?? 'all',
        });
        return id;
    }

    // ─── Sampler ─────────────────────────────────────────────────────

    public recordSamplerCreation(sampler: object, descriptor: any): string {
        const id = this.trackObject(sampler, 'smp');
        this._samplers.set(id, {
            id,
            label: descriptor?.label,
            addressModeU: descriptor?.addressModeU ?? 'clamp-to-edge',
            addressModeV: descriptor?.addressModeV ?? 'clamp-to-edge',
            addressModeW: descriptor?.addressModeW ?? 'clamp-to-edge',
            magFilter: descriptor?.magFilter ?? 'nearest',
            minFilter: descriptor?.minFilter ?? 'nearest',
            mipmapFilter: descriptor?.mipmapFilter ?? 'nearest',
            lodMinClamp: descriptor?.lodMinClamp ?? 0,
            lodMaxClamp: descriptor?.lodMaxClamp ?? 32,
            compare: descriptor?.compare,
            maxAnisotropy: descriptor?.maxAnisotropy ?? 1,
        });
        return id;
    }

    // ─── Shader Module ───────────────────────────────────────────────

    public recordShaderModuleCreation(module: object, descriptor: any): string {
        const id = this.trackObject(module, 'shd');
        this._shaderModules.set(id, {
            id,
            label: descriptor?.label,
            code: descriptor?.code ?? '',
        });
        return id;
    }

    // ─── Render Pipeline ─────────────────────────────────────────────

    public recordRenderPipelineCreation(pipeline: object, descriptor: any): string {
        const id = this.trackObject(pipeline, 'rp');
        const vertexModuleId = this._resolveId(descriptor?.vertex?.module);
        const fragmentModule = descriptor?.fragment?.module;
        const fragmentModuleId = fragmentModule ? this._resolveId(fragmentModule) : undefined;

        this._renderPipelines.set(id, {
            id,
            label: descriptor?.label,
            layout: descriptor?.layout === 'auto'
                ? 'auto'
                : this._resolveId(descriptor?.layout, 'auto'),
            vertex: {
                moduleId: vertexModuleId,
                entryPoint: descriptor?.vertex?.entryPoint,
                buffers: descriptor?.vertex?.buffers
                    ? serializeDescriptor(descriptor.vertex.buffers) as any
                    : undefined,
                constants: descriptor?.vertex?.constants,
            },
            fragment: fragmentModuleId !== undefined
                ? {
                    moduleId: fragmentModuleId,
                    entryPoint: descriptor?.fragment?.entryPoint,
                    targets: (serializeDescriptor(descriptor.fragment.targets) as any) ?? [],
                    constants: descriptor?.fragment?.constants,
                }
                : undefined,
            primitive: descriptor?.primitive
                ? serializeDescriptor(descriptor.primitive) as any
                : undefined,
            depthStencil: descriptor?.depthStencil
                ? serializeDescriptor(descriptor.depthStencil) as any
                : undefined,
            multisample: descriptor?.multisample
                ? serializeDescriptor(descriptor.multisample) as any
                : undefined,
        });
        return id;
    }

    // ─── Compute Pipeline ────────────────────────────────────────────

    public recordComputePipelineCreation(pipeline: object, descriptor: any): string {
        const id = this.trackObject(pipeline, 'cp');
        const moduleId = this._resolveId(descriptor?.compute?.module);
        this._computePipelines.set(id, {
            id,
            label: descriptor?.label,
            layout: descriptor?.layout === 'auto'
                ? 'auto'
                : this._resolveId(descriptor?.layout, 'auto'),
            compute: {
                moduleId,
                entryPoint: descriptor?.compute?.entryPoint,
                constants: descriptor?.compute?.constants,
            },
        });
        return id;
    }

    // ─── Bind Group ──────────────────────────────────────────────────

    public recordBindGroupCreation(bindGroup: object, descriptor: any): string {
        const id = this.trackObject(bindGroup, 'bg');
        const layoutId = this._resolveId(descriptor?.layout);

        const entries: IBindGroupEntry[] = (descriptor?.entries ?? []).map((entry: any) => {
            const resource = entry.resource;

            // Buffer binding: { buffer: GPUBuffer, offset?, size? }
            if (resource && typeof resource === 'object' && 'buffer' in resource) {
                return {
                    binding: entry.binding,
                    resourceType: 'buffer' as BindGroupResourceType,
                    resourceId: this._resolveId(resource.buffer),
                    offset: resource.offset ?? 0,
                    size: resource.size,
                };
            }

            // Sampler, texture view, or external texture (the resource IS the object).
            const rid = (typeof resource === 'object' && resource !== null)
                ? this._objectIds.get(resource)
                : undefined;

            let resourceType: BindGroupResourceType = 'externalTexture';
            if (rid !== undefined) {
                if (rid.startsWith('smp_')) resourceType = 'sampler';
                else if (rid.startsWith('tv_')) resourceType = 'textureView';
            }

            return {
                binding: entry.binding,
                resourceType,
                resourceId: rid ?? 'unknown',
            };
        });

        this._bindGroups.set(id, {
            id,
            label: descriptor?.label,
            layoutId,
            entries,
        });
        return id;
    }

    // ─── Bind Group Layout ───────────────────────────────────────────

    public recordBindGroupLayoutCreation(layout: object, descriptor: any): string {
        const id = this.trackObject(layout, 'bgl');

        const entries: IBindGroupLayoutEntry[] = (descriptor?.entries ?? []).map((entry: any) => {
            let type: BindGroupLayoutEntryType = 'buffer';
            let desc: Record<string, unknown> = {};

            if (entry.buffer) {
                type = 'buffer';
                desc = serializeDescriptor(entry.buffer) as Record<string, unknown>;
            } else if (entry.sampler) {
                type = 'sampler';
                desc = serializeDescriptor(entry.sampler) as Record<string, unknown>;
            } else if (entry.texture) {
                type = 'texture';
                desc = serializeDescriptor(entry.texture) as Record<string, unknown>;
            } else if (entry.storageTexture) {
                type = 'storageTexture';
                desc = serializeDescriptor(entry.storageTexture) as Record<string, unknown>;
            } else if (entry.externalTexture) {
                type = 'externalTexture';
                desc = serializeDescriptor(entry.externalTexture) as Record<string, unknown>;
            }

            return {
                binding: entry.binding,
                visibility: entry.visibility ?? 0,
                type,
                descriptor: desc,
            };
        });

        this._bindGroupLayouts.set(id, {
            id,
            label: descriptor?.label,
            entries,
        });
        return id;
    }

    // ─── Snapshot & Stats ────────────────────────────────────────────

    /**
     * Take a snapshot of all live resources for a capture.
     *
     * Returns new Map instances whose entries reference the same info
     * objects. This is safe because info objects are never mutated
     * in-place — state changes (e.g. updateBufferState) always replace
     * the entry with a new object. So post-snapshot mutations cannot
     * affect the snapshot's data.
     */
    public snapshot(): IResourceMap {
        return {
            buffers: this._filterLive(this._buffers, this._destroyedBuffers),
            textures: this._filterLive(this._textures, this._destroyedTextures),
            textureViews: new Map(this._textureViews),
            samplers: new Map(this._samplers),
            shaderModules: new Map(this._shaderModules),
            renderPipelines: new Map(this._renderPipelines),
            computePipelines: new Map(this._computePipelines),
            bindGroups: new Map(this._bindGroups),
            bindGroupLayouts: new Map(this._bindGroupLayouts),
        };
    }

    /** Filter out destroyed resources and those whose GPU objects have been GC'd. */
    private _filterLive<T>(
        map: Map<string, T>,
        destroyed: Set<string>,
    ): Map<string, T> {
        const live = new Map<string, T>();
        for (const [id, info] of map) {
            if (destroyed.has(id)) continue;
            // Skip GC'd objects — their WeakRef deref returns undefined
            const ref = this._idToObject.get(id);
            if (ref && !ref.deref()) continue;
            live.set(id, info);
        }
        return live;
    }

    /** Aggregate counters for the capture stats. */
    public getResourceCounts(): Pick<ICaptureStats,
        'bufferCount' | 'textureCount' | 'shaderModuleCount' | 'pipelineCount' | 'bindGroupCount'
    > {
        return {
            bufferCount: this._buffers.size,
            textureCount: this._textures.size,
            shaderModuleCount: this._shaderModules.size,
            pipelineCount: this._renderPipelines.size + this._computePipelines.size,
            bindGroupCount: this._bindGroups.size,
        };
    }

    /** Reset all tracked resources. Typically used when the device is lost/destroyed. */
    public reset(): void {
        this._objectIds = new WeakMap();
        this._idToObject.clear();
        this._buffers.clear();
        this._textures.clear();
        this._textureViews.clear();
        this._samplers.clear();
        this._shaderModules.clear();
        this._renderPipelines.clear();
        this._computePipelines.clear();
        this._bindGroups.clear();
        this._bindGroupLayouts.clear();
        this._destroyedTextures.clear();
        this._lastCanvasTextureId = null;
        this._destroyedBuffers.clear();
    }
}
