import { describe, it, expect } from 'vitest';
import { OriginStore, globalOriginStore } from '@core/proxy/originStore';

// ---------- helpers ----------

function makeObject() {
    return {
        draw(): string {
            return 'original-draw';
        },
        submit(): string {
            return 'original-submit';
        },
        end(): string {
            return 'original-end';
        },
    };
}

// ---------- tests ----------

describe('OriginStore', () => {
    it('save + restore round-trips correctly', () => {
        const store = new OriginStore();
        const obj = makeObject();
        const originalDraw = obj.draw;

        store.save(obj, 'draw');

        // Simulate patching
        obj.draw = () => 'patched';
        expect(obj.draw()).toBe('patched');

        // Restore
        const restored = store.restore(obj, 'draw');
        expect(restored).toBe(true);
        expect(obj.draw).toBe(originalDraw);
        expect(obj.draw()).toBe('original-draw');
    });

    it('save does not overwrite if already saved (prevents saving patched version)', () => {
        const store = new OriginStore();
        const obj = makeObject();
        const originalDraw = obj.draw;

        store.save(obj, 'draw');

        // Patch the method
        obj.draw = () => 'patched';

        // Save again — should NOT overwrite with the patched version
        store.save(obj, 'draw');

        expect(store.getOriginal(obj, 'draw')).toBe(originalDraw);
    });

    it('restoreAll restores all methods and removes the target entry', () => {
        const store = new OriginStore();
        const obj = makeObject();
        const originalDraw = obj.draw;
        const originalSubmit = obj.submit;

        store.save(obj, 'draw');
        store.save(obj, 'submit');

        // Patch both
        obj.draw = () => 'patched-draw';
        obj.submit = () => 'patched-submit';

        store.restoreAll(obj);

        expect(obj.draw).toBe(originalDraw);
        expect(obj.submit).toBe(originalSubmit);

        // After restoreAll, has() should return false
        expect(store.has(obj, 'draw')).toBe(false);
        expect(store.has(obj, 'submit')).toBe(false);
    });

    it('restore returns false if nothing was saved', () => {
        const store = new OriginStore();
        const obj = makeObject();

        expect(store.restore(obj, 'draw')).toBe(false);
    });

    it('restore returns false for unknown method on a known target', () => {
        const store = new OriginStore();
        const obj = makeObject();

        store.save(obj, 'draw');
        expect(store.restore(obj, 'submit')).toBe(false);
    });

    it('has() returns true for saved methods and false otherwise', () => {
        const store = new OriginStore();
        const obj = makeObject();

        expect(store.has(obj, 'draw')).toBe(false);

        store.save(obj, 'draw');
        expect(store.has(obj, 'draw')).toBe(true);
        expect(store.has(obj, 'submit')).toBe(false);
    });

    it('getOriginal returns the saved function', () => {
        const store = new OriginStore();
        const obj = makeObject();
        const originalDraw = obj.draw;

        store.save(obj, 'draw');
        expect(store.getOriginal(obj, 'draw')).toBe(originalDraw);
    });

    it('getOriginal returns undefined for unsaved methods', () => {
        const store = new OriginStore();
        const obj = makeObject();

        expect(store.getOriginal(obj, 'draw')).toBeUndefined();
    });

    it('saveAll saves multiple methods at once', () => {
        const store = new OriginStore();
        const obj = makeObject();
        const originalDraw = obj.draw;
        const originalSubmit = obj.submit;
        const originalEnd = obj.end;

        store.saveAll(obj, ['draw', 'submit', 'end']);

        expect(store.has(obj, 'draw')).toBe(true);
        expect(store.has(obj, 'submit')).toBe(true);
        expect(store.has(obj, 'end')).toBe(true);

        expect(store.getOriginal(obj, 'draw')).toBe(originalDraw);
        expect(store.getOriginal(obj, 'submit')).toBe(originalSubmit);
        expect(store.getOriginal(obj, 'end')).toBe(originalEnd);
    });

    it('save skips non-function properties', () => {
        const store = new OriginStore();
        const obj = { value: 42, name: 'test' } as any;

        // Should not throw, should not store
        store.save(obj, 'value');
        store.save(obj, 'name');
        store.save(obj, 'nonexistent');

        expect(store.has(obj, 'value')).toBe(false);
        expect(store.has(obj, 'name')).toBe(false);
        expect(store.has(obj, 'nonexistent')).toBe(false);
    });

    it('restore cleans up inner map when last method is restored', () => {
        const store = new OriginStore();
        const obj = makeObject();

        store.save(obj, 'draw');
        obj.draw = () => 'patched';

        store.restore(obj, 'draw');

        // After the last method is restored, has() for any method should be false
        // (the inner Map is deleted from WeakMap)
        expect(store.has(obj, 'draw')).toBe(false);
    });
});

describe('globalOriginStore', () => {
    it('is an instance of OriginStore', () => {
        expect(globalOriginStore).toBeInstanceOf(OriginStore);
    });
});
