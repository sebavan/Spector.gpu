/**
 * SpectorGPU facade — orchestrates all spies, resource tracking, and
 * command tree construction for a single page context.
 *
 * Lifecycle:
 *   1. init() — installs spies in passive mode (detects WebGPU, tracks resources)
 *   2. captureNextFrame() — arms capture; records commands to tree
 *   3. stopCapture() — finalizes capture, returns ICapture, fires onCaptureComplete
 *   4. dispose() — tears down all spies and clears observables
 *
 * Invariants:
 *   - init() is idempotent (double-call is a no-op).
 *   - captureNextFrame() while already capturing is a no-op.
 *   - captureNextFrame() before init() fires onCaptureError.
 *   - All spies are installed passively on init; capture only controls
 *     whether the command tree builder is active.
 *   - Encoder spying is always on (installed via DeviceSpy onCommand callback)
 *     so that pass-level spies are wired before capture is requested.
 *   - stopCapture() produces a capture from whatever has been recorded.
 *     The caller (content script / rAF callback) decides when to stop.
 */

import { Observable } from '@shared/utils';
import { Logger } from '@shared/utils/logger';
import { globalIdGenerator } from '@shared/utils';
import { serializeDescriptor } from '@shared/utils/serialization';
import { SPECTOR_GPU_VERSION, CAPTURE_TIMEOUT_MS } from '@shared/constants';
import type { IAdapterInfo, ICapture, ICaptureStats, CommandType as CommandTypeEnum, ITextureInfo } from '@shared/types';
import { CommandType } from '@shared/types';
import { CommandTreeBuilder } from '@core/capture';
import { RecorderManager } from '@core/recorders';
import { globalOriginStore } from '@core/proxy/originStore';
import {
    GpuSpy,
    DeviceSpy,
    QueueSpy,
    EncoderSpy,
    RenderPassSpy,
    ComputePassSpy,
    CanvasSpy,
} from '@core/spies';

// ── Static lookup: WebGPU method name → CommandType ──────────────────
// Pre-built, zero-alloc per command on the hot path.

const METHOD_TO_COMMAND_TYPE: Readonly<Record<string, CommandTypeEnum>> = {
    // Draw
    draw: CommandType.Draw,
    drawIndexed: CommandType.Draw,
    drawIndirect: CommandType.Draw,
    drawIndexedIndirect: CommandType.Draw,
    // Dispatch
    dispatchWorkgroups: CommandType.Dispatch,
    dispatchWorkgroupsIndirect: CommandType.Dispatch,
    // State-setting
    setPipeline: CommandType.SetPipeline,
    setBindGroup: CommandType.SetBindGroup,
    setVertexBuffer: CommandType.SetVertexBuffer,
    setIndexBuffer: CommandType.SetIndexBuffer,
    setViewport: CommandType.SetViewport,
    setScissorRect: CommandType.SetScissorRect,
    setBlendConstant: CommandType.SetBlendConstant,
    setStencilReference: CommandType.SetStencilReference,
    // Transfer
    writeBuffer: CommandType.WriteBuffer,
    writeTexture: CommandType.WriteTexture,
    copyBufferToBuffer: CommandType.CopyBufferToBuffer,
    copyBufferToTexture: CommandType.CopyBufferToTexture,
    copyTextureToBuffer: CommandType.CopyTextureToBuffer,
    copyTextureToTexture: CommandType.CopyTextureToTexture,
    clearBuffer: CommandType.ClearBuffer,
    resolveQuerySet: CommandType.ResolveQuerySet,
    // Debug
    insertDebugMarker: CommandType.InsertDebugMarker,
    pushDebugGroup: CommandType.PushDebugGroup,
    popDebugGroup: CommandType.PopDebugGroup,
    // Occlusion
    beginOcclusionQuery: CommandType.BeginOcclusionQuery,
    endOcclusionQuery: CommandType.EndOcclusionQuery,
    // Misc
    executeBundles: CommandType.ExecuteBundles,
};

/** Convert positional args array to Record<string, unknown> for ICommandNode. */
function argsToRecord(args: readonly unknown[]): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
        record[i] = serializeDescriptor(args[i]);
    }
    return record;
}

// ── Texture readback format utilities ────────────────────────────────

/** Formats we can read back and convert to RGBA8 for thumbnails. */
const READABLE_FORMATS = new Set([
    'r8unorm', 'r8snorm', 'r8uint', 'r8sint',
    'rg8unorm', 'rg8snorm', 'rg8uint', 'rg8sint',
    'rgba8unorm', 'rgba8unorm-srgb', 'rgba8snorm', 'rgba8uint', 'rgba8sint',
    'bgra8unorm', 'bgra8unorm-srgb',
    'r16float', 'rg16float', 'rgba16float',
    'r32float', 'rg32float', 'rgba32float',
    'rgb10a2unorm',
]);

function isReadableFormat(format: string): boolean {
    return READABLE_FORMATS.has(format);
}

/** Bytes per pixel for supported formats. Returns 0 for unsupported. */
function bytesPerPixel(format: string): number {
    switch (format) {
        case 'r8unorm': case 'r8snorm': case 'r8uint': case 'r8sint':
            return 1;
        case 'rg8unorm': case 'rg8snorm': case 'rg8uint': case 'rg8sint':
        case 'r16float':
            return 2;
        case 'rgba8unorm': case 'rgba8unorm-srgb': case 'rgba8snorm':
        case 'rgba8uint': case 'rgba8sint':
        case 'bgra8unorm': case 'bgra8unorm-srgb':
        case 'rg16float':
        case 'r32float':
        case 'rgb10a2unorm':
            return 4;
        case 'rgba16float': case 'rg32float':
            return 8;
        case 'rgba32float':
            return 16;
        default:
            return 0;
    }
}

/** Convert a single pixel from GPU format to RGBA8. */
function convertPixel(
    src: Uint8Array, srcOff: number,
    dst: Uint8Array, dstOff: number,
    format: string,
): void {
    switch (format) {
        case 'rgba8unorm': case 'rgba8unorm-srgb': case 'rgba8uint':
            dst[dstOff]     = src[srcOff];
            dst[dstOff + 1] = src[srcOff + 1];
            dst[dstOff + 2] = src[srcOff + 2];
            dst[dstOff + 3] = src[srcOff + 3];
            break;

        case 'bgra8unorm': case 'bgra8unorm-srgb':
            dst[dstOff]     = src[srcOff + 2]; // B→R
            dst[dstOff + 1] = src[srcOff + 1]; // G→G
            dst[dstOff + 2] = src[srcOff];     // R→B
            dst[dstOff + 3] = src[srcOff + 3];
            break;

        case 'rgba8snorm': case 'rgba8sint':
            dst[dstOff]     = ((src[srcOff]     << 24 >> 24) + 128);
            dst[dstOff + 1] = ((src[srcOff + 1] << 24 >> 24) + 128);
            dst[dstOff + 2] = ((src[srcOff + 2] << 24 >> 24) + 128);
            dst[dstOff + 3] = 255;
            break;

        case 'r8unorm': case 'r8uint':
            dst[dstOff] = dst[dstOff + 1] = dst[dstOff + 2] = src[srcOff];
            dst[dstOff + 3] = 255;
            break;

        case 'r8snorm': case 'r8sint':
            dst[dstOff] = dst[dstOff + 1] = dst[dstOff + 2] = ((src[srcOff] << 24 >> 24) + 128);
            dst[dstOff + 3] = 255;
            break;

        case 'rg8unorm': case 'rg8uint':
            dst[dstOff]     = src[srcOff];
            dst[dstOff + 1] = src[srcOff + 1];
            dst[dstOff + 2] = 0;
            dst[dstOff + 3] = 255;
            break;

        case 'rg8snorm': case 'rg8sint':
            dst[dstOff]     = ((src[srcOff]     << 24 >> 24) + 128);
            dst[dstOff + 1] = ((src[srcOff + 1] << 24 >> 24) + 128);
            dst[dstOff + 2] = 0;
            dst[dstOff + 3] = 255;
            break;

        case 'rgb10a2unorm': {
            // 10-10-10-2 packed in little-endian u32
            const v = src[srcOff] | (src[srcOff + 1] << 8) | (src[srcOff + 2] << 16) | (src[srcOff + 3] << 24);
            dst[dstOff]     = ((v & 0x3FF) * 255 / 1023) | 0;
            dst[dstOff + 1] = (((v >> 10) & 0x3FF) * 255 / 1023) | 0;
            dst[dstOff + 2] = (((v >> 20) & 0x3FF) * 255 / 1023) | 0;
            dst[dstOff + 3] = (((v >> 30) & 0x3) * 255 / 3) | 0;
            break;
        }

        default:
            // Float formats: read via DataView
            convertFloatPixel(src, srcOff, dst, dstOff, format);
            break;
    }
}

/** Handle float format pixels (r16f, rg16f, rgba16f, r32f, rg32f, rgba32f). */
function convertFloatPixel(
    src: Uint8Array, srcOff: number,
    dst: Uint8Array, dstOff: number,
    format: string,
): void {
    const view = new DataView(src.buffer, src.byteOffset + srcOff);

    let r = 0, g = 0, b = 0, a = 1;

    switch (format) {
        case 'r16float':
            r = g = b = float16ToNumber(view.getUint16(0, true));
            break;
        case 'rg16float':
            r = float16ToNumber(view.getUint16(0, true));
            g = float16ToNumber(view.getUint16(2, true));
            break;
        case 'rgba16float':
            r = float16ToNumber(view.getUint16(0, true));
            g = float16ToNumber(view.getUint16(2, true));
            b = float16ToNumber(view.getUint16(4, true));
            a = float16ToNumber(view.getUint16(6, true));
            break;
        case 'r32float':
            r = g = b = view.getFloat32(0, true);
            break;
        case 'rg32float':
            r = view.getFloat32(0, true);
            g = view.getFloat32(4, true);
            break;
        case 'rgba32float':
            r = view.getFloat32(0, true);
            g = view.getFloat32(4, true);
            b = view.getFloat32(8, true);
            a = view.getFloat32(12, true);
            break;
        default:
            dst[dstOff] = dst[dstOff + 1] = dst[dstOff + 2] = 128;
            dst[dstOff + 3] = 255;
            return;
    }

    // Clamp [0, 1] and convert to 8-bit
    dst[dstOff]     = Math.max(0, Math.min(255, (r * 255) | 0));
    dst[dstOff + 1] = Math.max(0, Math.min(255, (g * 255) | 0));
    dst[dstOff + 2] = Math.max(0, Math.min(255, (b * 255) | 0));
    dst[dstOff + 3] = Math.max(0, Math.min(255, (a * 255) | 0));
}

/** Decode IEEE 754 half-precision float (16-bit). */
function float16ToNumber(h: number): number {
    const sign = (h >> 15) & 1;
    const exp = (h >> 10) & 0x1F;
    const mant = h & 0x3FF;

    if (exp === 0) {
        // Subnormal or zero
        return (sign ? -1 : 1) * (mant / 1024) * Math.pow(2, -14);
    }
    if (exp === 0x1F) {
        // Inf or NaN
        return mant === 0 ? (sign ? -Infinity : Infinity) : NaN;
    }
    return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

/**
 * Convert raw GPU texture pixels to a data URL thumbnail.
 * Handles format conversion (bgra swap, float→8bit, single-channel expansion).
 * Scales down to maxSize for compact storage.
 */
function pixelsToDataUrl(
    rawData: Uint8Array,
    width: number,
    height: number,
    bytesPerRow: number,
    format: string,
    maxSize: number,
): string | null {
    if (typeof document === 'undefined') return null;

    // Step 1: Convert to RGBA8 array (full resolution)
    const rgba = new Uint8Array(width * height * 4);
    const bpp = bytesPerPixel(format);

    for (let y = 0; y < height; y++) {
        const srcRowOffset = y * bytesPerRow;
        const dstRowOffset = y * width * 4;

        for (let x = 0; x < width; x++) {
            const srcOffset = srcRowOffset + x * bpp;
            const dstOffset = dstRowOffset + x * 4;

            convertPixel(rawData, srcOffset, rgba, dstOffset, format);
        }
    }

    // Step 2: Draw to canvas (scaled down for thumbnail)
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const thumbW = Math.max(1, Math.round(width * scale));
    const thumbH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Create ImageData at full res, then draw scaled
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = width;
    fullCanvas.height = height;
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) return null;

    const imageData = fullCtx.createImageData(width, height);
    imageData.data.set(rgba);
    fullCtx.putImageData(imageData, 0, 0);

    ctx.drawImage(fullCanvas, 0, 0, thumbW, thumbH);

    return canvas.toDataURL('image/png');
}

export class SpectorGPU {
    // ── Public observables ───────────────────────────────────────────
    public readonly onWebGPUDetected = new Observable<IAdapterInfo>();
    public readonly onCaptureComplete = new Observable<ICapture>();
    public readonly onCaptureError = new Observable<{ error: unknown }>();

    // ── State ────────────────────────────────────────────────────────
    private _adapterInfo: IAdapterInfo | null = null;
    private _isCapturing = false;
    private _isReadingBack = false;
    private _initialized = false;
    private _device: GPUDevice | null = null;
    private _captureStartTime = 0;
    private _captureTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private _commandTree: CommandTreeBuilder | null = null;

    // Late-detection: multi-strategy prototype hooks state.
    // Stored originals enable clean disposal.
    private _lateDetectionInstalled = false;
    private _origDeviceProtoMethods: Array<{ proto: any; name: string; original: Function }> = [];
    private _origConfigure: { proto: any; original: Function } | null = null;
    private _origGetCurrentTexture: { proto: any; original: Function } | null = null;
    private _origQueueSubmit: { proto: any; original: Function } | null = null;
    private _contextToDevice = new WeakMap<object, GPUDevice>();

    // WebGPU canvas tracking — set via configure() hook and onWebGPUContextCreated.
    // Used by _captureCanvasScreenshot() to target the correct canvas.
    private _webgpuCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

    // Screenshot captured during queue.submit() while back buffer is still valid.
    // Consumed by _buildCapture(). Null means no screenshot was taken this frame.
    private _pendingScreenshot: string | null = null;

    // Pass state tracking (for state snapshots on draw/dispatch nodes).
    // Updated incrementally via _trackPassState(); reset on each new pass.
    private _currentPipelineId: string | null = null;
    private _currentBindGroups: string[] = [];
    private _currentVertexBuffers: string[] = [];
    private _currentIndexBufferId: string | null = null;

    // Subsystems — allocated once, reused across captures.
    private readonly _recorderManager = new RecorderManager();
    private readonly _gpuSpy = new GpuSpy();
    private readonly _deviceSpy: DeviceSpy;
    private readonly _queueSpy: QueueSpy;
    private readonly _encoderSpy = new EncoderSpy();
    private readonly _renderPassSpy = new RenderPassSpy();
    private readonly _computePassSpy = new ComputePassSpy();
    private readonly _canvasSpy = new CanvasSpy();

    constructor() {
        this._deviceSpy = new DeviceSpy(this._recorderManager, {
            onCommand: (methodName, _args, result) => {
                // Spy on every encoder created, regardless of capture state.
                // Ensures pass-level spies are wired before capture is armed.
                if (methodName === 'createCommandEncoder' && result) {
                    this._encoderSpy.spyOnEncoder(result as GPUCommandEncoder);
                }
            },
        });
        this._queueSpy = new QueueSpy();
    }

    // ── Public getters ───────────────────────────────────────────────

    public get adapterInfo(): IAdapterInfo | null {
        return this._adapterInfo;
    }

    public get isCapturing(): boolean {
        return this._isCapturing;
    }

    public get isInitialized(): boolean {
        return this._initialized;
    }

    // ── Public API ───────────────────────────────────────────────────

    /** Install all spies in passive mode. Idempotent. */
    public init(): void {
        if (this._initialized) return;
        this._initialized = true;

        this._wireSpies();
        this._gpuSpy.install();          // patches GPU.prototype.requestAdapter
        this._deviceSpy.installPrototypeSpy(); // patches GPUAdapter.prototype.requestDevice
        this._installLateDetectionHooks(); // multi-strategy prototype hooks for late device discovery
        this._canvasSpy.install();
        Logger.info('SpectorGPU initialized (passive mode)');
    }

    /**
     * Arm capture — starts recording commands to the tree.
     * Capture continues until stopCapture() is called (or timeout).
     * Does NOT require a device (device may be created during capture).
     */
    public captureNextFrame(): void {
        if (!this._initialized) {
            this.onCaptureError.trigger({ error: new Error('SpectorGPU not initialized') });
            return;
        }
        if (this._isCapturing) return;

        // If no device has been found yet, actively probe for one
        // by scanning DOM canvases whose contexts map to known devices.
        if (!this._device) {
            this._probeForDevice();
        }

        this._isCapturing = true;
        this._commandTree = new CommandTreeBuilder();
        this._captureStartTime = performance.now();

        // Safety timeout — abort if stopCapture() is never called.
        this._captureTimeoutId = setTimeout(() => {
            if (this._isCapturing) {
                this._abortCapture('Capture timed out');
            }
        }, CAPTURE_TIMEOUT_MS);

        Logger.info('Capture armed — recording commands');
    }

    /**
     * Finalize capture: freeze command tree, snapshot resources, fire
     * onCaptureComplete, and return the ICapture.
     * Returns null if not capturing.
     */
    public stopCapture(): ICapture | null {
        if (!this._isCapturing || !this._commandTree) return null;

        try {
            const capture = this._buildCapture();
            this._clearCaptureState();
            this.onCaptureComplete.trigger(capture);
            return capture;
        } catch (e) {
            this._clearCaptureState();
            this.onCaptureError.trigger({ error: e });
            return null;
        }
    }

    /** Tear down all spies and release resources. Safe to call multiple times. */
    public dispose(): void {
        this._clearCaptureState();

        // Restore all late-detection prototype hooks.
        this._removeLateDetectionHooks();

        this._gpuSpy.dispose();
        this._deviceSpy.dispose();
        this._queueSpy.dispose();
        this._encoderSpy.dispose();
        this._renderPassSpy.dispose();
        this._computePassSpy.dispose();
        this._canvasSpy.dispose();
        this.onWebGPUDetected.clear();
        this.onCaptureComplete.clear();
        this.onCaptureError.clear();
        this._adapterInfo = null;
        this._device = null;
        this._initialized = false;
    }

    // ── Late-detection: multi-strategy prototype hooks ─────────────────

    /**
     * Install multiple prototype-level hooks to discover devices
     * that were created before our content script ran.
     *
     * Strategies (any one can discover the device):
     *   1. GPUDevice.prototype methods — if the app resolves these
     *      through the prototype chain, `this` IS the device.
     *   2. GPUCanvasContext.prototype.configure — the app passes
     *      its device directly; we capture the reference.
     *   3. GPUCanvasContext.prototype.getCurrentTexture — called
     *      every frame; triggers a device lookup if needed.
     *   4. GPUQueue.prototype.submit — called every frame;
     *      triggers a canvas-based device scan.
     *
     * All hooks are idempotent and safely no-op when the globals
     * don't exist (e.g. in jsdom unit tests).
     */
    private _installLateDetectionHooks(): void {
        if (this._lateDetectionInstalled) return;
        this._lateDetectionInstalled = true;

        this._hookDevicePrototypeMethods();
        this._hookCanvasContextPrototype();
        this._hookQueuePrototype();
    }

    /**
     * Patch multiple methods on GPUDevice.prototype.
     * Any call through the prototype triggers device discovery via `this`.
     * Hooks more methods than just createCommandEncoder to maximize
     * the chance of catching at least one un-cached call.
     */
    private _hookDevicePrototypeMethods(): void {
        if (typeof GPUDevice === 'undefined') return;

        const proto = GPUDevice.prototype as any;
        const self = this;

        // Hook the most frequently called device methods.
        // Even if an app caches one (e.g. createCommandEncoder),
        // it's unlikely to cache ALL of them.
        const methods = [
            'createCommandEncoder',
            'createBuffer',
            'createTexture',
            'createShaderModule',
            'createRenderPipeline',
            'createComputePipeline',
            'createBindGroup',
            'createSampler',
        ];

        for (let i = 0; i < methods.length; i++) {
            const name = methods[i];
            if (typeof proto[name] !== 'function') continue;

            const original = proto[name] as Function;
            this._origDeviceProtoMethods.push({ proto, name, original });

            proto[name] = function (this: GPUDevice, ...args: any[]) {
                // 'this' is the GPUDevice instance — discover and patch it.
                self._discoverDevice(this);
                return original.apply(this, args);
            };
        }
    }

    /**
     * Hook GPUCanvasContext.prototype to capture the device reference
     * from configure() and trigger scans from getCurrentTexture().
     *
     * configure() is the MOST reliable hook: the app passes its
     * device directly as config.device. Even if the app cached
     * device.createCommandEncoder, it still calls configure() on
     * the canvas context and doesn't typically cache that.
     */
    private _hookCanvasContextPrototype(): void {
        if (typeof GPUCanvasContext === 'undefined') return;

        const proto = GPUCanvasContext.prototype as any;
        const self = this;

        // configure({ device, format, ... }) — captures the device reference.
        if (typeof proto.configure === 'function') {
            const original = proto.configure as Function;
            this._origConfigure = { proto, original };

            proto.configure = function (this: GPUCanvasContext, config: any) {
                if (config?.device) {
                    self._contextToDevice.set(this, config.device);
                    self._discoverDevice(config.device);
                }
                // Track the WebGPU canvas for screenshot targeting.
                // GPUCanvasContext.canvas gives us the exact canvas element.
                try {
                    const canvas = (this as any).canvas;
                    if (canvas) {
                        self._webgpuCanvas = canvas;
                    }
                } catch { /* canvas property may not exist in all environments */ }
                return original.apply(this, arguments);
            };
        }

        // getCurrentTexture() — called every frame by rendering apps.
        // If we haven't found a device yet, look it up in the
        // context→device WeakMap populated by the configure hook.
        if (typeof proto.getCurrentTexture === 'function') {
            const original = proto.getCurrentTexture as Function;
            this._origGetCurrentTexture = { proto, original };

            proto.getCurrentTexture = function (this: GPUCanvasContext) {
                if (!self._device) {
                    const dev = self._contextToDevice.get(this);
                    if (dev) {
                        self._discoverDevice(dev);
                    }
                }
                const texture = original.apply(this, arguments);
                // Track the canvas texture so it appears in the resource list
                // with isCanvasTexture=true. Idempotent — recordCanvasTexture
                // returns early if this exact object is already tracked.
                if (texture) {
                    try {
                        const t = texture as GPUTexture;
                        const id = self._recorderManager.recordCanvasTexture(
                            t,
                            t.format ?? 'bgra8unorm',
                            t.width ?? 0,
                            t.height ?? 0,
                        );
                        // Patch createView on the canvas texture so its views
                        // are tracked (same as device.createTexture() textures).
                        // patchTextureCreateView is idempotent via globalOriginStore.
                        if (id) {
                            self._deviceSpy.patchTextureCreateView(t);
                        }
                    } catch { /* best-effort — don't break the app */ }
                }
                return texture;
            };
        }
    }

    /**
     * Hook GPUQueue.prototype.submit — called every frame by every
     * WebGPU app. Cannot directly get the owning device from a queue,
     * but triggers a canvas-based device scan if no device found.
     */
    private _hookQueuePrototype(): void {
        if (typeof GPUQueue === 'undefined') return;

        const proto = GPUQueue.prototype as any;
        if (typeof proto.submit !== 'function') return;

        const original = proto.submit as Function;
        this._origQueueSubmit = { proto, original };

        const self = this;

        proto.submit = function (this: GPUQueue) {
            if (!self._device) {
                self._probeForDevice();
            }
            return original.apply(this, arguments);
        };
    }

    /**
     * Restore all prototype hooks installed by _installLateDetectionHooks.
     * Called from dispose(). Safe to call multiple times.
     */
    private _removeLateDetectionHooks(): void {
        // Restore GPUDevice.prototype methods
        for (let i = 0; i < this._origDeviceProtoMethods.length; i++) {
            const { proto, name, original } = this._origDeviceProtoMethods[i];
            proto[name] = original;
        }
        this._origDeviceProtoMethods.length = 0;

        // Restore GPUCanvasContext.prototype.configure
        if (this._origConfigure) {
            this._origConfigure.proto.configure = this._origConfigure.original;
            this._origConfigure = null;
        }

        // Restore GPUCanvasContext.prototype.getCurrentTexture
        if (this._origGetCurrentTexture) {
            this._origGetCurrentTexture.proto.getCurrentTexture = this._origGetCurrentTexture.original;
            this._origGetCurrentTexture = null;
        }

        // Restore GPUQueue.prototype.submit
        if (this._origQueueSubmit) {
            this._origQueueSubmit.proto.submit = this._origQueueSubmit.original;
            this._origQueueSubmit = null;
        }

        this._lateDetectionInstalled = false;
    }

    /**
     * Actively probe for a WebGPU device by scanning DOM canvases.
     * Called from captureNextFrame() and from queue/context hooks.
     *
     * Checks the _contextToDevice WeakMap for any canvas with a
     * WebGPU context that was configured (and therefore mapped to a device).
     */
    private _probeForDevice(): void {
        if (this._device) return;
        if (typeof document === 'undefined') return;

        try {
            const canvases = document.querySelectorAll('canvas');
            for (let i = 0; i < canvases.length; i++) {
                const canvas = canvases[i];
                // Skip trivially small canvases (1×1 placeholders etc.)
                if (canvas.width <= 1 || canvas.height <= 1) continue;

                try {
                    // getContext('webgpu') returns the existing context if
                    // the canvas was already configured for WebGPU, or null.
                    const ctx = canvas.getContext('webgpu') as unknown as GPUCanvasContext | null;
                    if (!ctx) continue;

                    const device = this._contextToDevice.get(ctx);
                    if (device) {
                        this._discoverDevice(device);
                        return;
                    }
                } catch {
                    // getContext may throw for cross-origin canvases or
                    // if the context type conflicts. Ignore and continue.
                }
            }
        } catch {
            // Silent — probe is best-effort.
        }
    }

    /**
     * Called when we discover a device that wasn't created through our spy.
     * Patches it and its queue for interception.
     *
     * DeviceSpy.spyOnDevice and QueueSpy.spyOnQueue are both idempotent
     * (WeakSet guard) — safe to call on already-patched devices.
     */
    private _discoverDevice(device: GPUDevice): void {
        this._deviceSpy.spyOnDevice(device);
        this._queueSpy.spyOnQueue(device.queue);
        this._device = device;

        // If we don't have adapter info yet, emit a synthetic detection event.
        if (!this._adapterInfo) {
            this._adapterInfo = {
                vendor: '',
                architecture: '',
                device: '',
                description: 'Late-detected device',
                backend: '',
            };
            this.onWebGPUDetected.trigger(this._adapterInfo);
        }
    }

    // ── Spy wiring (called once from init) ───────────────────────────

    private _wireSpies(): void {
        // Track the WebGPU canvas when getContext('webgpu') is called.
        this._canvasSpy.onWebGPUContextCreated.add(({ canvas }) => {
            this._webgpuCanvas = canvas;
        });

        // Adapter created → detect WebGPU, spy on device creation
        this._gpuSpy.onAdapterCreated.add(({ adapter, info }) => {
            this._adapterInfo = info;
            this._deviceSpy.spyOnAdapter(adapter);
            this.onWebGPUDetected.trigger(info);
        });

        // PRIMARY device discovery: GpuSpy wraps requestDevice inline
        // inside the requestAdapter return chain. This fires BEFORE
        // the caller's await/then sees the device, so the device is
        // guaranteed to be intercepted even when Chrome puts methods
        // as own properties on instances (making prototype patches
        // ineffective). DeviceSpy.spyOnDevice is idempotent (WeakSet)
        // so the secondary path below is a harmless no-op.
        this._gpuSpy.onDeviceCreated.add((device) => {
            this._device = device;
            this._deviceSpy.spyOnDevice(device);
            this._queueSpy.spyOnQueue(device.queue);
        });

        // SECONDARY device discovery: DeviceSpy's own onDeviceCreated
        // (fired from spyOnAdapter's patchMethod afterResolve or from
        // installPrototypeSpy). Kept as fallback for late-detected
        // devices. spyOnDevice is idempotent — double-fire is a no-op.
        this._deviceSpy.onDeviceCreated.add((device) => {
            this._device = device;
            this._queueSpy.spyOnQueue(device.queue);
        });

        // Device lost → abort active capture
        this._deviceSpy.onDeviceLost.add(({ reason }) => {
            if (this._isCapturing) {
                this._abortCapture(`Device lost: ${reason}`);
            }
        });

        // ── Encoder events ───────────────────────────────────────────

        this._encoderSpy.onBeginRenderPass.add(({ pass, descriptor }) => {
            this._renderPassSpy.spyOnRenderPass(pass);
            this._resetPassState();
            if (this._isCapturing && this._commandTree) {
                const desc = serializeDescriptor(descriptor);
                this._commandTree.pushScope(
                    CommandType.RenderPass,
                    'beginRenderPass',
                    (typeof desc === 'object' && desc !== null ? desc : {}) as Record<string, unknown>,
                );
            }
        });

        this._encoderSpy.onBeginComputePass.add(({ pass, descriptor }) => {
            this._computePassSpy.spyOnComputePass(pass);
            this._resetPassState();
            if (this._isCapturing && this._commandTree) {
                const desc = serializeDescriptor(descriptor);
                this._commandTree.pushScope(
                    CommandType.ComputePass,
                    'beginComputePass',
                    (typeof desc === 'object' && desc !== null ? desc : {}) as Record<string, unknown>,
                );
            }
        });

        // Encoder-level commands (transfers, debug markers).
        // Skip pass creation / finish — handled by dedicated handlers.
        this._encoderSpy.onCommand.add(({ methodName, args }) => {
            if (!this._isCapturing || !this._commandTree) return;
            if (methodName === 'beginRenderPass' || methodName === 'beginComputePass' || methodName === 'finish') return;
            const type = METHOD_TO_COMMAND_TYPE[methodName] ?? CommandType.Other;
            this._commandTree.addCommand(type, methodName, argsToRecord(args));
        });

        // ── Render pass events ───────────────────────────────────────

        this._renderPassSpy.onCommand.add(({ methodName, args }) => {
            if (!this._isCapturing || !this._commandTree) return;

            // Track state changes for pipeline/bind group/buffer snapshots.
            this._trackPassState(methodName, args);

            const type = METHOD_TO_COMMAND_TYPE[methodName] ?? CommandType.Other;
            const node = this._commandTree.addCommand(type, methodName, argsToRecord(args));

            // Attach state snapshot to draw calls.
            if (type === CommandType.Draw) {
                node.setStateSnapshot({
                    pipelineId: this._currentPipelineId ?? undefined,
                    bindGroups: this._currentBindGroups.length > 0 ? [...this._currentBindGroups] : undefined,
                    vertexBuffers: this._currentVertexBuffers.length > 0 ? [...this._currentVertexBuffers] : undefined,
                    indexBufferId: this._currentIndexBufferId ?? undefined,
                });
            }
        });

        this._renderPassSpy.onEnd.add(() => {
            if (this._isCapturing && this._commandTree) {
                this._commandTree.popScope();
            }
        });

        // ── Compute pass events ──────────────────────────────────────

        this._computePassSpy.onCommand.add(({ methodName, args }) => {
            if (!this._isCapturing || !this._commandTree) return;

            this._trackPassState(methodName, args);

            const type = METHOD_TO_COMMAND_TYPE[methodName] ?? CommandType.Other;
            const node = this._commandTree.addCommand(type, methodName, argsToRecord(args));

            if (type === CommandType.Dispatch) {
                node.setStateSnapshot({
                    pipelineId: this._currentPipelineId ?? undefined,
                    bindGroups: this._currentBindGroups.length > 0 ? [...this._currentBindGroups] : undefined,
                });
            }
        });

        this._computePassSpy.onEnd.add(() => {
            if (this._isCapturing && this._commandTree) {
                this._commandTree.popScope();
            }
        });

        // ── Queue submit → record submit command (but don't auto-finalize) ──

        this._queueSpy.onSubmit.add(({ commandBuffers }) => {
            if (this._isReadingBack) return; // Skip our own readback submits
            if (this._isCapturing && this._commandTree) {
                this._commandTree.addCommand(
                    CommandType.Submit,
                    'submit',
                    { commandBufferCount: commandBuffers.length },
                );

                // Capture screenshot NOW — content is still in the back buffer
                // before the browser composites at end of frame task.
                this._pendingScreenshot = this._captureCanvasScreenshot();

                // Auto-stop after the first submit — captures exactly one frame.
                // Use microtask, then perform async texture readback before finalizing.
                Promise.resolve().then(() => {
                    if (this._isCapturing) {
                        this._finalizeCapture();
                    }
                });
            }
        });
    }

    // ── Pass state tracking ──────────────────────────────────────────

    /** Reset pass-local state when entering a new render/compute pass. */
    private _resetPassState(): void {
        this._currentPipelineId = null;
        this._currentBindGroups.length = 0;
        this._currentVertexBuffers.length = 0;
        this._currentIndexBufferId = null;
    }

    /**
     * Update tracked pass state from a render/compute pass command.
     * Called on every pass-level command; only acts on state-setting methods.
     * Hot path — zero allocations (reuses existing arrays).
     */
    private _trackPassState(methodName: string, args: readonly unknown[]): void {
        if (methodName === 'setPipeline') {
            if (args[0]) {
                this._currentPipelineId = this._recorderManager.getId(args[0] as object) ?? null;
            }
        } else if (methodName === 'setBindGroup') {
            if (args.length >= 2) {
                const index = args[0] as number;
                const bgId = args[1] ? (this._recorderManager.getId(args[1] as object) ?? 'unknown') : '';
                while (this._currentBindGroups.length <= index) this._currentBindGroups.push('');
                this._currentBindGroups[index] = bgId;
            }
        } else if (methodName === 'setVertexBuffer') {
            if (args.length >= 2) {
                const slot = args[0] as number;
                const bufId = args[1] ? (this._recorderManager.getId(args[1] as object) ?? 'unknown') : '';
                while (this._currentVertexBuffers.length <= slot) this._currentVertexBuffers.push('');
                this._currentVertexBuffers[slot] = bufId;
            }
        } else if (methodName === 'setIndexBuffer') {
            if (args[0]) {
                this._currentIndexBufferId = this._recorderManager.getId(args[0] as object) ?? null;
            }
        }
    }

    // ── Capture internals ────────────────────────────────────────────

    /**
     * Capture a screenshot of the WebGPU render canvas.
     *
     * Strategy:
     *   1. Use the known WebGPU canvas (tracked via configure() / getContext('webgpu'))
     *   2. Fallback: find the largest canvas on the page (avoids Monaco editor etc.)
     *
     * Scales down to at most 256px wide for compact capture data.
     * Validates pixel content — returns null for blank/expired canvases
     * rather than returning a white image.
     *
     * MUST be called during queue.submit() while the back buffer is valid.
     * WebGPU canvases clear after presentation, so post-composite calls yield blank.
     *
     * Best-effort: returns null on any failure. Never throws.
     */
    private _captureCanvasScreenshot(): string | null {
        try {
            // 1. Prefer the known WebGPU canvas
            let targetCanvas: HTMLCanvasElement | null = null;

            if (this._webgpuCanvas && this._webgpuCanvas instanceof HTMLCanvasElement) {
                targetCanvas = this._webgpuCanvas;
            }

            // 2. Fallback: find the largest canvas on the page.
            //    Largest-area heuristic avoids picking Monaco editor canvases,
            //    UI overlays, and other small utility canvases.
            if (!targetCanvas && typeof document !== 'undefined') {
                const canvases = document.querySelectorAll('canvas');
                let maxArea = 0;
                for (let i = 0; i < canvases.length; i++) {
                    const c = canvases[i];
                    const area = c.width * c.height;
                    if (area > maxArea && c.width > 10 && c.height > 10) {
                        maxArea = area;
                        targetCanvas = c;
                    }
                }
            }

            if (!targetCanvas || targetCanvas.width < 10 || targetCanvas.height < 10) return null;

            // Scale down for thumbnail
            const MAX_WIDTH = 256;
            const scale = Math.min(1, MAX_WIDTH / targetCanvas.width);
            const thumbWidth = Math.round(targetCanvas.width * scale);
            const thumbHeight = Math.round(targetCanvas.height * scale);

            const offscreen = document.createElement('canvas');
            offscreen.width = thumbWidth;
            offscreen.height = thumbHeight;
            const ctx = offscreen.getContext('2d');
            if (!ctx) return null;

            ctx.drawImage(targetCanvas, 0, 0, thumbWidth, thumbHeight);

            // Validate pixel content — reject blank/expired back buffers.
            // Sample every 4th pixel (stride 16 in RGBA byte array) for speed.
            const imageData = ctx.getImageData(0, 0, thumbWidth, thumbHeight);
            const data = imageData.data;
            let nonZeroPixels = 0;
            for (let i = 0; i < data.length; i += 16) {
                if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) {
                    nonZeroPixels++;
                    break; // One non-black pixel is enough — early exit
                }
            }

            if (nonZeroPixels === 0) {
                // Canvas is blank — WebGPU back buffer already expired or
                // scene is completely black. Return null; UI shows no preview.
                return null;
            }

            return offscreen.toDataURL('image/png');
        } catch {
            // Silent fail — screenshot is best-effort.
            return null;
        }
    }

    // ── Async texture readback ───────────────────────────────────────

    /** Maximum number of textures to read back per capture. */
    private static readonly MAX_READBACK_TEXTURES = 16;
    /** Maximum thumbnail dimension (px). Textures are scaled down to fit. */
    private static readonly READBACK_THUMB_SIZE = 128;
    /** Timeout for the entire readback operation (ms). */
    private static readonly READBACK_TIMEOUT_MS = 5000;

    /** Async finalization: readback textures, then build and emit capture. */
    private async _finalizeCapture(): Promise<void> {
        if (!this._isCapturing || !this._commandTree) return;

        // Disarm capture FIRST to prevent our readback submit from
        // triggering another capture cycle.
        this._isCapturing = false;

        try {
            await this._readbackTextures();
        } catch (e) {
            Logger.warn('Texture readback failed:', e);
            // Continue — capture still works without previews
        }

        try {
            const capture = this._buildCapture();
            this._clearCaptureState();
            this.onCaptureComplete.trigger(capture);
        } catch (e) {
            this._clearCaptureState();
            this.onCaptureError.trigger({ error: e });
        }
    }

    /**
     * Read back pixel data from GPU textures and store as preview data URLs.
     *
     * Strategy:
     *   1. Iterate tracked textures, filter to readable ones
     *   2. For each: create staging buffer, encode copyTextureToBuffer, submit
     *   3. MapAsync all staging buffers in parallel
     *   4. Read pixels, convert to RGBA8, draw to canvas, get data URL
     *   5. Update RecorderManager with preview URLs
     *   6. Destroy staging buffers
     *
     * Skips: canvas textures (already have screenshot), depth/stencil formats,
     * MSAA textures, 1D/3D textures, compressed formats, zero-size textures.
     *
     * Uses the device directly with _isReadingBack flag to prevent
     * polluting the capture with readback commands.
     */
    private async _readbackTextures(): Promise<void> {
        const device = this._device;
        if (!device) return;

        const textures = this._recorderManager.getTextures();
        if (textures.size === 0) return;

        // Set flag so our own submit/createBuffer calls don't interfere.
        this._isReadingBack = true;

        try {
            await this._readbackTexturesImpl(device, textures);
        } finally {
            this._isReadingBack = false;
        }
    }

    private async _readbackTexturesImpl(
        device: GPUDevice,
        textures: ReadonlyMap<string, ITextureInfo>,
    ): Promise<void> {
        // Collect readable textures (skip destroyed ones)
        const readable: Array<{ id: string; info: ITextureInfo; gpuTexture: GPUTexture }> = [];

        for (const [id, info] of textures) {
            if (readable.length >= SpectorGPU.MAX_READBACK_TEXTURES) break;
            if (info.isCanvasTexture) continue;
            if (info.dimension !== '2d') continue;
            if (info.sampleCount > 1) continue;
            if (info.size.width === 0 || info.size.height === 0) continue;
            if (!isReadableFormat(info.format)) continue;
            if (!(info.usage & 0x01)) continue; // COPY_SRC
            if (this._recorderManager.isTextureDestroyed(id)) continue;

            const obj = this._recorderManager.getObject(id);
            if (!obj) continue;

            readable.push({ id, info, gpuTexture: obj as GPUTexture });
        }

        if (readable.length === 0) return;

        Logger.info(`Reading back ${readable.length} textures...`);

        // Read back each texture individually with its own error scope
        // so one failed copy doesn't abort the rest.
        const tasks: Array<{
            id: string;
            info: ITextureInfo;
            buffer: GPUBuffer;
            bytesPerRow: number;
            width: number;
            height: number;
        }> = [];

        for (const { id, info, gpuTexture } of readable) {
            try {
                const bpp = bytesPerPixel(info.format);
                if (bpp === 0) continue;

                const width = info.size.width;
                const height = info.size.height;
                const bytesPerRow = Math.ceil((width * bpp) / 256) * 256;
                const bufferSize = bytesPerRow * height;

                if (bufferSize === 0 || bufferSize > 64 * 1024 * 1024) continue;

                // Per-texture error scope — catches destroyed/invalid textures
                device.pushErrorScope('validation');

                const buffer = device.createBuffer({
                    size: bufferSize,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                });

                const encoder = device.createCommandEncoder();
                encoder.copyTextureToBuffer(
                    { texture: gpuTexture, mipLevel: 0 },
                    { buffer, bytesPerRow, rowsPerImage: height },
                    { width, height, depthOrArrayLayers: 1 },
                );
                device.queue.submit([encoder.finish()]);

                const err = await device.popErrorScope();
                if (err) {
                    Logger.warn(`Readback copy failed for ${id}: ${(err as GPUValidationError).message}`);
                    buffer.destroy();
                    continue;
                }

                tasks.push({ id, info, buffer, bytesPerRow, width, height });
            } catch (e) {
                Logger.warn(`Readback setup failed for ${id}:`, e);
            }
        }

        if (tasks.length === 0) return;

        // Map all staging buffers in parallel, with a timeout
        try {
            await Promise.race([
                Promise.all(tasks.map(t => t.buffer.mapAsync(GPUMapMode.READ))),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Readback timeout')), SpectorGPU.READBACK_TIMEOUT_MS)
                ),
            ]);
        } catch (e) {
            Logger.warn('Texture readback map failed:', e);
            for (const t of tasks) {
                try { t.buffer.destroy(); } catch { /* ignore */ }
            }
            return;
        }

        // Read pixels and generate thumbnails (with total size budget)
        let totalPreviewBytes = 0;
        const MAX_PREVIEW_BYTES = 4 * 1024 * 1024; // 4 MB total budget

        for (const task of tasks) {
            try {
                const data = new Uint8Array(task.buffer.getMappedRange());
                const dataUrl = pixelsToDataUrl(
                    data, task.width, task.height,
                    task.bytesPerRow, task.info.format,
                    SpectorGPU.READBACK_THUMB_SIZE,
                );
                if (dataUrl) {
                    totalPreviewBytes += dataUrl.length;
                    if (totalPreviewBytes > MAX_PREVIEW_BYTES) {
                        Logger.warn('Preview size budget exceeded, skipping remaining textures');
                        task.buffer.unmap();
                        task.buffer.destroy();
                        break;
                    }
                    this._recorderManager.setTexturePreview(task.id, dataUrl);
                }
            } catch (e) {
                Logger.warn(`Readback read failed for ${task.id}:`, e);
            } finally {
                try { task.buffer.unmap(); } catch { /* may already be unmapped */ }
                task.buffer.destroy();
            }
        }

        Logger.info(`Texture readback complete: ${tasks.length} textures`);
    }

    /** Build the ICapture from current tree + resource state. */
    private _buildCapture(): ICapture {
        // Use the screenshot captured during queue.submit() while the back
        // buffer was still valid. Falls back to a fresh capture attempt
        // (works for non-WebGPU canvases that don't clear on presentation).
        const screenshot = this._pendingScreenshot ?? this._captureCanvasScreenshot();
        this._pendingScreenshot = null;
        if (screenshot && this._commandTree) {
            this._commandTree.setVisualOutputOnAllPasses(screenshot);
        }

        const duration = performance.now() - this._captureStartTime;
        const treeStats = this._commandTree!.getStats();
        const resourceCounts = this._recorderManager.getResourceCounts();

        const stats: ICaptureStats = {
            totalCommands: treeStats.totalCommands,
            drawCalls: treeStats.drawCalls,
            dispatchCalls: treeStats.dispatchCalls,
            renderPasses: treeStats.renderPasses,
            computePasses: treeStats.computePasses,
            pipelineCount: resourceCounts.pipelineCount,
            bufferCount: resourceCounts.bufferCount,
            textureCount: resourceCounts.textureCount,
            shaderModuleCount: resourceCounts.shaderModuleCount,
            bindGroupCount: resourceCounts.bindGroupCount,
        };

        return {
            id: globalIdGenerator.next('capture'),
            version: SPECTOR_GPU_VERSION,
            timestamp: Date.now(),
            duration,
            adapterInfo: this._adapterInfo ?? {
                vendor: '', architecture: '', device: '', description: '', backend: '',
            },
            deviceDescriptor: {},
            deviceLimits: this._device ? this._extractLimits(this._device) : {},
            deviceFeatures: this._device ? this._extractFeatures(this._device) : [],
            commands: this._commandTree!.freeze(),
            resources: this._recorderManager.snapshot(),
            stats,
        };
    }

    private _abortCapture(reason: string): void {
        this._clearCaptureState();
        this.onCaptureError.trigger({ error: new Error(reason) });
        Logger.warn('Capture aborted:', reason);
    }

    private _clearCaptureState(): void {
        this._isCapturing = false;
        this._commandTree = null;
        this._pendingScreenshot = null;
        if (this._captureTimeoutId !== null) {
            clearTimeout(this._captureTimeoutId);
            this._captureTimeoutId = null;
        }
    }

    // ── Device metadata extraction ───────────────────────────────────

    private _extractLimits(device: GPUDevice): Record<string, number> {
        const limits: Record<string, number> = {};
        const proto = Object.getPrototypeOf(device.limits) as object;
        for (const key of Object.getOwnPropertyNames(proto)) {
            const val = (device.limits as unknown as Record<string, unknown>)[key];
            if (typeof val === 'number') {
                limits[key] = val;
            }
        }
        return limits;
    }

    private _extractFeatures(device: GPUDevice): string[] {
        return Array.from(device.features);
    }
}
