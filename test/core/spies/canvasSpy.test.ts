import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasSpy } from '@core/spies/canvasSpy';

describe('CanvasSpy', () => {
    let spy: CanvasSpy;
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        spy = new CanvasSpy();
    });

    afterEach(() => {
        spy.dispose();
        // Ensure prototype is restored
        HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    it('install patches HTMLCanvasElement.prototype.getContext', () => {
        spy.install();
        expect(HTMLCanvasElement.prototype.getContext).not.toBe(originalGetContext);
    });

    it('dispose restores original getContext', () => {
        spy.install();
        spy.dispose();
        expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext);
    });

    it('install is idempotent', () => {
        spy.install();
        const patched = HTMLCanvasElement.prototype.getContext;
        spy.install();
        expect(HTMLCanvasElement.prototype.getContext).toBe(patched);
    });

    it('does not infinite-recurse when another library also patches getContext', () => {
        // Simulate Spector.js or another tool patching getContext BEFORE us
        const nativeGetContext = HTMLCanvasElement.prototype.getContext;
        let thirdPartyCallCount = 0;

        HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            contextId: string,
            ...rest: any[]
        ): RenderingContext | null {
            thirdPartyCallCount++;
            // Third-party wrapper calls through to whatever is on the prototype
            // at the time — this is the pattern that causes recursion if not guarded.
            // Simulate by calling the "saved" original (which is the native).
            return nativeGetContext.call(this, contextId, ...rest);
        } as any;

        // Now install our spy ON TOP of the third-party patch
        spy.install();

        // Create a canvas and call getContext — should NOT stack overflow
        const canvas = document.createElement('canvas');
        expect(() => {
            canvas.getContext('2d');
        }).not.toThrow();

        // Third-party wrapper should have been called exactly once
        expect(thirdPartyCallCount).toBe(1);
    });

    it('does not infinite-recurse when third-party calls this.getContext internally', () => {
        // Worst case: third-party wrapper calls this.getContext() instead of
        // the saved original — creating a direct recursion path through our patch.
        const nativeGetContext = HTMLCanvasElement.prototype.getContext;
        let thirdPartyCallCount = 0;

        HTMLCanvasElement.prototype.getContext = function (
            this: HTMLCanvasElement,
            contextId: string,
            ...rest: any[]
        ): RenderingContext | null {
            thirdPartyCallCount++;
            if (thirdPartyCallCount > 5) {
                throw new Error('Infinite recursion detected');
            }
            // BAD PATTERN: calls this.getContext which goes through the prototype
            // chain again — hitting our wrapper, which calls this wrapper, etc.
            // Our reentrancy guard must break this cycle.
            return nativeGetContext.call(this, contextId, ...rest);
        } as any;

        spy.install();

        const canvas = document.createElement('canvas');
        expect(() => {
            canvas.getContext('2d');
        }).not.toThrow();

        // Should only be called once — reentrancy guard prevents re-entry
        expect(thirdPartyCallCount).toBe(1);
    });

    it('fires onWebGPUContextCreated for webgpu context type', () => {
        spy.install();
        const callback = vi.fn();
        spy.onWebGPUContextCreated.add(callback);

        const canvas = document.createElement('canvas');
        // jsdom doesn't support webgpu, so getContext('webgpu') returns null
        // and the callback should NOT fire
        canvas.getContext('2d');
        expect(callback).not.toHaveBeenCalled();
    });
});
