import { Observable } from '@shared/utils';
import { Logger } from '@shared/utils/logger';
import type { IAdapterInfo } from '@shared/types';

/**
 * Intercepts `navigator.gpu.requestAdapter()` to detect adapter creation,
 * AND wraps `requestDevice` on every returned adapter so that device
 * creation is intercepted at the instance level.
 *
 * Patches at the **prototype level** (`GPU.prototype.requestAdapter`) so
 * that ALL calls through ANY reference to `navigator.gpu` are intercepted —
 * even those made before this code runs, as long as the actual function
 * invocation happens after we patch the prototype.
 *
 * CRITICAL: Chrome puts WebGPU methods as **own properties** on instances
 * (e.g. `GPUAdapter` instances have their own `requestDevice`), so
 * prototype-level patching of `GPUAdapter.prototype.requestDevice` is
 * ineffective — the instance's own property shadows it. We solve this by
 * wrapping `requestDevice` **inline** in the `requestAdapter` return path,
 * BEFORE the adapter reaches the caller. This guarantees interception
 * regardless of how the browser lays out methods.
 *
 * Does NOT use ES6 Proxy — direct method replacement preserves WebGPU
 * brand checks on the underlying GPU object.
 */
export class GpuSpy {
    public readonly onAdapterCreated = new Observable<{ adapter: GPUAdapter; info: IAdapterInfo }>();

    /**
     * Fires when a device is created through a wrapped adapter's
     * `requestDevice()`. This is the PRIMARY device discovery path —
     * it fires inside the Promise chain, before the caller's `.then()`
     * or `await` continuation sees the device.
     */
    public readonly onDeviceCreated = new Observable<GPUDevice>();

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
                // Wrap requestDevice on this adapter instance BEFORE
                // returning it to the caller or triggering onAdapterCreated.
                // By the time the caller's await/then sees the adapter,
                // requestDevice is already intercepted.
                self._wrapRequestDevice(adapter as GPUAdapter);
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
        this.onDeviceCreated.clear();
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

    /**
     * Wrap `adapter.requestDevice()` on a specific adapter instance so
     * device creation is intercepted at the instance level.
     *
     * This fires `onDeviceCreated` when the device Promise resolves,
     * BEFORE the caller's `.then()` / `await` continuation sees the device.
     *
     * The original `requestDevice` is bound to the adapter to preserve
     * WebGPU brand-check / internal-slot correctness.
     */
    private _wrapRequestDevice(adapter: GPUAdapter): void {
        const self = this;
        // Cast through `any` because GPUAdapter lacks an index signature
        // and TypeScript won't allow Record<string, unknown> cast directly.
        const adapterAny = adapter as any;
        const origRD = adapterAny.requestDevice;
        if (typeof origRD !== 'function') return;

        // Bind to the real adapter — critical for WebGPU internal slot checks.
        const boundRD = origRD.bind(adapter);

        adapterAny.requestDevice = async function (
            ...args: unknown[]
        ): Promise<GPUDevice> {
            const device = await boundRD(...args);
            if (device) {
                self.onDeviceCreated.trigger(device as GPUDevice);
            }
            return device as GPUDevice;
        };
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
