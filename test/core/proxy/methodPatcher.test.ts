import { describe, it, expect, vi } from 'vitest';
import { patchMethod, patchMethods, type PatchOptions } from '@core/proxy/methodPatcher';

// ---------- helpers ----------

/** Creates a fake GPU-like object with brand-check simulation. */
function makeFakeGPUObject() {
    const secret = Symbol('brand');
    const obj = {
        [secret]: true,
        /** Simulates a brand-checked method: throws if `this` is wrong. */
        draw(vertexCount: number, instanceCount: number): string {
            if (!(this as any)[secret]) {
                throw new TypeError('Illegal invocation (brand check failed)');
            }
            return `draw:${vertexCount}:${instanceCount}`;
        },
        setViewport(x: number, y: number): string {
            return `viewport:${x}:${y}`;
        },
        explode(): never {
            throw new Error('GPU lost');
        },
    };
    return obj;
}

function makeAsyncObject() {
    return {
        async createBuffer(size: number): Promise<{ id: number; size: number }> {
            return { id: 42, size };
        },
    };
}

// ---------- tests ----------

describe('patchMethod', () => {
    it('calls the after interceptor with correct args, result, and target', () => {
        const obj = makeFakeGPUObject();
        const afterSpy = vi.fn();

        patchMethod(obj, 'setViewport', { after: afterSpy });

        const result = obj.setViewport(10, 20);

        expect(result).toBe('viewport:10:20');
        expect(afterSpy).toHaveBeenCalledOnce();
        expect(afterSpy).toHaveBeenCalledWith(
            'setViewport',
            [10, 20],
            'viewport:10:20',
            obj
        );
    });

    it('calls afterResolve with the resolved value for async methods', async () => {
        const obj = makeAsyncObject();
        const afterResolveSpy = vi.fn();
        const afterSpy = vi.fn();

        patchMethod(obj, 'createBuffer', {
            isAsync: true,
            afterResolve: afterResolveSpy,
            after: afterSpy,
        });

        const result = await obj.createBuffer(256);

        expect(result).toEqual({ id: 42, size: 256 });

        // afterResolve is called first, then after
        expect(afterResolveSpy).toHaveBeenCalledOnce();
        expect(afterResolveSpy).toHaveBeenCalledWith(
            'createBuffer',
            [256],
            { id: 42, size: 256 },
            obj
        );

        expect(afterSpy).toHaveBeenCalledOnce();
        expect(afterSpy).toHaveBeenCalledWith(
            'createBuffer',
            [256],
            { id: 42, size: 256 },
            obj
        );
    });

    it('before hook can modify arguments', () => {
        const obj = makeFakeGPUObject();
        const afterSpy = vi.fn();

        patchMethod(obj, 'setViewport', {
            before: (_name, args) => {
                // Double both coordinates
                return [(args[0] as number) * 2, (args[1] as number) * 2];
            },
            after: afterSpy,
        });

        const result = obj.setViewport(5, 10);

        // Original was called with modified args
        expect(result).toBe('viewport:10:20');
        expect(afterSpy).toHaveBeenCalledWith(
            'setViewport',
            [10, 20],   // modified args
            'viewport:10:20',
            obj
        );
    });

    it('before hook returning void preserves original args', () => {
        const obj = makeFakeGPUObject();
        const afterSpy = vi.fn();

        patchMethod(obj, 'setViewport', {
            before: () => {
                // no return — void
            },
            after: afterSpy,
        });

        const result = obj.setViewport(1, 2);

        expect(result).toBe('viewport:1:2');
        expect(afterSpy).toHaveBeenCalledWith('setViewport', [1, 2], 'viewport:1:2', obj);
    });

    it('preserves correct this context (brand check simulation)', () => {
        const obj = makeFakeGPUObject();
        const afterSpy = vi.fn();

        patchMethod(obj, 'draw', { after: afterSpy });

        // If `this` were wrong, `draw` would throw TypeError.
        const result = obj.draw(3, 1);

        expect(result).toBe('draw:3:1');
        expect(afterSpy).toHaveBeenCalledWith('draw', [3, 1], 'draw:3:1', obj);
    });

    it('calls after hook and re-throws when original method throws', () => {
        const obj = makeFakeGPUObject();
        const afterSpy = vi.fn();

        patchMethod(obj, 'explode', { after: afterSpy });

        expect(() => (obj as any).explode()).toThrow('GPU lost');

        expect(afterSpy).toHaveBeenCalledOnce();
        expect(afterSpy).toHaveBeenCalledWith('explode', [], undefined, obj);
    });

    it('logs warning and does not crash when patching a non-function', () => {
        const obj = { value: 42 } as any;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Should not throw
        expect(() => patchMethod(obj, 'nonexistent', {})).not.toThrow();

        // Logger.warn prints to console.warn with [Spector.GPU] prefix
        expect(warnSpy).toHaveBeenCalledWith(
            '[Spector.GPU]',
            'Cannot patch nonexistent: not a function'
        );

        warnSpy.mockRestore();
    });

    it('last patch wins when method is patched multiple times', () => {
        const obj = makeFakeGPUObject();
        const firstAfter = vi.fn();
        const secondAfter = vi.fn();

        patchMethod(obj, 'setViewport', { after: firstAfter });
        patchMethod(obj, 'setViewport', { after: secondAfter });

        obj.setViewport(1, 1);

        // Second patch wraps the first patch. The second after fires.
        expect(secondAfter).toHaveBeenCalledOnce();
    });

    it('does not call afterResolve for sync methods even if isAsync is true', () => {
        // If isAsync is true but the method returns a non-Promise value,
        // the result instanceof Promise check fails and afterResolve is skipped.
        const obj = makeFakeGPUObject();
        const afterResolveSpy = vi.fn();
        const afterSpy = vi.fn();

        patchMethod(obj, 'setViewport', {
            isAsync: true,
            afterResolve: afterResolveSpy,
            after: afterSpy,
        });

        const result = obj.setViewport(1, 2);

        expect(result).toBe('viewport:1:2');
        expect(afterResolveSpy).not.toHaveBeenCalled();
        expect(afterSpy).toHaveBeenCalledOnce();
    });
});

describe('patchMethods', () => {
    it('patches all existing methods and skips missing ones', () => {
        const obj = makeFakeGPUObject();
        const afterSpy = vi.fn();

        patchMethods(obj, ['draw', 'setViewport', 'doesNotExist'], {
            after: afterSpy,
        });

        obj.draw(6, 1);
        obj.setViewport(0, 0);

        // Two calls, one for each existing method
        expect(afterSpy).toHaveBeenCalledTimes(2);
        expect(afterSpy).toHaveBeenCalledWith('draw', [6, 1], 'draw:6:1', obj);
        expect(afterSpy).toHaveBeenCalledWith('setViewport', [0, 0], 'viewport:0:0', obj);
    });
});
