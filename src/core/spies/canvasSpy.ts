import { Observable } from '@shared/utils';
import { Logger } from '@shared/utils/logger';

/**
 * Intercepts `canvas.getContext("webgpu")` on both HTMLCanvasElement
 * and OffscreenCanvas prototypes.
 *
 * Uses direct prototype patching (not patchMethod) because getContext
 * is a DOM built-in with complex overloads, and we only care about
 * the "webgpu" context type string.
 *
 * Fires onWebGPUContextCreated when a WebGPU canvas context is created.
 */
export class CanvasSpy {
    public readonly onWebGPUContextCreated = new Observable<{
        canvas: HTMLCanvasElement | OffscreenCanvas;
        context: GPUCanvasContext;
    }>();

    private _installed = false;
    private _originalGetContext: Function | null = null;
    private _originalOffscreenGetContext: Function | null = null;

    public install(): void {
        if (this._installed) return;

        const self = this;

        // Reentrancy guard — prevents infinite recursion when other tools
        // (e.g. Spector.js embedded in Babylon playground) also patch getContext.
        let inGetContext = false;

        // Patch HTMLCanvasElement.prototype.getContext
        if (typeof HTMLCanvasElement !== 'undefined') {
            this._originalGetContext = HTMLCanvasElement.prototype.getContext;
            const origGetContext = this._originalGetContext;

            HTMLCanvasElement.prototype.getContext = function (
                this: HTMLCanvasElement,
                contextId: string,
                ...rest: any[]
            ): RenderingContext | null {
                if (inGetContext) {
                    return origGetContext.call(this, contextId, ...rest);
                }
                inGetContext = true;
                try {
                    const result = origGetContext.call(this, contextId, ...rest);
                    if (contextId === 'webgpu' && result) {
                        Logger.info('WebGPU context created on canvas');
                        self.onWebGPUContextCreated.trigger({
                            canvas: this,
                            context: result as unknown as GPUCanvasContext,
                        });
                    }
                    return result;
                } finally {
                    inGetContext = false;
                }
            } as any;
        }

        // Patch OffscreenCanvas.prototype.getContext if available
        if (typeof OffscreenCanvas !== 'undefined') {
            this._originalOffscreenGetContext = OffscreenCanvas.prototype.getContext;
            const origOffscreen = this._originalOffscreenGetContext;

            OffscreenCanvas.prototype.getContext = function (
                this: OffscreenCanvas,
                contextId: string,
                ...rest: any[]
            ): OffscreenRenderingContext | null {
                if (inGetContext) {
                    return origOffscreen.call(this, contextId, ...rest);
                }
                inGetContext = true;
                try {
                    const result = origOffscreen.call(this, contextId, ...rest);
                    if (contextId === 'webgpu' && result) {
                        Logger.info('WebGPU context created on OffscreenCanvas');
                        self.onWebGPUContextCreated.trigger({
                            canvas: this,
                            context: result as unknown as GPUCanvasContext,
                        });
                    }
                    return result;
                } finally {
                    inGetContext = false;
                }
            } as any;
        }

        this._installed = true;
        Logger.info('Canvas spy installed');
    }

    public dispose(): void {
        if (!this._installed) return;

        if (this._originalGetContext && typeof HTMLCanvasElement !== 'undefined') {
            HTMLCanvasElement.prototype.getContext = this._originalGetContext as any;
        }
        if (this._originalOffscreenGetContext && typeof OffscreenCanvas !== 'undefined') {
            OffscreenCanvas.prototype.getContext = this._originalOffscreenGetContext as any;
        }

        this.onWebGPUContextCreated.clear();
        this._originalGetContext = null;
        this._originalOffscreenGetContext = null;
        this._installed = false;
    }

    public get isInstalled(): boolean {
        return this._installed;
    }
}
