/**
 * Resource map access helpers.
 *
 * IResourceMap declares Map<string, T> fields, but after JSON.parse()
 * they are plain objects. These helpers handle both forms without `any`.
 */

/** Lookup a single entry from a Map or plain-object record. */
export function resolveMapEntry<T>(
    map: Map<string, T> | Record<string, T> | undefined,
    key: string,
): T | undefined {
    if (!map) return undefined;
    if (map instanceof Map) return map.get(key);
    return (map as Record<string, T>)[key];
}

/** Convert a Map or plain-object record to a plain Record for iteration. */
export function resolveMapToRecord<T>(
    map: Map<string, T> | Record<string, T> | undefined,
): Record<string, T> {
    if (!map) return {} as Record<string, T>;
    if (map instanceof Map) return Object.fromEntries(map);
    return map as Record<string, T>;
}
