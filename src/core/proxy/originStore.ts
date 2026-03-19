/**
 * Stores original (unpatched) method references so they can be restored later.
 *
 * Uses WeakMap<object, Map<string, Function>> so that entries are
 * garbage-collected when the target GPU object is no longer reachable.
 * This is important because WebGPU objects (GPUDevice, GPUBuffer, etc.)
 * can be created and destroyed frequently during a capture session.
 */
export class OriginStore {
    // WeakMap key = target object, value = Map<methodName, originalFn>
    private readonly _store = new WeakMap<object, Map<string, Function>>();

    /**
     * Save the original method BEFORE patching.
     * If the method has already been saved, this is a no-op to prevent
     * accidentally storing a previously-patched version.
     */
    public save(target: object, methodName: string): void {
        const current = (target as Record<string, unknown>)[methodName];
        if (typeof current !== 'function') return;

        let methods = this._store.get(target);
        if (!methods) {
            methods = new Map<string, Function>();
            this._store.set(target, methods);
        }

        // Guard: never overwrite a saved original.
        if (!methods.has(methodName)) {
            methods.set(methodName, current);
        }
    }

    /** Save multiple methods at once. */
    public saveAll(target: object, methodNames: readonly string[]): void {
        for (let i = 0; i < methodNames.length; i++) {
            this.save(target, methodNames[i]);
        }
    }

    /**
     * Restore a single method to its original implementation.
     * Returns true if the method was restored, false if nothing was saved.
     */
    public restore(target: object, methodName: string): boolean {
        const methods = this._store.get(target);
        if (!methods) return false;

        const original = methods.get(methodName);
        if (original === undefined) return false;

        (target as Record<string, unknown>)[methodName] = original;
        methods.delete(methodName);

        // Clean up empty inner maps to avoid holding WeakMap entries
        // that point to empty Maps.
        if (methods.size === 0) {
            this._store.delete(target);
        }
        return true;
    }

    /** Restore all saved methods on a target and remove the target entry. */
    public restoreAll(target: object): void {
        const methods = this._store.get(target);
        if (!methods) return;

        for (const [name, original] of methods) {
            (target as Record<string, unknown>)[name] = original;
        }
        this._store.delete(target);
    }

    /** Check if a method has been saved for the given target. */
    public has(target: object, methodName: string): boolean {
        const methods = this._store.get(target);
        return methods !== undefined && methods.has(methodName);
    }

    /** Get the original (unpatched) method, or undefined if not saved. */
    public getOriginal(target: object, methodName: string): Function | undefined {
        return this._store.get(target)?.get(methodName);
    }
}

/** Global singleton used by the spy layer. */
export const globalOriginStore = new OriginStore();
