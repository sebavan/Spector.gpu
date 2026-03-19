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
import type { IAdapterInfo, ICapture, ICaptureStats, CommandType as CommandTypeEnum } from '@shared/types';
import { CommandType } from '@shared/types';
import { CommandTreeBuilder } from '@core/capture';
import { RecorderManager } from '@core/recorders';
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

export class SpectorGPU {
    // ── Public observables ───────────────────────────────────────────
    public readonly onWebGPUDetected = new Observable<IAdapterInfo>();
    public readonly onCaptureComplete = new Observable<ICapture>();
    public readonly onCaptureError = new Observable<{ error: unknown }>();

    // ── State ────────────────────────────────────────────────────────
    private _adapterInfo: IAdapterInfo | null = null;
    private _isCapturing = false;
    private _initialized = false;
    private _device: GPUDevice | null = null;
    private _captureStartTime = 0;
    private _captureTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private _commandTree: CommandTreeBuilder | null = null;

    // Late-detection prototype patching state.
    private _devicePrototypePatched = false;
    private _originalCreateCommandEncoder: Function | null = null;

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
        this._installDevicePrototypeSpy(); // patches GPUDevice.prototype.createCommandEncoder for late detection
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

        // Restore GPUDevice prototype if patched.
        if (this._devicePrototypePatched && this._originalCreateCommandEncoder) {
            const proto: any = typeof GPUDevice !== 'undefined' ? GPUDevice.prototype : null;
            if (proto) {
                proto.createCommandEncoder = this._originalCreateCommandEncoder;
            }
            this._devicePrototypePatched = false;
            this._originalCreateCommandEncoder = null;
        }

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

    // ── Late-detection: GPUDevice prototype spy ────────────────────────

    /**
     * Patch GPUDevice.prototype.createCommandEncoder so that even if
     * a device was created before our spy, the first createCommandEncoder
     * call (which happens every frame) triggers device discovery.
     *
     * No-op if GPUDevice is not in scope (e.g. jsdom unit tests).
     * Idempotent — safe to call multiple times.
     */
    private _installDevicePrototypeSpy(): void {
        if (this._devicePrototypePatched) return;

        let proto: any = null;
        if (typeof GPUDevice !== 'undefined') {
            proto = GPUDevice.prototype;
        }
        if (!proto || typeof proto.createCommandEncoder !== 'function') return;

        const self = this;
        this._originalCreateCommandEncoder = proto.createCommandEncoder;
        const original = this._originalCreateCommandEncoder!;

        proto.createCommandEncoder = function (this: GPUDevice, ...args: any[]) {
            // 'this' is the GPUDevice instance — discover and patch it.
            self._discoverDevice(this);
            return original.apply(this, args);
        };

        this._devicePrototypePatched = true;
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
        // Adapter created → detect WebGPU, spy on device creation
        this._gpuSpy.onAdapterCreated.add(({ adapter, info }) => {
            this._adapterInfo = info;
            this._deviceSpy.spyOnAdapter(adapter);
            this.onWebGPUDetected.trigger(info);
        });

        // Device created → spy on its queue
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
            if (this._isCapturing && this._commandTree) {
                this._commandTree.addCommand(
                    CommandType.Submit,
                    'submit',
                    { commandBufferCount: commandBuffers.length },
                );
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
     * Capture a screenshot of any active canvas on the page.
     * Uses a temporary offscreen canvas to scale down to at most 256px
     * wide, keeping capture data small. Returns a PNG data URL.
     *
     * Best-effort: returns null if no suitable canvas is found or if
     * any error occurs. Never throws.
     */
    private _captureCanvasScreenshot(): string | null {
        try {
            const canvases = document.querySelectorAll('canvas');
            for (let i = 0; i < canvases.length; i++) {
                const canvas = canvases[i];
                if (canvas.width <= 0 || canvas.height <= 0) continue;

                const MAX_WIDTH = 256;
                const scale = Math.min(1, MAX_WIDTH / canvas.width);
                const thumbWidth = Math.round(canvas.width * scale);
                const thumbHeight = Math.round(canvas.height * scale);

                const offscreen = document.createElement('canvas');
                offscreen.width = thumbWidth;
                offscreen.height = thumbHeight;
                const ctx = offscreen.getContext('2d');
                if (!ctx) continue;

                ctx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
                const dataUrl = offscreen.toDataURL('image/png');

                // Verify we got actual pixel data, not a blank canvas.
                // A blank 1×1 PNG data URL is ~90 chars; anything real is larger.
                if (dataUrl.length > 100) {
                    return dataUrl;
                }
            }
        } catch (_e) {
            // Silent fail — screenshot is best-effort.
        }
        return null;
    }

    /** Build the ICapture from current tree + resource state. */
    private _buildCapture(): ICapture {
        // Take screenshot now — the frame has been composited after 2 rAFs.
        const screenshot = this._captureCanvasScreenshot();
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
