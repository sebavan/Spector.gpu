/**
 * Buffer readback prioritization — determines which buffers to read
 * back from the GPU after a frame capture.
 *
 * Prioritizes buffers that are actually referenced by commands in the
 * captured frame (vertex buffers, index buffers, writeBuffer targets)
 * over unreferenced buffers.
 */

import type { IBufferInfo, ICommandNode } from '@shared/types';

/** Maximum byte size of a single buffer readback (16 MB). */
const MAX_BUFFER_READBACK_SIZE = 16 * 1024 * 1024;

/** COPY_SRC usage flag — required for readback. */
const COPY_SRC = 0x0004;

/**
 * Collect all buffer IDs referenced by commands in the captured frame.
 * Walks the command tree recursively, checking vertexBuffers,
 * indexBufferId, and deep __id fields in serialized args.
 */
function collectReferencedBufferIds(
    commands: readonly ICommandNode[],
    out: Set<string>,
): void {
    for (let i = 0; i < commands.length; i++) {
        const node = commands[i];
        if (node.vertexBuffers) {
            for (let v = 0; v < node.vertexBuffers.length; v++) {
                out.add(node.vertexBuffers[v]);
            }
        }
        if (node.indexBufferId) {
            out.add(node.indexBufferId);
        }
        // Deep-scan args for __id fields (serialized GPU object references)
        collectIds(node.args, out);

        if (node.children.length > 0) {
            collectReferencedBufferIds(node.children, out);
        }
    }
}

/** Recursively collect __id values from a serialized args tree. */
function collectIds(obj: unknown, out: Set<string>): void {
    if (obj === null || obj === undefined || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) collectIds(obj[i], out);
        return;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record.__id === 'string' && record.__id.length > 0) {
        out.add(record.__id);
    }
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i++) {
        const val = record[keys[i]];
        if (val !== null && typeof val === 'object') collectIds(val, out);
    }
}

/** Check whether a buffer is eligible for GPU readback. */
function isEligible(info: IBufferInfo): boolean {
    if (info.state === 'destroyed') return false;
    if (info.state === 'mapped' || info.state === 'mapping-pending') return false;
    if (info.size === 0 || info.size > MAX_BUFFER_READBACK_SIZE) return false;
    if (!(info.usage & COPY_SRC)) return false;
    if (info.dataBase64) return false; // Already has data (e.g. from writeBuffer capture)
    return true;
}

/**
 * Select buffer IDs for GPU readback, prioritizing those referenced
 * by commands in the captured frame.
 *
 * @param buffers - All tracked buffers from RecorderManager
 * @param commands - The captured frame's command tree
 * @param maxCount - Maximum number of buffers to read back
 * @returns Ordered array of buffer IDs to read back
 */
export function selectBuffersForReadback(
    buffers: ReadonlyMap<string, IBufferInfo>,
    commands: readonly ICommandNode[],
    maxCount: number,
): string[] {
    // Collect IDs referenced by commands
    const referenced = new Set<string>();
    collectReferencedBufferIds(commands, referenced);

    const prioritized: string[] = [];
    const remaining: string[] = [];

    for (const [id, info] of buffers) {
        if (!isEligible(info)) continue;
        if (referenced.has(id)) {
            prioritized.push(id);
        } else {
            remaining.push(id);
        }
    }

    // Referenced buffers first, then fill with unreferenced
    const result = prioritized.concat(remaining);
    return result.slice(0, maxCount);
}
