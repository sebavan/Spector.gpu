import { describe, it, expect } from 'vitest';
import { serializeDescriptor, captureToJSON } from '@shared/utils/serialization';

describe('serializeDescriptor', () => {
    describe('primitives', () => {
        it('should pass through null and undefined', () => {
            expect(serializeDescriptor(null)).toBeNull();
            expect(serializeDescriptor(undefined)).toBeUndefined();
        });

        it('should pass through numbers', () => {
            expect(serializeDescriptor(0)).toBe(0);
            expect(serializeDescriptor(42)).toBe(42);
            expect(serializeDescriptor(-1.5)).toBe(-1.5);
            expect(serializeDescriptor(NaN)).toBeNaN();
            expect(serializeDescriptor(Infinity)).toBe(Infinity);
        });

        it('should pass through strings', () => {
            expect(serializeDescriptor('')).toBe('');
            expect(serializeDescriptor('hello')).toBe('hello');
        });

        it('should pass through booleans', () => {
            expect(serializeDescriptor(true)).toBe(true);
            expect(serializeDescriptor(false)).toBe(false);
        });

        it('should serialize BigInt as string with n suffix', () => {
            expect(serializeDescriptor(BigInt(123))).toBe('123n');
            expect(serializeDescriptor(BigInt(0))).toBe('0n');
        });

        it('should serialize symbols as their string representation', () => {
            expect(serializeDescriptor(Symbol('test'))).toBe('Symbol(test)');
            expect(serializeDescriptor(Symbol())).toBe('Symbol()');
        });
    });

    describe('functions', () => {
        it('should serialize named functions', () => {
            function myFunc() { /* noop */ }
            expect(serializeDescriptor(myFunc)).toBe('[Function: myFunc]');
        });

        it('should serialize anonymous functions', () => {
            // Arrow functions may get inferred names from variable assignments,
            // so we use Object.defineProperty to ensure no name.
            const fn = function() { /* noop */ };
            Object.defineProperty(fn, 'name', { value: '' });
            expect(serializeDescriptor(fn)).toBe('[Function: anonymous]');
        });
    });

    describe('ArrayBuffer', () => {
        it('should serialize ArrayBuffer with byteLength', () => {
            const buffer = new ArrayBuffer(256);
            const result = serializeDescriptor(buffer) as Record<string, unknown>;

            expect(result.__type).toBe('ArrayBuffer');
            expect(result.byteLength).toBe(256);
        });

        it('should handle zero-length ArrayBuffer', () => {
            const buffer = new ArrayBuffer(0);
            const result = serializeDescriptor(buffer) as Record<string, unknown>;

            expect(result.__type).toBe('ArrayBuffer');
            expect(result.byteLength).toBe(0);
        });
    });

    describe('TypedArrays', () => {
        it('should serialize Float32Array with type, length, and preview', () => {
            const arr = new Float32Array([1.0, 2.0, 3.0]);
            const result = serializeDescriptor(arr) as Record<string, unknown>;

            expect(result.__type).toBe('Float32Array');
            expect(result.length).toBe(3);
            expect(result.preview).toEqual([1.0, 2.0, 3.0]);
            expect(result.truncated).toBe(false);
        });

        it('should serialize Uint8Array', () => {
            const arr = new Uint8Array([10, 20, 30]);
            const result = serializeDescriptor(arr) as Record<string, unknown>;

            expect(result.__type).toBe('Uint8Array');
            expect(result.length).toBe(3);
            expect(result.preview).toEqual([10, 20, 30]);
            expect(result.truncated).toBe(false);
        });

        it('should truncate large typed arrays at 64 elements', () => {
            const arr = new Uint32Array(100);
            for (let i = 0; i < 100; i++) arr[i] = i;

            const result = serializeDescriptor(arr) as Record<string, unknown>;

            expect(result.__type).toBe('Uint32Array');
            expect(result.length).toBe(100);
            expect((result.preview as number[]).length).toBe(64);
            expect(result.truncated).toBe(true);
            // Verify preview contents
            expect((result.preview as number[])[0]).toBe(0);
            expect((result.preview as number[])[63]).toBe(63);
        });

        it('should not mark as truncated when length equals max preview', () => {
            const arr = new Float64Array(64);
            const result = serializeDescriptor(arr) as Record<string, unknown>;

            expect(result.truncated).toBe(false);
        });
    });

    describe('DataView', () => {
        it('should serialize DataView with byteLength and byteOffset', () => {
            const buffer = new ArrayBuffer(32);
            const view = new DataView(buffer, 8, 16);
            const result = serializeDescriptor(view) as Record<string, unknown>;

            expect(result.__type).toBe('DataView');
            expect(result.byteLength).toBe(16);
            expect(result.byteOffset).toBe(8);
        });
    });

    describe('circular references', () => {
        it('should produce [Circular] for circular object references', () => {
            const obj: Record<string, unknown> = { name: 'test' };
            obj.self = obj;

            const result = serializeDescriptor(obj) as Record<string, unknown>;

            expect(result.name).toBe('test');
            expect(result.self).toBe('[Circular]');
        });

        it('should handle deeper circular chains', () => {
            const a: Record<string, unknown> = { id: 'a' };
            const b: Record<string, unknown> = { id: 'b', ref: a };
            a.ref = b;

            const result = serializeDescriptor(a) as Record<string, unknown>;
            const bResult = result.ref as Record<string, unknown>;

            expect(result.id).toBe('a');
            expect(bResult.id).toBe('b');
            expect(bResult.ref).toBe('[Circular]');
        });
    });

    describe('GPU objects', () => {
        it('should serialize GPU-prefixed objects with __type and label', () => {
            // Simulate a GPU object by creating an object with a GPU-prefixed constructor name
            class GPUBuffer {
                label = 'vertex-buffer';
                size = 1024;
            }

            const gpuObj = new GPUBuffer();
            const result = serializeDescriptor(gpuObj) as Record<string, unknown>;

            expect(result.__type).toBe('GPUBuffer');
            expect(result.label).toBe('vertex-buffer');
            // Should NOT include 'size' — GPU objects are not recursed into
            expect(result).not.toHaveProperty('size');
        });

        it('should handle GPU objects without a label', () => {
            class GPUTexture {
                // no label
            }

            const gpuObj = new GPUTexture();
            const result = serializeDescriptor(gpuObj) as Record<string, unknown>;

            expect(result.__type).toBe('GPUTexture');
            expect(result.label).toBeUndefined();
        });
    });

    describe('nested objects', () => {
        it('should serialize plain objects recursively', () => {
            const descriptor = {
                format: 'bgra8unorm',
                usage: 0x10,
                size: { width: 800, height: 600 },
            };

            const result = serializeDescriptor(descriptor) as Record<string, unknown>;

            expect(result.format).toBe('bgra8unorm');
            expect(result.usage).toBe(0x10);
            expect(result.size).toEqual({ width: 800, height: 600 });
        });

        it('should serialize arrays recursively', () => {
            const arr = [1, 'two', { three: 3 }, [4]];
            const result = serializeDescriptor(arr);

            expect(result).toEqual([1, 'two', { three: 3 }, [4]]);
        });
    });

    describe('Map and Set', () => {
        it('should serialize Map with entries', () => {
            const map = new Map<string, number>([
                ['a', 1],
                ['b', 2],
            ]);
            const result = serializeDescriptor(map) as Record<string, unknown>;

            expect(result.__type).toBe('Map');
            expect(result.entries).toEqual({ a: 1, b: 2 });
        });

        it('should serialize Set with values', () => {
            const set = new Set([1, 2, 3]);
            const result = serializeDescriptor(set) as Record<string, unknown>;

            expect(result.__type).toBe('Set');
            expect(result.values).toEqual([1, 2, 3]);
        });

        it('should serialize nested values inside Map', () => {
            const map = new Map<string, unknown>([
                ['data', { nested: true }],
            ]);
            const result = serializeDescriptor(map) as Record<string, unknown>;
            const entries = result.entries as Record<string, unknown>;

            expect(entries.data).toEqual({ nested: true });
        });
    });
});

describe('captureToJSON', () => {
    it('should convert Maps to plain objects in JSON output', () => {
        const capture = {
            commands: new Map([
                ['cmd1', { type: 'draw' }],
                ['cmd2', { type: 'dispatch' }],
            ]),
        };

        const json = captureToJSON(capture);
        const parsed = JSON.parse(json);

        expect(parsed.commands.cmd1.type).toBe('draw');
        expect(parsed.commands.cmd2.type).toBe('dispatch');
    });

    it('should handle nested Maps', () => {
        const inner = new Map([['key', 'value']]);
        const outer = new Map([['nested', inner]]);

        const json = captureToJSON(outer);
        const parsed = JSON.parse(json);

        expect(parsed.nested.key).toBe('value');
    });

    it('should handle plain objects without Maps', () => {
        const data = { a: 1, b: 'hello', c: [1, 2, 3] };
        const json = captureToJSON(data);
        const parsed = JSON.parse(json);

        expect(parsed).toEqual(data);
    });
});
