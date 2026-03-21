const MAX_ARRAY_PREVIEW = 64; // max elements to serialize from typed arrays

/** Optional resolver that maps GPU objects to their tracking IDs. */
export type IdResolver = (obj: object) => string | undefined;

export function serializeDescriptor(obj: unknown, idResolver?: IdResolver): unknown {
    return serializeValue(obj, new WeakSet(), idResolver);
}

function serializeValue(value: unknown, seen: WeakSet<object>, idResolver?: IdResolver): unknown {
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;
    if (type === 'bigint') return value.toString() + 'n';
    if (type === 'function') return `[Function: ${(value as Function).name || 'anonymous'}]`;
    if (type === 'symbol') return value.toString();

    if (type !== 'object') return String(value);

    const obj = value as object;

    // Circular reference check
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    // ArrayBuffer
    if (obj instanceof ArrayBuffer) {
        return {
            __type: 'ArrayBuffer',
            byteLength: obj.byteLength,
        };
    }

    // TypedArray
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
        const name = obj.constructor.name;
        const length = (obj as unknown as { length: number }).length;
        const preview = Array.from(
            (obj as unknown as { slice(start: number, end: number): ArrayLike<number> })
                .slice(0, MAX_ARRAY_PREVIEW)
        );
        return {
            __type: name,
            length,
            preview,
            truncated: length > MAX_ARRAY_PREVIEW,
        };
    }

    // DataView
    if (obj instanceof DataView) {
        return {
            __type: 'DataView',
            byteLength: obj.byteLength,
            byteOffset: obj.byteOffset,
        };
    }

    // Array
    if (Array.isArray(obj)) {
        return obj.map(item => serializeValue(item, seen, idResolver));
    }

    // Map
    if (obj instanceof Map) {
        const entries: Record<string, unknown> = {};
        for (const [key, val] of obj) {
            entries[String(key)] = serializeValue(val, seen, idResolver);
        }
        return { __type: 'Map', entries };
    }

    // Set
    if (obj instanceof Set) {
        return { __type: 'Set', values: Array.from(obj).map(v => serializeValue(v, seen, idResolver)) };
    }

    // GPU objects — include tracked resource ID if available
    if (isGPUObject(obj)) {
        const resourceId = idResolver?.(obj);
        return {
            __type: obj.constructor?.name ?? 'GPUObject',
            label: (obj as Record<string, unknown>).label ?? undefined,
            ...(resourceId ? { __id: resourceId } : {}),
        };
    }

    // Plain object
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        result[key] = serializeValue((obj as Record<string, unknown>)[key], seen, idResolver);
    }
    return result;
}

function isGPUObject(obj: object): boolean {
    const name = obj.constructor?.name ?? '';
    return name.startsWith('GPU');
}

// Convert a capture's Maps to plain objects for JSON serialization
export function captureToJSON(capture: unknown): string {
    return JSON.stringify(capture, mapReplacer, 2);
}

function mapReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Map) {
        return Object.fromEntries(value);
    }
    return value;
}
