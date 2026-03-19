import { patchMethod } from '@core/proxy';
import { globalOriginStore } from '@core/proxy/originStore';
import { Observable } from '@shared/utils';

export interface RenderPassEvent {
    pass: GPURenderPassEncoder;
    methodName: string;
    args: unknown[];
}

/**
 * Intercepts all 19 GPURenderPassEncoder methods:
 *   4 draw, 14 state-setting, 1 end.
 *
 * Fires onDraw for draw/drawIndexed/drawIndirect/drawIndexedIndirect,
 * onEnd for end(), and onCommand for every intercepted call.
 *
 * Uses WeakSet for idempotent patching.
 */
export class RenderPassSpy {
    public readonly onCommand = new Observable<RenderPassEvent>();
    public readonly onDraw = new Observable<RenderPassEvent>();
    public readonly onEnd = new Observable<{ pass: GPURenderPassEncoder }>();

    private readonly _patchedPasses = new WeakSet<GPURenderPassEncoder>();

    public spyOnRenderPass(pass: GPURenderPassEncoder): void {
        if (this._patchedPasses.has(pass)) return;
        this._patchedPasses.add(pass);

        const self = this;

        // Draw calls
        const drawMethods = [
            'draw',
            'drawIndexed',
            'drawIndirect',
            'drawIndexedIndirect',
        ] as const;
        for (let i = 0; i < drawMethods.length; i++) {
            const method: string = drawMethods[i];
            if (method in pass) {
                globalOriginStore.save(pass, method);
                patchMethod(pass, method, {
                    after(methodName, args) {
                        const event: RenderPassEvent = { pass, methodName, args: [...args] };
                        self.onDraw.trigger(event);
                        self.onCommand.trigger(event);
                    },
                });
            }
        }

        // State-setting methods (14 total)
        const stateMethods = [
            'setPipeline',
            'setBindGroup',
            'setVertexBuffer',
            'setIndexBuffer',
            'setViewport',
            'setScissorRect',
            'setBlendConstant',
            'setStencilReference',
            'insertDebugMarker',
            'pushDebugGroup',
            'popDebugGroup',
            'beginOcclusionQuery',
            'endOcclusionQuery',
            'executeBundles',
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
        this.onDraw.clear();
        this.onEnd.clear();
    }
}
