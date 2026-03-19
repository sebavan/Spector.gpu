import { Observable } from '@shared/utils';
import { Logger } from '@shared/utils/logger';
import type { IAdapterInfo } from '@shared/types';

/**
 * Intercepts `navigator.gpu.requestAdapter()` to detect adapter creation.
 *
 * Patches at the **prototype level** (`GPU.prototype.requestAdapter`) so
 * that ALL calls through ANY reference to `navigator.gpu` are intercepted —
 * even those made before this code runs, as long as the actual function
 * invocation happens after we patch the prototype. This eliminates the
 * race condition where a page's JS calls `requestAdapter()` before the
 * content script's bundle executes.
 *
 * Does NOT use ES6 Proxy — direct method replacement preserves WebGPU
 * brand checks on the underlying GPU object.
 */
export class GpuSpy {
    public readonly onAdapterCreated = new Observable<{ adapter: GPUAdapter; info: IAdapterInfo }>();
    private _installed = false;
    private _patchedPrototype: object | null = null;
    private _originalRequestAdapter: Function | null = null;

    /**
     * Install the spy by patching GPU.prototype.requestAdapter.
     *
     * Idempotent — calling install() twice is a no-op.
     * If WebGPU is not available, logs a warning and returns.
     */
    public install(): void {
        if (this._installed) return;

        const gpuProto = this._getGPUPrototype();
        if (!gpuProto) {
            Logger.warn('WebGPU not available');
            return;
        }

        const originalRequestAdapter = (gpuProto as Record<string, unknown>).requestAdapter;
        if (typeof originalRequestAdapter !== 'function') {
            Logger.warn('GPU.prototype.requestAdapter not found');
            return;
        }

        // Save for restore on dispose.
        this._originalRequestAdapter = originalRequestAdapter;
        this._patchedPrototype = gpuProto;

        const self = this;

        // Replace on the prototype — this affects ALL instances and all
        // references obtained via the prototype chain. Using a regular
        // function so `this` is the GPU instance the caller invoked on;
        // we forward it to the original via .apply for correct brand checks.
        (gpuProto as Record<string, unknown>).requestAdapter = async function (
            this: GPU,
            ...args: unknown[]
        ) {
            const adapter = await (originalRequestAdapter as Function).apply(this, args);
            if (adapter) {
                self._handleAdapterCreated(adapter as GPUAdapter);
            }
            return adapter;
        };

        this._installed = true;
        Logger.info('GPU spy installed (prototype-level)');
    }

    public dispose(): void {
        if (!this._installed) return;
        // Restore the original prototype method.
        if (this._patchedPrototype && this._originalRequestAdapter) {
            (this._patchedPrototype as Record<string, unknown>).requestAdapter =
                this._originalRequestAdapter;
        }
        this.onAdapterCreated.clear();
        this._installed = false;
        this._patchedPrototype = null;
        this._originalRequestAdapter = null;
    }

    public get isInstalled(): boolean {
        return this._installed;
    }

    // ── Private ──────────────────────────────────────────────────────

    /**
     * Locate the GPU prototype to patch.
     *
     * Strategy:
     *   1. If navigator.gpu exists, use Object.getPrototypeOf(navigator.gpu).
     *      This is the most reliable path — it works even if the global
     *      `GPU` constructor is not exposed (some browser builds).
     *   2. Fallback: use the global `GPU.prototype` if available.
     */
    private _getGPUPrototype(): object | null {
        if (typeof navigator !== 'undefined' && navigator.gpu) {
            return Object.getPrototypeOf(navigator.gpu) as object;
        }
        if (typeof GPU !== 'undefined') {
            return GPU.prototype as object;
        }
        return null;
    }

    private _handleAdapterCreated(adapter: GPUAdapter): void {
        const info: IAdapterInfo = {
            vendor: (adapter as any).info?.vendor ?? '',
            architecture: (adapter as any).info?.architecture ?? '',
            device: (adapter as any).info?.device ?? '',
            description: (adapter as any).info?.description ?? '',
            backend: (adapter as any).info?.backend ?? '',
        };
        Logger.info('Adapter created:', info.description || info.vendor);
        this.onAdapterCreated.trigger({ adapter, info });
    }
}
