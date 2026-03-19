import { Observable } from '@shared/utils';
import { patchMethod } from '@core/proxy';
import { globalOriginStore } from '@core/proxy/originStore';
import { Logger } from '@shared/utils/logger';
import type { IAdapterInfo } from '@shared/types';

/**
 * Intercepts `navigator.gpu.requestAdapter()` to detect adapter creation.
 *
 * Patches the instance method on `navigator.gpu` directly (NOT via ES6
 * Proxy) so that brand checks on the underlying GPU object are preserved.
 * The origin store saves the unpatched method for clean teardown.
 */
export class GpuSpy {
    public readonly onAdapterCreated = new Observable<{ adapter: GPUAdapter; info: IAdapterInfo }>();
    private _installed = false;

    /**
     * Install the spy by patching navigator.gpu.requestAdapter.
     *
     * Idempotent — calling install() twice is a no-op.
     * If WebGPU is not available, logs a warning and returns.
     */
    public install(): void {
        if (this._installed) return;
        if (typeof navigator === 'undefined' || !navigator.gpu) {
            Logger.warn('WebGPU not available');
            return;
        }

        const gpu = navigator.gpu;
        const self = this;

        globalOriginStore.save(gpu, 'requestAdapter');
        patchMethod(gpu, 'requestAdapter', {
            isAsync: true,
            afterResolve(_methodName, _args, adapter) {
                if (adapter) {
                    const info: IAdapterInfo = {
                        vendor: (adapter as any).info?.vendor ?? '',
                        architecture: (adapter as any).info?.architecture ?? '',
                        device: (adapter as any).info?.device ?? '',
                        description: (adapter as any).info?.description ?? '',
                        backend: (adapter as any).info?.backend ?? '',
                    };
                    Logger.info('Adapter created:', info.description || info.vendor);
                    self.onAdapterCreated.trigger({ adapter: adapter as GPUAdapter, info });
                }
            },
        });

        this._installed = true;
        Logger.info('GPU spy installed');
    }

    public dispose(): void {
        if (!this._installed) return;
        if (navigator.gpu) {
            globalOriginStore.restoreAll(navigator.gpu);
        }
        this.onAdapterCreated.clear();
        this._installed = false;
    }

    public get isInstalled(): boolean {
        return this._installed;
    }
}
