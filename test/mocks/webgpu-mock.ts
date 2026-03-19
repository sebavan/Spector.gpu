/**
 * Comprehensive WebGPU API mock for SpectorGPU testing.
 *
 * Simulates the full WebGPU API surface with:
 * - Call tracking (__calls: MockCall[]) on every mock object
 * - Real async behavior (Promises resolve on microtask, not synchronously)
 * - Buffer mapAsync state machine (unmapped → pending → mapped → unmapped)
 * - Device lost simulation (simulateLost())
 * - Canvas context (configure / getCurrentTexture / unconfigure)
 * - Label support on all GPU objects
 *
 * Zero external dependencies. Pure TypeScript.
 *
 * @example
 *   const { gpu, installGlobal, removeGlobal } = createMockWebGPU();
 *   installGlobal();       // navigator.gpu = mock
 *   // ... run tests ...
 *   removeGlobal();        // restore original
 */

// ─── Types ──────────────────────────────────────────────────────────

/** Recorded call on a mock object. */
export interface MockCall {
    readonly method: string;
    readonly args: unknown[];
    readonly timestamp: number;
}

// ─── Internal Helpers ───────────────────────────────────────────────

let _counter = 0;

/** Reset the global mock ID counter. Call in beforeEach for deterministic IDs. */
export function resetMockIds(): void {
    _counter = 0;
}

function mid(prefix: string): string {
    return `${prefix}_${++_counter}`;
}

function track(obj: { __calls: MockCall[] }, method: string, args: unknown[]): void {
    obj.__calls.push({ method, args: Array.from(args), timestamp: performance.now() });
}

function extractLabel(descriptor?: { label?: string } | null): string {
    return descriptor?.label ?? '';
}

// ─── Default Limits ─────────────────────────────────────────────────

/** Reasonable default limits matching a mid-range GPU. */
const DEFAULT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
    maxTextureDimension1D: 8192,
    maxTextureDimension2D: 8192,
    maxTextureDimension3D: 2048,
    maxTextureArrayLayers: 256,
    maxBindGroups: 4,
    maxBindGroupsPlusVertexBuffers: 24,
    maxBindingsPerBindGroup: 1000,
    maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxDynamicStorageBuffersPerPipelineLayout: 4,
    maxSampledTexturesPerShaderStage: 16,
    maxSamplersPerShaderStage: 16,
    maxStorageBuffersPerShaderStage: 8,
    maxStorageTexturesPerShaderStage: 4,
    maxUniformBuffersPerShaderStage: 12,
    maxUniformBufferBindingSize: 65536,
    maxStorageBufferBindingSize: 134217728,
    minUniformBufferOffsetAlignment: 256,
    minStorageBufferOffsetAlignment: 256,
    maxVertexBuffers: 8,
    maxBufferSize: 268435456,
    maxVertexAttributes: 16,
    maxVertexBufferArrayStride: 2048,
    maxInterStageShaderVariables: 16,
    maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 32,
    maxComputeWorkgroupStorageSize: 16384,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupSizeX: 256,
    maxComputeWorkgroupSizeY: 256,
    maxComputeWorkgroupSizeZ: 64,
    maxComputeWorkgroupsPerDimension: 65535,
});

// ─── Simple GPU Objects ─────────────────────────────────────────────

export class MockGPUTextureView {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('textureView');
    label: string;
    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }
}

export class MockGPUCommandBuffer {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('cmdBuf');
    label: string;
    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }
}

export class MockGPUSampler {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('sampler');
    label: string;
    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }
}

export class MockGPUBindGroupLayout {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('bgl');
    label: string;
    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }
}

export class MockGPUBindGroup {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('bg');
    label: string;
    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }
}

export class MockGPUPipelineLayout {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('pipelineLayout');
    label: string;
    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }
}

export class MockGPUQuerySet {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('querySet');
    label: string;
    readonly type: string;
    readonly count: number;

    constructor(descriptor?: { label?: string; type?: string; count?: number } | null) {
        this.label = extractLabel(descriptor);
        this.type = descriptor?.type ?? 'occlusion';
        this.count = descriptor?.count ?? 0;
    }

    destroy(): void {
        track(this, 'destroy', []);
    }
}

// ─── MockGPUBuffer ──────────────────────────────────────────────────

export type BufferMapState = 'unmapped' | 'pending' | 'mapped';

export class MockGPUBuffer {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('buffer');
    label: string;
    readonly size: number;
    readonly usage: number;
    private _mapState: BufferMapState = 'unmapped';
    private _mappedRanges: ArrayBuffer[] = [];
    private _destroyed = false;

    constructor(descriptor: {
        label?: string;
        size: number;
        usage: number;
        mappedAtCreation?: boolean;
    }) {
        this.label = extractLabel(descriptor);
        this.size = descriptor.size;
        this.usage = descriptor.usage;
        if (descriptor.mappedAtCreation) {
            this._mapState = 'mapped';
        }
    }

    get mapState(): BufferMapState {
        return this._mapState;
    }

    mapAsync(mode: number, offset?: number, size?: number): Promise<void> {
        track(this, 'mapAsync', [mode, offset, size]);
        if (this._destroyed) {
            return Promise.reject(new DOMException('Buffer is destroyed', 'OperationError'));
        }
        if (this._mapState !== 'unmapped') {
            return Promise.reject(
                new DOMException(
                    `Invalid mapState: expected 'unmapped', got '${this._mapState}'`,
                    'OperationError',
                ),
            );
        }
        this._mapState = 'pending';
        // Resolve on next microtask — callers must await before getMappedRange.
        return Promise.resolve().then(() => {
            if (this._mapState === 'pending') {
                this._mapState = 'mapped';
            }
        });
    }

    getMappedRange(offset?: number, size?: number): ArrayBuffer {
        track(this, 'getMappedRange', [offset, size]);
        if (this._mapState !== 'mapped') {
            throw new DOMException(
                `Invalid mapState: expected 'mapped', got '${this._mapState}'`,
                'OperationError',
            );
        }
        const buf = new ArrayBuffer(size ?? this.size);
        this._mappedRanges.push(buf);
        return buf;
    }

    unmap(): void {
        track(this, 'unmap', []);
        this._mapState = 'unmapped';
        this._mappedRanges.length = 0;
    }

    destroy(): void {
        track(this, 'destroy', []);
        this._destroyed = true;
        this._mapState = 'unmapped';
        this._mappedRanges.length = 0;
    }
}

// ─── MockGPUTexture ─────────────────────────────────────────────────

export class MockGPUTexture {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('texture');
    label: string;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension: string;
    readonly format: string;
    readonly usage: number;
    private _destroyed = false;

    constructor(descriptor?: {
        label?: string;
        size?: { width?: number; height?: number; depthOrArrayLayers?: number } | number[];
        mipLevelCount?: number;
        sampleCount?: number;
        dimension?: string;
        format?: string;
        usage?: number;
    } | null) {
        this.label = extractLabel(descriptor);
        if (Array.isArray(descriptor?.size)) {
            const s = descriptor!.size as number[];
            this.width = s[0] ?? 1;
            this.height = s[1] ?? 1;
            this.depthOrArrayLayers = s[2] ?? 1;
        } else if (descriptor?.size && typeof descriptor.size === 'object') {
            const s = descriptor.size as { width?: number; height?: number; depthOrArrayLayers?: number };
            this.width = s.width ?? 1;
            this.height = s.height ?? 1;
            this.depthOrArrayLayers = s.depthOrArrayLayers ?? 1;
        } else {
            this.width = 1;
            this.height = 1;
            this.depthOrArrayLayers = 1;
        }
        this.mipLevelCount = descriptor?.mipLevelCount ?? 1;
        this.sampleCount = descriptor?.sampleCount ?? 1;
        this.dimension = descriptor?.dimension ?? '2d';
        this.format = descriptor?.format ?? 'rgba8unorm';
        this.usage = descriptor?.usage ?? 0;
    }

    createView(descriptor?: { label?: string } | null): MockGPUTextureView {
        track(this, 'createView', [descriptor]);
        return new MockGPUTextureView(descriptor);
    }

    destroy(): void {
        track(this, 'destroy', []);
        this._destroyed = true;
    }
}

// ─── MockGPUShaderModule ────────────────────────────────────────────

export class MockGPUShaderModule {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('shaderModule');
    label: string;

    constructor(descriptor?: { label?: string; code?: string } | null) {
        this.label = extractLabel(descriptor);
    }

    getCompilationInfo(): Promise<{
        messages: readonly { message: string; type: string; lineNum: number; linePos: number }[];
    }> {
        track(this, 'getCompilationInfo', []);
        return Promise.resolve({ messages: [] });
    }
}

// ─── MockGPURenderPipeline ──────────────────────────────────────────

export class MockGPURenderPipeline {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('renderPipeline');
    label: string;

    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }

    getBindGroupLayout(index: number): MockGPUBindGroupLayout {
        track(this, 'getBindGroupLayout', [index]);
        return new MockGPUBindGroupLayout({ label: `auto-bgl-${index}` });
    }
}

// ─── MockGPUComputePipeline ─────────────────────────────────────────

export class MockGPUComputePipeline {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('computePipeline');
    label: string;

    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }

    getBindGroupLayout(index: number): MockGPUBindGroupLayout {
        track(this, 'getBindGroupLayout', [index]);
        return new MockGPUBindGroupLayout({ label: `auto-bgl-${index}` });
    }
}

// ─── MockGPURenderPassEncoder (19 methods) ──────────────────────────

export class MockGPURenderPassEncoder {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('renderPass');
    label: string;

    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }

    setPipeline(pipeline: unknown): void {
        track(this, 'setPipeline', [pipeline]);
    }

    setBindGroup(index: number, bindGroup: unknown, dynamicOffsets?: Uint32Array | number[]): void {
        track(this, 'setBindGroup', [index, bindGroup, dynamicOffsets]);
    }

    setVertexBuffer(slot: number, buffer: unknown, offset?: number, size?: number): void {
        track(this, 'setVertexBuffer', [slot, buffer, offset, size]);
    }

    setIndexBuffer(buffer: unknown, indexFormat: string, offset?: number, size?: number): void {
        track(this, 'setIndexBuffer', [buffer, indexFormat, offset, size]);
    }

    draw(
        vertexCount: number,
        instanceCount?: number,
        firstVertex?: number,
        firstInstance?: number,
    ): void {
        track(this, 'draw', [vertexCount, instanceCount, firstVertex, firstInstance]);
    }

    drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number,
    ): void {
        track(this, 'drawIndexed', [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]);
    }

    drawIndirect(indirectBuffer: unknown, indirectOffset: number): void {
        track(this, 'drawIndirect', [indirectBuffer, indirectOffset]);
    }

    drawIndexedIndirect(indirectBuffer: unknown, indirectOffset: number): void {
        track(this, 'drawIndexedIndirect', [indirectBuffer, indirectOffset]);
    }

    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number,
    ): void {
        track(this, 'setViewport', [x, y, width, height, minDepth, maxDepth]);
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        track(this, 'setScissorRect', [x, y, width, height]);
    }

    setBlendConstant(color: unknown): void {
        track(this, 'setBlendConstant', [color]);
    }

    setStencilReference(reference: number): void {
        track(this, 'setStencilReference', [reference]);
    }

    insertDebugMarker(markerLabel: string): void {
        track(this, 'insertDebugMarker', [markerLabel]);
    }

    pushDebugGroup(groupLabel: string): void {
        track(this, 'pushDebugGroup', [groupLabel]);
    }

    popDebugGroup(): void {
        track(this, 'popDebugGroup', []);
    }

    beginOcclusionQuery(queryIndex: number): void {
        track(this, 'beginOcclusionQuery', [queryIndex]);
    }

    endOcclusionQuery(): void {
        track(this, 'endOcclusionQuery', []);
    }

    executeBundles(bundles: unknown[]): void {
        track(this, 'executeBundles', [bundles]);
    }

    end(): void {
        track(this, 'end', []);
    }
}

// ─── MockGPUComputePassEncoder (8 methods) ──────────────────────────

export class MockGPUComputePassEncoder {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('computePass');
    label: string;

    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }

    setPipeline(pipeline: unknown): void {
        track(this, 'setPipeline', [pipeline]);
    }

    setBindGroup(index: number, bindGroup: unknown, dynamicOffsets?: Uint32Array | number[]): void {
        track(this, 'setBindGroup', [index, bindGroup, dynamicOffsets]);
    }

    dispatchWorkgroups(x: number, y?: number, z?: number): void {
        track(this, 'dispatchWorkgroups', [x, y, z]);
    }

    dispatchWorkgroupsIndirect(indirectBuffer: unknown, indirectOffset: number): void {
        track(this, 'dispatchWorkgroupsIndirect', [indirectBuffer, indirectOffset]);
    }

    insertDebugMarker(markerLabel: string): void {
        track(this, 'insertDebugMarker', [markerLabel]);
    }

    pushDebugGroup(groupLabel: string): void {
        track(this, 'pushDebugGroup', [groupLabel]);
    }

    popDebugGroup(): void {
        track(this, 'popDebugGroup', []);
    }

    end(): void {
        track(this, 'end', []);
    }
}

// ─── MockGPUCommandEncoder ──────────────────────────────────────────

export class MockGPUCommandEncoder {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('cmdEncoder');
    label: string;

    constructor(descriptor?: { label?: string } | null) {
        this.label = extractLabel(descriptor);
    }

    beginRenderPass(descriptor: unknown): MockGPURenderPassEncoder {
        track(this, 'beginRenderPass', [descriptor]);
        const desc = descriptor as { label?: string } | null;
        return new MockGPURenderPassEncoder(desc);
    }

    beginComputePass(descriptor?: unknown): MockGPUComputePassEncoder {
        track(this, 'beginComputePass', [descriptor]);
        const desc = descriptor as { label?: string } | null;
        return new MockGPUComputePassEncoder(desc);
    }

    copyBufferToBuffer(
        source: unknown,
        sourceOffset: number,
        destination: unknown,
        destinationOffset: number,
        size: number,
    ): void {
        track(this, 'copyBufferToBuffer', [source, sourceOffset, destination, destinationOffset, size]);
    }

    copyBufferToTexture(source: unknown, destination: unknown, copySize: unknown): void {
        track(this, 'copyBufferToTexture', [source, destination, copySize]);
    }

    copyTextureToBuffer(source: unknown, destination: unknown, copySize: unknown): void {
        track(this, 'copyTextureToBuffer', [source, destination, copySize]);
    }

    copyTextureToTexture(source: unknown, destination: unknown, copySize: unknown): void {
        track(this, 'copyTextureToTexture', [source, destination, copySize]);
    }

    clearBuffer(buffer: unknown, offset?: number, size?: number): void {
        track(this, 'clearBuffer', [buffer, offset, size]);
    }

    resolveQuerySet(
        querySet: unknown,
        firstQuery: number,
        queryCount: number,
        destination: unknown,
        destinationOffset: number,
    ): void {
        track(this, 'resolveQuerySet', [querySet, firstQuery, queryCount, destination, destinationOffset]);
    }

    insertDebugMarker(markerLabel: string): void {
        track(this, 'insertDebugMarker', [markerLabel]);
    }

    pushDebugGroup(groupLabel: string): void {
        track(this, 'pushDebugGroup', [groupLabel]);
    }

    popDebugGroup(): void {
        track(this, 'popDebugGroup', []);
    }

    finish(descriptor?: { label?: string } | null): MockGPUCommandBuffer {
        track(this, 'finish', [descriptor]);
        return new MockGPUCommandBuffer(descriptor);
    }
}

// ─── MockGPUQueue ───────────────────────────────────────────────────

export class MockGPUQueue {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('queue');
    label = '';

    submit(commandBuffers: unknown[]): void {
        track(this, 'submit', [commandBuffers]);
    }

    writeBuffer(
        buffer: unknown,
        bufferOffset: number,
        data: unknown,
        dataOffset?: number,
        size?: number,
    ): void {
        track(this, 'writeBuffer', [buffer, bufferOffset, data, dataOffset, size]);
    }

    writeTexture(
        destination: unknown,
        data: unknown,
        dataLayout: unknown,
        size: unknown,
    ): void {
        track(this, 'writeTexture', [destination, data, dataLayout, size]);
    }

    copyExternalImageToTexture(
        source: unknown,
        destination: unknown,
        copySize: unknown,
    ): void {
        track(this, 'copyExternalImageToTexture', [source, destination, copySize]);
    }

    onSubmittedWorkDone(): Promise<void> {
        track(this, 'onSubmittedWorkDone', []);
        return Promise.resolve();
    }
}

// ─── MockGPUDevice ──────────────────────────────────────────────────

export class MockGPUDevice {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('device');
    label: string;
    readonly queue: MockGPUQueue;
    readonly features: ReadonlySet<string>;
    readonly limits: Readonly<Record<string, number>>;

    /** Resolves when device is lost. Use simulateLost() or destroy() to trigger. */
    readonly lost: Promise<{ readonly reason: string; readonly message: string }>;

    private _lostResolve!: (info: { reason: string; message: string }) => void;
    private _lostSettled = false;
    private _errorScopes: string[] = [];
    private _eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
    private _destroyed = false;

    constructor(descriptor?: {
        label?: string;
        requiredFeatures?: string[];
        requiredLimits?: Record<string, number>;
    } | null) {
        this.label = extractLabel(descriptor);
        this.queue = new MockGPUQueue();
        this.features = new Set<string>(descriptor?.requiredFeatures ?? []);
        this.limits = { ...DEFAULT_LIMITS, ...(descriptor?.requiredLimits ?? {}) };
        this.lost = new Promise<{ reason: string; message: string }>(resolve => {
            this._lostResolve = resolve;
        });
    }

    // ── Test helpers ──

    /** Resolve the `lost` promise with the given reason. Idempotent. */
    simulateLost(reason: string = 'destroyed'): void {
        if (this._lostSettled) return;
        this._lostSettled = true;
        this._lostResolve({ reason, message: `Device lost: ${reason}` });
    }

    /** True after destroy() was called. */
    get isDestroyed(): boolean {
        return this._destroyed;
    }

    // ── Resource creation ──

    createBuffer(descriptor: {
        label?: string;
        size: number;
        usage: number;
        mappedAtCreation?: boolean;
    }): MockGPUBuffer {
        track(this, 'createBuffer', [descriptor]);
        return new MockGPUBuffer(descriptor);
    }

    createTexture(descriptor: unknown): MockGPUTexture {
        track(this, 'createTexture', [descriptor]);
        return new MockGPUTexture(
            descriptor as Parameters<typeof MockGPUTexture.prototype.constructor>[0],
        );
    }

    createSampler(descriptor?: unknown): MockGPUSampler {
        track(this, 'createSampler', [descriptor]);
        return new MockGPUSampler(descriptor as { label?: string } | null);
    }

    createShaderModule(descriptor: unknown): MockGPUShaderModule {
        track(this, 'createShaderModule', [descriptor]);
        return new MockGPUShaderModule(descriptor as { label?: string; code?: string } | null);
    }

    createRenderPipeline(descriptor: unknown): MockGPURenderPipeline {
        track(this, 'createRenderPipeline', [descriptor]);
        return new MockGPURenderPipeline(descriptor as { label?: string } | null);
    }

    createComputePipeline(descriptor: unknown): MockGPUComputePipeline {
        track(this, 'createComputePipeline', [descriptor]);
        return new MockGPUComputePipeline(descriptor as { label?: string } | null);
    }

    createRenderPipelineAsync(descriptor: unknown): Promise<MockGPURenderPipeline> {
        track(this, 'createRenderPipelineAsync', [descriptor]);
        return Promise.resolve(
            new MockGPURenderPipeline(descriptor as { label?: string } | null),
        );
    }

    createComputePipelineAsync(descriptor: unknown): Promise<MockGPUComputePipeline> {
        track(this, 'createComputePipelineAsync', [descriptor]);
        return Promise.resolve(
            new MockGPUComputePipeline(descriptor as { label?: string } | null),
        );
    }

    createBindGroup(descriptor: unknown): MockGPUBindGroup {
        track(this, 'createBindGroup', [descriptor]);
        return new MockGPUBindGroup(descriptor as { label?: string } | null);
    }

    createBindGroupLayout(descriptor: unknown): MockGPUBindGroupLayout {
        track(this, 'createBindGroupLayout', [descriptor]);
        return new MockGPUBindGroupLayout(descriptor as { label?: string } | null);
    }

    createPipelineLayout(descriptor: unknown): MockGPUPipelineLayout {
        track(this, 'createPipelineLayout', [descriptor]);
        return new MockGPUPipelineLayout(descriptor as { label?: string } | null);
    }

    createCommandEncoder(descriptor?: unknown): MockGPUCommandEncoder {
        track(this, 'createCommandEncoder', [descriptor]);
        return new MockGPUCommandEncoder(descriptor as { label?: string } | null);
    }

    createQuerySet(descriptor: unknown): MockGPUQuerySet {
        track(this, 'createQuerySet', [descriptor]);
        return new MockGPUQuerySet(
            descriptor as { label?: string; type?: string; count?: number } | null,
        );
    }

    // ── Error scopes ──

    pushErrorScope(filter: string): void {
        track(this, 'pushErrorScope', [filter]);
        this._errorScopes.push(filter);
    }

    popErrorScope(): Promise<null> {
        track(this, 'popErrorScope', []);
        this._errorScopes.pop();
        return Promise.resolve(null);
    }

    // ── Lifecycle ──

    destroy(): void {
        track(this, 'destroy', []);
        this._destroyed = true;
        this.simulateLost('destroyed');
    }

    // ── EventTarget subset ──

    addEventListener(type: string, listener: (...args: unknown[]) => void): void {
        track(this, 'addEventListener', [type, listener]);
        let set = this._eventListeners.get(type);
        if (!set) {
            set = new Set();
            this._eventListeners.set(type, set);
        }
        set.add(listener);
    }

    removeEventListener(type: string, listener: (...args: unknown[]) => void): void {
        track(this, 'removeEventListener', [type, listener]);
        this._eventListeners.get(type)?.delete(listener);
    }

    dispatchEvent(event: { type: string }): boolean {
        track(this, 'dispatchEvent', [event]);
        const set = this._eventListeners.get(event.type);
        if (set) {
            for (const fn of set) fn(event);
        }
        return true;
    }
}

// ─── MockGPUCanvasContext ───────────────────────────────────────────

export class MockGPUCanvasContext {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('canvasCtx');
    readonly canvas: unknown;
    private _configured = false;
    private _format = 'bgra8unorm';
    private _usage = 0x10; // RENDER_ATTACHMENT
    private _currentTexture: MockGPUTexture | null = null;

    constructor(canvas?: unknown) {
        this.canvas = canvas ?? null;
    }

    configure(configuration: {
        device: unknown;
        format: string;
        alphaMode?: string;
        usage?: number;
    }): void {
        track(this, 'configure', [configuration]);
        this._configured = true;
        this._format = configuration.format;
        this._usage = configuration.usage ?? 0x10;
    }

    unconfigure(): void {
        track(this, 'unconfigure', []);
        this._configured = false;
        this._currentTexture = null;
    }

    getCurrentTexture(): MockGPUTexture {
        track(this, 'getCurrentTexture', []);
        if (!this._currentTexture) {
            this._currentTexture = new MockGPUTexture({
                label: 'canvas-texture',
                size: { width: 800, height: 600 },
                format: this._format,
                usage: this._usage,
            });
        }
        return this._currentTexture;
    }

    /** Test helper: invalidate cached texture to simulate a new frame. */
    _nextFrame(): void {
        this._currentTexture = null;
    }
}

// ─── MockGPUAdapter ─────────────────────────────────────────────────

export class MockGPUAdapter {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('adapter');
    readonly features: ReadonlySet<string> = new Set();
    readonly limits: Readonly<Record<string, number>> = { ...DEFAULT_LIMITS };
    readonly isFallbackAdapter = false;

    readonly info = Object.freeze({
        vendor: 'mock-vendor',
        architecture: 'mock-arch',
        device: 'mock-device',
        description: 'Mock WebGPU Adapter',
        backend: 'mock',
    });

    requestDevice(descriptor?: unknown): Promise<MockGPUDevice> {
        track(this, 'requestDevice', [descriptor]);
        return Promise.resolve(
            new MockGPUDevice(
                descriptor as {
                    label?: string;
                    requiredFeatures?: string[];
                    requiredLimits?: Record<string, number>;
                } | null,
            ),
        );
    }

    requestAdapterInfo(): Promise<{
        vendor: string;
        architecture: string;
        device: string;
        description: string;
    }> {
        track(this, 'requestAdapterInfo', []);
        return Promise.resolve({ ...this.info });
    }
}

// ─── MockGPU (navigator.gpu) ────────────────────────────────────────

export class MockGPU {
    readonly __calls: MockCall[] = [];
    readonly __mockId = mid('gpu');

    requestAdapter(options?: unknown): Promise<MockGPUAdapter | null> {
        track(this, 'requestAdapter', [options]);
        return Promise.resolve(new MockGPUAdapter());
    }

    getPreferredCanvasFormat(): string {
        track(this, 'getPreferredCanvasFormat', []);
        return 'bgra8unorm';
    }

    /** Test helper: create a standalone canvas context. */
    createCanvasContext(canvas?: unknown): MockGPUCanvasContext {
        return new MockGPUCanvasContext(canvas);
    }
}

// ─── Factory ────────────────────────────────────────────────────────

export interface MockWebGPUResult {
    /** The mock GPU instance (equivalent to navigator.gpu). */
    gpu: MockGPU;
    /** Set navigator.gpu to this mock. Idempotent. */
    installGlobal: () => void;
    /** Restore the original navigator.gpu. Idempotent. */
    removeGlobal: () => void;
}

/**
 * Create a complete mock WebGPU environment.
 *
 * @example
 *   const { gpu, installGlobal, removeGlobal } = createMockWebGPU();
 *   installGlobal();
 *
 *   const adapter = await gpu.requestAdapter();
 *   const device = await adapter!.requestDevice();
 *   const buffer = device.createBuffer({ size: 256, usage: 0x40 });
 *
 *   expect(device.__calls).toHaveLength(1);
 *   expect(device.__calls[0].method).toBe('createBuffer');
 *
 *   removeGlobal();
 */
export function createMockWebGPU(): MockWebGPUResult {
    const gpu = new MockGPU();
    let originalGpu: unknown = undefined;
    let installed = false;

    return {
        gpu,
        installGlobal(): void {
            if (installed) return;
            // Capture whatever navigator.gpu currently is (likely undefined in jsdom)
            originalGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu')?.value;
            Object.defineProperty(navigator, 'gpu', {
                value: gpu,
                configurable: true,
                writable: true,
            });
            installed = true;
        },
        removeGlobal(): void {
            if (!installed) return;
            if (originalGpu === undefined) {
                // Remove the property entirely if it didn't exist before
                delete (navigator as Record<string, unknown>).gpu;
            } else {
                Object.defineProperty(navigator, 'gpu', {
                    value: originalGpu,
                    configurable: true,
                    writable: true,
                });
            }
            installed = false;
        },
    };
}
