import { Observable } from '@shared/utils';
import { patchMethod } from '@core/proxy';
import { globalOriginStore } from '@core/proxy/originStore';
import { Logger } from '@shared/utils/logger';

export interface QueueSubmitEvent {
    queue: GPUQueue;
    commandBuffers: GPUCommandBuffer[];
}

/**
 * Intercepts GPUQueue methods: submit, writeBuffer, writeTexture.
 *
 * Fires typed observables for each intercepted operation and forwards
 * all calls through an optional onCommand callback.
 *
 * Uses WeakSet for idempotent patching — safe to call spyOnQueue
 * multiple times with the same queue instance.
 */
export class QueueSpy {
    public readonly onSubmit = new Observable<QueueSubmitEvent>();
    public readonly onWriteBuffer = new Observable<{ queue: GPUQueue; args: unknown[] }>();
    public readonly onWriteTexture = new Observable<{ queue: GPUQueue; args: unknown[] }>();

    private readonly _patchedQueues = new WeakSet<GPUQueue>();
    private readonly _onCommand?: (methodName: string, args: unknown[], result: unknown) => void;

    constructor(onCommand?: (methodName: string, args: unknown[], result: unknown) => void) {
        this._onCommand = onCommand;
    }

    public spyOnQueue(queue: GPUQueue): void {
        if (this._patchedQueues.has(queue)) return;
        this._patchedQueues.add(queue);

        const self = this;

        // submit
        globalOriginStore.save(queue, 'submit');
        patchMethod(queue, 'submit', {
            after(methodName, args, result) {
                const cmdBuffers = (args[0] ?? []) as GPUCommandBuffer[];
                self.onSubmit.trigger({ queue, commandBuffers: Array.from(cmdBuffers) });
                self._onCommand?.(methodName, [...args], result);
            },
        });

        // writeBuffer
        globalOriginStore.save(queue, 'writeBuffer');
        patchMethod(queue, 'writeBuffer', {
            after(methodName, args, result) {
                self.onWriteBuffer.trigger({ queue, args: [...args] });
                self._onCommand?.(methodName, [...args], result);
            },
        });

        // writeTexture
        globalOriginStore.save(queue, 'writeTexture');
        patchMethod(queue, 'writeTexture', {
            after(methodName, args, result) {
                self.onWriteTexture.trigger({ queue, args: [...args] });
                self._onCommand?.(methodName, [...args], result);
            },
        });

        Logger.info('Queue spy installed');
    }

    public dispose(): void {
        this.onSubmit.clear();
        this.onWriteBuffer.clear();
        this.onWriteTexture.clear();
    }
}
