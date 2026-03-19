import { Logger } from '@shared/utils';

export type MethodInterceptor = (
    methodName: string,
    args: readonly unknown[],
    result: unknown,
    target: object
) => void;

export type AsyncMethodInterceptor = (
    methodName: string,
    args: readonly unknown[],
    result: unknown,
    target: object
) => void;

export interface PatchOptions {
    /** Called BEFORE the original method. Return a new args array to modify arguments. */
    before?: (methodName: string, args: unknown[]) => unknown[] | void;
    /** Called AFTER the original method (or after Promise resolves for async). */
    after?: MethodInterceptor;
    /** For async methods: called after the Promise resolves with the resolved value. */
    afterResolve?: AsyncMethodInterceptor;
    /** If true, wrap Promise-returning methods to intercept resolved values. */
    isAsync?: boolean;
}

/**
 * Patches a single method on a target object by replacing it in-place.
 *
 * CRITICAL: We bind the original method to the target so that `this`
 * is always the real GPU object, not a proxy. This prevents WebGPU
 * brand-check / internal-slot failures that would occur with ES6 Proxy.
 *
 * The caller is responsible for saving the original via OriginStore
 * BEFORE calling this function if restore capability is needed.
 */
export function patchMethod(
    target: object,
    methodName: string,
    options: PatchOptions
): void {
    const original = (target as Record<string, unknown>)[methodName];
    if (typeof original !== 'function') {
        Logger.warn(`Cannot patch ${methodName}: not a function`);
        return;
    }

    // Bind to the real target so the original always executes with
    // the correct `this` — critical for WebGPU brand checks.
    const bound = original.bind(target);

    // Replace the method on the instance directly (no Proxy).
    // Using a plain function (not arrow) so we don't capture an
    // outer `this`, but we never read `this` inside — we always
    // use the closed-over `target` reference.
    (target as Record<string, unknown>)[methodName] = function patchedMethod(
        ...args: unknown[]
    ): unknown {
        // --- Pre-call hook ---
        let finalArgs = args;
        if (options.before) {
            const modified = options.before(methodName, args);
            if (modified !== undefined) {
                finalArgs = modified;
            }
        }

        // --- Call original ---
        let result: unknown;
        try {
            result = bound(...finalArgs);
        } catch (e: unknown) {
            // Record the failed call, then re-throw.
            options.after?.(methodName, finalArgs, undefined, target);
            throw e;
        }

        // --- Async interception ---
        if (options.isAsync && result instanceof Promise) {
            return result.then((resolved: unknown) => {
                options.afterResolve?.(methodName, finalArgs, resolved, target);
                options.after?.(methodName, finalArgs, resolved, target);
                return resolved;
            });
        }

        // --- Sync post-call hook ---
        options.after?.(methodName, finalArgs, result, target);
        return result;
    };
}

/**
 * Patches multiple methods on a target with the same interceptor options.
 * Methods that don't exist on the target are silently skipped (no warning).
 */
export function patchMethods(
    target: object,
    methodNames: readonly string[],
    options: PatchOptions
): void {
    for (let i = 0; i < methodNames.length; i++) {
        if (methodNames[i] in target) {
            patchMethod(target, methodNames[i], options);
        }
    }
}
