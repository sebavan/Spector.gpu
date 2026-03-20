import { Observable } from '@shared/utils';
import { patchMethod } from '@core/proxy';
import { globalOriginStore } from '@core/proxy/originStore';
import { RecorderManager } from '@core/recorders';
import { Logger } from '@shared/utils/logger';

export interface DeviceSpyCallbacks {
    onCommand?: (methodName: string, args: unknown[], result: unknown) => void;
}

/**
 * Intercepts all resource-creation methods on GPUDevice.
 *
 * Patches each `create*` method, error scopes, and `destroy` on the
 * device instance. Records resource creation via RecorderManager and
 * forwards every intercepted call through the onCommand callback.
 *
 * Also subscribes to `device.lost` to detect device loss.
 *
 * Uses a WeakSet to guarantee idempotent patching — calling
 * spyOnDevice twice with the same device is a no-op.
 */
export class DeviceSpy {
    public readonly onDeviceCreated = new Observable<GPUDevice>();
    public readonly onDeviceLost = new Observable<{ device: GPUDevice; reason: string }>();

    private readonly _recorderManager: RecorderManager;
    private readonly _callbacks: DeviceSpyCallbacks;
    private readonly _patchedDevices = new WeakSet<GPUDevice>();

    // Prototype-level patching state for GPUAdapter.prototype.requestDevice.
    private _protoPatched = false;
    private _originalRequestDevice: Function | null = null;
    private _adapterPrototype: object | null = null;

    constructor(recorderManager: RecorderManager, callbacks: DeviceSpyCallbacks = {}) {
        this._recorderManager = recorderManager;
        this._callbacks = callbacks;
    }

    /**
     * Patch GPUAdapter.prototype.requestDevice so that ANY adapter —
     * including ones obtained before our spy was installed — will have
     * their requestDevice calls intercepted. This closes the race
     * where the page grabs an adapter before the content script runs.
     *
     * Idempotent. Safe to call when GPUAdapter is not available (no-op).
     */
    public installPrototypeSpy(): void {
        if (this._protoPatched) return;

        const adapterProto = this._getAdapterPrototype();
        if (!adapterProto) return;

        const originalRequestDevice = (adapterProto as Record<string, unknown>).requestDevice;
        if (typeof originalRequestDevice !== 'function') return;

        this._originalRequestDevice = originalRequestDevice;
        this._adapterPrototype = adapterProto;

        const self = this;

        (adapterProto as Record<string, unknown>).requestDevice = async function (
            this: GPUAdapter,
            ...args: unknown[]
        ) {
            const device = await (originalRequestDevice as Function).apply(this, args);
            if (device) {
                self.spyOnDevice(device as GPUDevice);
            }
            return device;
        };

        this._protoPatched = true;
    }

    /**
     * Patch an adapter's requestDevice to intercept device creation.
     */
    public spyOnAdapter(adapter: GPUAdapter): void {
        const self = this;

        globalOriginStore.save(adapter, 'requestDevice');
        patchMethod(adapter, 'requestDevice', {
            isAsync: true,
            afterResolve(_methodName, _args, device) {
                if (device) {
                    self.spyOnDevice(device as GPUDevice);
                }
            },
        });
    }

    /**
     * Patch all create* methods on a device instance.
     * Idempotent — re-patching the same device is a no-op.
     */
    public spyOnDevice(device: GPUDevice): void {
        if (this._patchedDevices.has(device)) return;
        this._patchedDevices.add(device);

        const rm = this._recorderManager;
        const cb = this._callbacks;
        const self = this;

        // Subscribe to device lost
        device.lost.then((info) => {
            Logger.warn('Device lost:', info.reason, info.message);
            this.onDeviceLost.trigger({ device, reason: info.reason });
        });

        // === Resource creation methods ===

        // createBuffer
        globalOriginStore.save(device, 'createBuffer');
        patchMethod(device, 'createBuffer', {
            before(_methodName, args) {
                // Add COPY_SRC so we can read back buffer data.
                // CRITICAL: clone the descriptor — mutating the app's object
                // breaks engines that inspect usage after createBuffer.
                // Skip MAP_READ/MAP_WRITE buffers — COPY_SRC is incompatible
                // with mappable buffers and causes WebGPU validation errors.
                const desc = args[0] as Record<string, unknown> | undefined;
                if (desc && typeof desc.usage === 'number') {
                    const usage = desc.usage as number;
                    const isMappable = !!(usage & (0x0001 | 0x0002)); // MAP_READ | MAP_WRITE
                    if (!isMappable) {
                        return [{ ...desc, usage: usage | 0x04 }]; // COPY_SRC = 0x04 for buffers
                    }
                }
            },
            after(methodName, args, result) {
                if (result) rm.recordBufferCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createTexture
        globalOriginStore.save(device, 'createTexture');
        patchMethod(device, 'createTexture', {
            before(_methodName, args) {
                // Add COPY_SRC so we can read back texture data for previews.
                // CRITICAL: clone the descriptor — mutating the app's object
                // breaks engines that inspect usage after createTexture.
                const desc = args[0] as Record<string, unknown> | undefined;
                if (desc && typeof desc.usage === 'number') {
                    return [{ ...desc, usage: (desc.usage as number) | 0x01 }];
                }
            },
            after(methodName, args, result) {
                if (result) {
                    rm.recordTextureCreation(result as object, args[0]);
                    self.patchTextureCreateView(result as GPUTexture);
                }
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createSampler
        globalOriginStore.save(device, 'createSampler');
        patchMethod(device, 'createSampler', {
            after(methodName, args, result) {
                if (result) rm.recordSamplerCreation(result as object, args[0] ?? {});
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createShaderModule
        globalOriginStore.save(device, 'createShaderModule');
        patchMethod(device, 'createShaderModule', {
            after(methodName, args, result) {
                if (result) rm.recordShaderModuleCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createRenderPipeline
        globalOriginStore.save(device, 'createRenderPipeline');
        patchMethod(device, 'createRenderPipeline', {
            after(methodName, args, result) {
                if (result) rm.recordRenderPipelineCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createRenderPipelineAsync
        globalOriginStore.save(device, 'createRenderPipelineAsync');
        patchMethod(device, 'createRenderPipelineAsync', {
            isAsync: true,
            afterResolve(methodName, args, result) {
                if (result) rm.recordRenderPipelineCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createComputePipeline
        globalOriginStore.save(device, 'createComputePipeline');
        patchMethod(device, 'createComputePipeline', {
            after(methodName, args, result) {
                if (result) rm.recordComputePipelineCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createComputePipelineAsync
        globalOriginStore.save(device, 'createComputePipelineAsync');
        patchMethod(device, 'createComputePipelineAsync', {
            isAsync: true,
            afterResolve(methodName, args, result) {
                if (result) rm.recordComputePipelineCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createBindGroup
        globalOriginStore.save(device, 'createBindGroup');
        patchMethod(device, 'createBindGroup', {
            after(methodName, args, result) {
                if (result) rm.recordBindGroupCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createBindGroupLayout
        globalOriginStore.save(device, 'createBindGroupLayout');
        patchMethod(device, 'createBindGroupLayout', {
            after(methodName, args, result) {
                if (result) rm.recordBindGroupLayoutCreation(result as object, args[0]);
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // createCommandEncoder — encoder patching is a separate concern (EncoderSpy)
        globalOriginStore.save(device, 'createCommandEncoder');
        patchMethod(device, 'createCommandEncoder', {
            after(methodName, args, result) {
                cb.onCommand?.(methodName, [...args], result);
            },
        });

        // Error scopes
        const errorScopeMethods = ['pushErrorScope', 'popErrorScope'] as const;
        for (let i = 0; i < errorScopeMethods.length; i++) {
            const method = errorScopeMethods[i];
            if (method in device) {
                globalOriginStore.save(device, method);
                patchMethod(device, method, {
                    isAsync: method === 'popErrorScope',
                    after(methodName, args, result) {
                        cb.onCommand?.(methodName, [...args], result);
                    },
                });
            }
        }

        // destroy
        if ('destroy' in device) {
            globalOriginStore.save(device, 'destroy');
            patchMethod(device, 'destroy', {
                after(methodName, args, result) {
                    cb.onCommand?.(methodName, [...args], result);
                },
            });
        }

        this.onDeviceCreated.trigger(device);
        Logger.info('Device spy installed on:', (device as any).label || 'unlabeled device');
    }

    public patchTextureCreateView(texture: GPUTexture): void {
        const rm = this._recorderManager;
        if ('createView' in texture) {
            // Guard: if already patched (e.g. canvas texture patched from
            // both getCurrentTexture hook and createTexture), skip.
            if (globalOriginStore.has(texture, 'createView')) return;
            globalOriginStore.save(texture, 'createView');
            patchMethod(texture, 'createView', {
                after(_methodName, args, result) {
                    if (result) rm.recordTextureViewCreation(result as object, texture, args[0] ?? {});
                },
            });
        }
    }

    public dispose(): void {
        // Restore prototype-level patch if installed.
        if (this._adapterPrototype && this._originalRequestDevice) {
            (this._adapterPrototype as Record<string, unknown>).requestDevice =
                this._originalRequestDevice;
        }
        this._protoPatched = false;
        this._adapterPrototype = null;
        this._originalRequestDevice = null;

        this.onDeviceCreated.clear();
        this.onDeviceLost.clear();
    }

    private _getAdapterPrototype(): object | null {
        if (typeof GPUAdapter !== 'undefined') {
            return GPUAdapter.prototype as object;
        }
        return null;
    }
}
