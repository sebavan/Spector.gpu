import { CommandTreeBuilder } from './commandTree';
import { CommandType, ICapture, IAdapterInfo, ICaptureStats } from '@shared/types';
import { RecorderManager } from '@core/recorders';
import { QueueSpy } from '@core/spies/queueSpy';
import { EncoderSpy } from '@core/spies/encoderSpy';
import { RenderPassSpy } from '@core/spies/renderPassSpy';
import { ComputePassSpy } from '@core/spies/computePassSpy';
import { Observable, Logger } from '@shared/utils';
import { serializeDescriptor } from '@shared/utils/serialization';
import { SPECTOR_GPU_VERSION, MAX_COMMAND_COUNT, CAPTURE_TIMEOUT_MS } from '@shared/constants';

// ─── Static lookup: method name → CommandType ────────────────────────
// Hoisted to module scope so it's allocated once, not per-call.
const METHOD_TO_COMMAND_TYPE: Readonly<Record<string, CommandType>> = {
    draw: CommandType.Draw,
    drawIndexed: CommandType.Draw,
    drawIndirect: CommandType.Draw,
    drawIndexedIndirect: CommandType.Draw,
    dispatchWorkgroups: CommandType.Dispatch,
    dispatchWorkgroupsIndirect: CommandType.Dispatch,
    setPipeline: CommandType.SetPipeline,
    setBindGroup: CommandType.SetBindGroup,
    setVertexBuffer: CommandType.SetVertexBuffer,
    setIndexBuffer: CommandType.SetIndexBuffer,
    setViewport: CommandType.SetViewport,
    setScissorRect: CommandType.SetScissorRect,
    setBlendConstant: CommandType.SetBlendConstant,
    setStencilReference: CommandType.SetStencilReference,
    copyBufferToBuffer: CommandType.CopyBufferToBuffer,
    copyBufferToTexture: CommandType.CopyBufferToTexture,
    copyTextureToBuffer: CommandType.CopyTextureToBuffer,
    copyTextureToTexture: CommandType.CopyTextureToTexture,
    clearBuffer: CommandType.ClearBuffer,
    resolveQuerySet: CommandType.ResolveQuerySet,
    insertDebugMarker: CommandType.InsertDebugMarker,
    pushDebugGroup: CommandType.PushDebugGroup,
    popDebugGroup: CommandType.PopDebugGroup,
    beginOcclusionQuery: CommandType.BeginOcclusionQuery,
    endOcclusionQuery: CommandType.EndOcclusionQuery,
    executeBundles: CommandType.ExecuteBundles,
    end: CommandType.End,
};

/**
 * Records a single frame of WebGPU commands into a command tree.
 *
 * Lifecycle:
 *   1. construct(recorderManager)
 *   2. setAdapterInfo / setDeviceInfo (optional metadata)
 *   3. startCapture(spies...) — wires event listeners
 *   4. [spy events fire, tree grows]
 *   5. stopCapture() — detaches listeners, freezes tree, returns ICapture
 *
 * Invariants:
 *   - startCapture is idempotent while capturing (second call is a no-op).
 *   - stopCapture returns null if not capturing.
 *   - All listeners are removed on stop/abort/dispose — no leaks.
 *   - Command count is bounded by MAX_COMMAND_COUNT.
 *   - Wall-clock time is bounded by CAPTURE_TIMEOUT_MS.
 */
export class CaptureSession {
    public readonly onCaptureComplete = new Observable<ICapture>();
    public readonly onCaptureError = new Observable<string>();

    private readonly _recorderManager: RecorderManager;
    private _tree = new CommandTreeBuilder();
    private _isCapturing = false;
    private _startTime = 0;
    private _commandCount = 0;
    private _adapterInfo: IAdapterInfo | null = null;
    private _deviceDescriptor: Record<string, unknown> = {};
    private _deviceLimits: Record<string, number> = {};
    private _deviceFeatures: string[] = [];
    private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    // Current render/compute pass state for draw/dispatch snapshots
    private _currentPipelineId: string | null = null;
    private _currentBindGroups: string[] = [];
    private _currentVertexBuffers: string[] = [];
    private _currentIndexBufferId: string | null = null;

    // Listener teardown functions — executed once on stop/abort
    private _cleanupFns: (() => void)[] = [];

    constructor(recorderManager: RecorderManager) {
        this._recorderManager = recorderManager;
    }

    public get isCapturing(): boolean {
        return this._isCapturing;
    }

    public setAdapterInfo(info: IAdapterInfo): void {
        this._adapterInfo = info;
    }

    public setDeviceInfo(device: unknown): void {
        try {
            const d = device as Record<string, unknown>;
            if (d.limits && typeof d.limits === 'object') {
                const limits: Record<string, number> = {};
                const proto = Object.getPrototypeOf(d.limits);
                const keys = proto ? Object.getOwnPropertyNames(proto) : Object.keys(d.limits as object);
                for (let i = 0; i < keys.length; i++) {
                    const val = (d.limits as Record<string, unknown>)[keys[i]];
                    if (typeof val === 'number') limits[keys[i]] = val;
                }
                // Fallback: also check own properties (mock objects store limits as own props)
                if (Object.keys(limits).length === 0) {
                    for (const key of Object.keys(d.limits as object)) {
                        const val = (d.limits as Record<string, unknown>)[key];
                        if (typeof val === 'number') limits[key] = val;
                    }
                }
                this._deviceLimits = limits;
            }
            if (d.features) {
                this._deviceFeatures = Array.from(d.features as Iterable<string>);
            }
        } catch (e) {
            Logger.warn('Could not extract device info:', e);
        }
    }

    /**
     * Start capturing. Wire up spy event listeners.
     * Idempotent — second call while capturing is a no-op.
     */
    public startCapture(
        queueSpy: QueueSpy,
        encoderSpy: EncoderSpy,
        renderPassSpy: RenderPassSpy,
        computePassSpy: ComputePassSpy,
    ): void {
        if (this._isCapturing) return;
        this._isCapturing = true;
        this._startTime = performance.now();
        this._commandCount = 0;
        this._tree.reset();
        this._resetPassState();

        Logger.info('Capture started');

        // ─── Queue events ────────────────────────────────────────────

        const onSubmit = (e: { queue: GPUQueue; commandBuffers: GPUCommandBuffer[] }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._tree.pushScope(CommandType.Submit, 'queue.submit', {
                commandBufferCount: e.commandBuffers.length,
            });
            this._commandCount++;
        };
        queueSpy.onSubmit.add(onSubmit);
        this._cleanupFns.push(() => queueSpy.onSubmit.remove(onSubmit));

        const onWriteBuffer = (e: { queue: GPUQueue; args: unknown[] }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._tree.addCommand(CommandType.WriteBuffer, 'queue.writeBuffer', {
                args: serializeDescriptor(e.args),
            } as Record<string, unknown>);
            this._commandCount++;
        };
        queueSpy.onWriteBuffer.add(onWriteBuffer);
        this._cleanupFns.push(() => queueSpy.onWriteBuffer.remove(onWriteBuffer));

        const onWriteTexture = (e: { queue: GPUQueue; args: unknown[] }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._tree.addCommand(CommandType.WriteTexture, 'queue.writeTexture', {
                args: serializeDescriptor(e.args),
            } as Record<string, unknown>);
            this._commandCount++;
        };
        queueSpy.onWriteTexture.add(onWriteTexture);
        this._cleanupFns.push(() => queueSpy.onWriteTexture.remove(onWriteTexture));

        // ─── Encoder events ──────────────────────────────────────────

        const onBeginRenderPass = (e: { encoder: GPUCommandEncoder; pass: GPURenderPassEncoder; descriptor: unknown }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._resetPassState();
            this._tree.pushScope(CommandType.RenderPass, 'encoder.beginRenderPass', {
                descriptor: serializeDescriptor(e.descriptor),
            } as Record<string, unknown>);
            this._commandCount++;
        };
        encoderSpy.onBeginRenderPass.add(onBeginRenderPass);
        this._cleanupFns.push(() => encoderSpy.onBeginRenderPass.remove(onBeginRenderPass));

        const onBeginComputePass = (e: { encoder: GPUCommandEncoder; pass: GPUComputePassEncoder; descriptor: unknown }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._resetPassState();
            this._tree.pushScope(CommandType.ComputePass, 'encoder.beginComputePass', {
                descriptor: serializeDescriptor(e.descriptor),
            } as Record<string, unknown>);
            this._commandCount++;
        };
        encoderSpy.onBeginComputePass.add(onBeginComputePass);
        this._cleanupFns.push(() => encoderSpy.onBeginComputePass.remove(onBeginComputePass));

        const onEncoderFinish = (): void => {
            // Encoder.finish produces a command buffer; no tree action needed.
            // The submit scope is managed by queue.submit.
        };
        encoderSpy.onFinish.add(onEncoderFinish);
        this._cleanupFns.push(() => encoderSpy.onFinish.remove(onEncoderFinish));

        const onEncoderCommand = (e: { encoder: GPUCommandEncoder; methodName: string; args: unknown[] }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            // Skip beginRenderPass/beginComputePass/finish — handled above
            if (e.methodName === 'beginRenderPass' || e.methodName === 'beginComputePass' || e.methodName === 'finish') return;
            const type = METHOD_TO_COMMAND_TYPE[e.methodName] ?? CommandType.Other;
            this._tree.addCommand(type, `encoder.${e.methodName}`, {
                args: serializeDescriptor(e.args),
            } as Record<string, unknown>);
            this._commandCount++;
        };
        encoderSpy.onCommand.add(onEncoderCommand);
        this._cleanupFns.push(() => encoderSpy.onCommand.remove(onEncoderCommand));

        // ─── Render pass events ──────────────────────────────────────

        const onRenderPassCommand = (e: { pass: GPURenderPassEncoder; methodName: string; args: unknown[] }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._trackPassState(e.methodName, e.args);
            const type = METHOD_TO_COMMAND_TYPE[e.methodName] ?? CommandType.Other;
            const node = this._tree.addCommand(type, `renderPass.${e.methodName}`, {
                args: serializeDescriptor(e.args),
            } as Record<string, unknown>);
            this._commandCount++;
            // Attach state snapshot to draw calls
            if (type === CommandType.Draw) {
                node.setStateSnapshot({
                    pipelineId: this._currentPipelineId ?? undefined,
                    bindGroups: [...this._currentBindGroups],
                    vertexBuffers: [...this._currentVertexBuffers],
                    indexBufferId: this._currentIndexBufferId ?? undefined,
                });
            }
        };
        renderPassSpy.onCommand.add(onRenderPassCommand);
        this._cleanupFns.push(() => renderPassSpy.onCommand.remove(onRenderPassCommand));

        const onRenderPassEnd = (): void => {
            if (!this._isCapturing) return;
            this._tree.popScope(); // close render pass scope
            this._resetPassState();
        };
        renderPassSpy.onEnd.add(onRenderPassEnd);
        this._cleanupFns.push(() => renderPassSpy.onEnd.remove(onRenderPassEnd));

        // ─── Compute pass events ─────────────────────────────────────

        const onComputePassCommand = (e: { pass: GPUComputePassEncoder; methodName: string; args: unknown[] }): void => {
            if (!this._isCapturing || this._hitCommandLimit()) return;
            this._trackPassState(e.methodName, e.args);
            const type = METHOD_TO_COMMAND_TYPE[e.methodName] ?? CommandType.Other;
            const node = this._tree.addCommand(type, `computePass.${e.methodName}`, {
                args: serializeDescriptor(e.args),
            } as Record<string, unknown>);
            this._commandCount++;
            // Attach state snapshot to dispatch calls
            if (type === CommandType.Dispatch) {
                node.setStateSnapshot({
                    pipelineId: this._currentPipelineId ?? undefined,
                    bindGroups: [...this._currentBindGroups],
                });
            }
        };
        computePassSpy.onCommand.add(onComputePassCommand);
        this._cleanupFns.push(() => computePassSpy.onCommand.remove(onComputePassCommand));

        const onComputePassEnd = (): void => {
            if (!this._isCapturing) return;
            this._tree.popScope(); // close compute pass scope
            this._resetPassState();
        };
        computePassSpy.onEnd.add(onComputePassEnd);
        this._cleanupFns.push(() => computePassSpy.onEnd.remove(onComputePassEnd));

        // ─── Timeout guard ───────────────────────────────────────────

        this._timeoutHandle = setTimeout(() => {
            Logger.warn('Capture timed out');
            this._terminateCapture();
            this.onCaptureError.trigger('Capture timed out');
        }, CAPTURE_TIMEOUT_MS);
    }

    /**
     * Stop capturing and produce the ICapture result.
     * Returns null if not currently capturing.
     */
    public stopCapture(): ICapture | null {
        if (!this._isCapturing) return null;
        this._terminateCapture();

        const duration = performance.now() - this._startTime;
        const commands = this._tree.freeze();
        const treeStats = this._tree.getStats();
        const resourceSnapshot = this._recorderManager.snapshot();
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

        const capture: ICapture = {
            id: `capture_${Date.now()}`,
            version: SPECTOR_GPU_VERSION,
            timestamp: Date.now(),
            duration,
            adapterInfo: this._adapterInfo ?? {
                vendor: '', architecture: '', device: '', description: '', backend: '',
            },
            deviceDescriptor: this._deviceDescriptor,
            deviceLimits: this._deviceLimits,
            deviceFeatures: this._deviceFeatures,
            commands,
            resources: resourceSnapshot,
            stats,
        };

        Logger.info('Capture complete:', stats.totalCommands, 'commands,', stats.drawCalls, 'draw calls');
        this.onCaptureComplete.trigger(capture);
        return capture;
    }

    /**
     * Abort capture on device lost or other fatal error.
     * Fires onCaptureError. Does not produce an ICapture.
     */
    public abortCapture(reason: string): void {
        if (!this._isCapturing) return;
        this._terminateCapture();

        Logger.error('Capture aborted:', reason);
        this.onCaptureError.trigger(`Capture aborted: ${reason}`);
    }

    public dispose(): void {
        if (this._isCapturing) this.abortCapture('disposed');
        this.onCaptureComplete.clear();
        this.onCaptureError.clear();
    }

    // ─── Private ─────────────────────────────────────────────────────

    /**
     * Shared teardown: clear timeout, remove all listeners, set flag.
     * Called by stopCapture, abortCapture, and timeout handler.
     */
    private _terminateCapture(): void {
        this._isCapturing = false;

        if (this._timeoutHandle !== null) {
            clearTimeout(this._timeoutHandle);
            this._timeoutHandle = null;
        }

        const fns = this._cleanupFns;
        this._cleanupFns = [];
        for (let i = 0; i < fns.length; i++) {
            fns[i]();
        }
    }

    private _resetPassState(): void {
        this._currentPipelineId = null;
        this._currentBindGroups.length = 0;
        this._currentVertexBuffers.length = 0;
        this._currentIndexBufferId = null;
    }

    private _trackPassState(methodName: string, args: unknown[]): void {
        if (methodName === 'setPipeline' && args[0]) {
            this._currentPipelineId = this._recorderManager.getId(args[0] as object) ?? null;
        } else if (methodName === 'setBindGroup' && args.length >= 2) {
            const index = args[0] as number;
            const bgId = args[1] ? (this._recorderManager.getId(args[1] as object) ?? 'unknown') : 'null';
            // Grow array to fit slot index
            while (this._currentBindGroups.length <= index) {
                this._currentBindGroups.push('');
            }
            this._currentBindGroups[index] = bgId;
        } else if (methodName === 'setVertexBuffer' && args.length >= 2) {
            const slot = args[0] as number;
            const bufId = args[1] ? (this._recorderManager.getId(args[1] as object) ?? 'unknown') : 'null';
            while (this._currentVertexBuffers.length <= slot) {
                this._currentVertexBuffers.push('');
            }
            this._currentVertexBuffers[slot] = bufId;
        } else if (methodName === 'setIndexBuffer' && args[0]) {
            this._currentIndexBufferId = this._recorderManager.getId(args[0] as object) ?? null;
        }
    }

    /**
     * Returns true and triggers error if the command limit has been hit.
     * Call before adding any command.
     */
    private _hitCommandLimit(): boolean {
        if (this._commandCount >= MAX_COMMAND_COUNT) {
            Logger.warn('Command limit reached:', MAX_COMMAND_COUNT);
            this._terminateCapture();
            this.onCaptureError.trigger(`Command limit reached (${MAX_COMMAND_COUNT})`);
            return true;
        }
        return false;
    }
}
