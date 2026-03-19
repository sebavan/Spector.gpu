import { patchMethod } from '@core/proxy';
import { globalOriginStore } from '@core/proxy/originStore';
import { Observable } from '@shared/utils';

export interface ComputePassEvent {
    pass: GPUComputePassEncoder;
    methodName: string;
    args: unknown[];
}

/**
 * Intercepts all 8 GPUComputePassEncoder methods:
 *   2 dispatch, 5 state-setting, 1 end.
 *
 * Fires onDispatch for dispatchWorkgroups/dispatchWorkgroupsIndirect,
 * onEnd for end(), and onCommand for every intercepted call.
 *
 * Uses WeakSet for idempotent patching.
 */
export class ComputePassSpy {
    public readonly onCommand = new Observable<ComputePassEvent>();
    public readonly onDispatch = new Observable<ComputePassEvent>();
    public readonly onEnd = new Observable<{ pass: GPUComputePassEncoder }>();

    private readonly _patchedPasses = new WeakSet<GPUComputePassEncoder>();

    public spyOnComputePass(pass: GPUComputePassEncoder): void {
        if (this._patchedPasses.has(pass)) return;
        this._patchedPasses.add(pass);

        const self = this;

        // Dispatch calls
        const dispatchMethods = [
            'dispatchWorkgroups',
            'dispatchWorkgroupsIndirect',
        ] as const;
        for (let i = 0; i < dispatchMethods.length; i++) {
            const method: string = dispatchMethods[i];
            if (method in pass) {
                globalOriginStore.save(pass, method);
                patchMethod(pass, method, {
                    after(methodName, args) {
                        const event: ComputePassEvent = { pass, methodName, args: [...args] };
                        self.onDispatch.trigger(event);
                        self.onCommand.trigger(event);
                    },
                });
            }
        }

        // State-setting methods
        const stateMethods = [
            'setPipeline',
            'setBindGroup',
            'insertDebugMarker',
            'pushDebugGroup',
            'popDebugGroup',
        ] as const;
        for (let i = 0; i < stateMethods.length; i++) {
            const method: string = stateMethods[i];
            if (method in pass) {
                globalOriginStore.save(pass, method);
                patchMethod(pass, method, {
                    after(methodName, args) {
                        self.onCommand.trigger({ pass, methodName, args: [...args] });
                    },
                });
            }
        }

        // end
        if ('end' in pass) {
            globalOriginStore.save(pass, 'end');
            patchMethod(pass, 'end', {
                after() {
                    self.onEnd.trigger({ pass });
                },
            });
        }
    }

    public dispose(): void {
        this.onCommand.clear();
        this.onDispatch.clear();
        this.onEnd.clear();
    }
}
