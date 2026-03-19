import { patchMethod } from '@core/proxy';
import { globalOriginStore } from '@core/proxy/originStore';
import { Observable } from '@shared/utils';

export interface EncoderEvent {
    encoder: GPUCommandEncoder;
    methodName: string;
    args: unknown[];
    result?: unknown;
}

/**
 * Intercepts GPUCommandEncoder methods: beginRenderPass, beginComputePass,
 * finish, and all transfer / debug commands.
 *
 * Fires typed observables for pass creation and command buffer finish,
 * plus a generic onCommand for every intercepted call.
 *
 * Uses WeakSet for idempotent patching.
 */
export class EncoderSpy {
    public readonly onBeginRenderPass = new Observable<{
        encoder: GPUCommandEncoder;
        pass: GPURenderPassEncoder;
        descriptor: unknown;
    }>();
    public readonly onBeginComputePass = new Observable<{
        encoder: GPUCommandEncoder;
        pass: GPUComputePassEncoder;
        descriptor: unknown;
    }>();
    public readonly onFinish = new Observable<{
        encoder: GPUCommandEncoder;
        commandBuffer: GPUCommandBuffer;
    }>();
    public readonly onCommand = new Observable<EncoderEvent>();

    private readonly _patchedEncoders = new WeakSet<GPUCommandEncoder>();

    public spyOnEncoder(encoder: GPUCommandEncoder): void {
        if (this._patchedEncoders.has(encoder)) return;
        this._patchedEncoders.add(encoder);

        const self = this;

        // beginRenderPass
        globalOriginStore.save(encoder, 'beginRenderPass');
        patchMethod(encoder, 'beginRenderPass', {
            after(methodName, args, result) {
                if (result) {
                    self.onBeginRenderPass.trigger({
                        encoder,
                        pass: result as GPURenderPassEncoder,
                        descriptor: args[0],
                    });
                }
                self.onCommand.trigger({ encoder, methodName, args: [...args], result });
            },
        });

        // beginComputePass
        globalOriginStore.save(encoder, 'beginComputePass');
        patchMethod(encoder, 'beginComputePass', {
            after(methodName, args, result) {
                if (result) {
                    self.onBeginComputePass.trigger({
                        encoder,
                        pass: result as GPUComputePassEncoder,
                        descriptor: args[0],
                    });
                }
                self.onCommand.trigger({ encoder, methodName, args: [...args], result });
            },
        });

        // finish
        globalOriginStore.save(encoder, 'finish');
        patchMethod(encoder, 'finish', {
            after(methodName, args, result) {
                if (result) {
                    self.onFinish.trigger({
                        encoder,
                        commandBuffer: result as GPUCommandBuffer,
                    });
                }
                self.onCommand.trigger({ encoder, methodName, args: [...args], result });
            },
        });

        // Transfer and debug methods
        const transferMethods = [
            'copyBufferToBuffer',
            'copyBufferToTexture',
            'copyTextureToBuffer',
            'copyTextureToTexture',
            'clearBuffer',
            'resolveQuerySet',
            'insertDebugMarker',
            'pushDebugGroup',
            'popDebugGroup',
        ] as const;
        for (let i = 0; i < transferMethods.length; i++) {
            const method: string = transferMethods[i];
            if (method in encoder) {
                globalOriginStore.save(encoder, method);
                patchMethod(encoder, method, {
                    after(methodName, args, result) {
                        self.onCommand.trigger({ encoder, methodName, args: [...args], result });
                    },
                });
            }
        }
    }

    public dispose(): void {
        this.onBeginRenderPass.clear();
        this.onBeginComputePass.clear();
        this.onFinish.clear();
        this.onCommand.clear();
    }
}
