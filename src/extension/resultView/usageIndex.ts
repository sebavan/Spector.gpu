/**
 * Cross-reference index: for every resource id, lists all other resources
 * and commands that reference it.
 *
 * Built once per capture and shared via props — O(n) scan, O(1) lookup.
 */

import type { ICapture, ICommandNode } from '@shared/types';

// ─── Public types ────────────────────────────────────────────────────

export interface UsageEntry {
    /** Id of the referencing resource or command. */
    readonly id: string;
    /** Human-readable description (e.g. "Render Pipeline rp_0 (vertex)"). */
    readonly label: string;
    /** Whether the referrer is a command node or another resource. */
    readonly type: 'command' | 'resource';
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Iterate key-value pairs from a Map *or* a plain object.
 * After JSON round-trip the typed Maps in IResourceMap become plain
 * objects — this helper normalises both forms without allocating an
 * intermediate array.
 */
function* iterateMap<T>(
    map: Map<string, T> | Record<string, T> | undefined,
): Generator<[string, T]> {
    if (!map) return;
    if (map instanceof Map) {
        yield* map;
    } else {
        const keys = Object.keys(map);
        for (let i = 0; i < keys.length; i++) {
            yield [keys[i], (map as Record<string, T>)[keys[i]]];
        }
    }
}

/**
 * Recursively collect all `__id` string values from a serialized args tree.
 * GPU objects are serialized as `{ __type: "GPUBuffer", __id: "buf_0" }` —
 * this walks the full object/array tree to find every such reference.
 */
function collectIds(obj: unknown, out: string[]): void {
    if (obj === null || obj === undefined || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            collectIds(obj[i], out);
        }
        return;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record.__id === 'string' && record.__id.length > 0) {
        out.push(record.__id);
    }
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i++) {
        const val = record[keys[i]];
        if (val !== null && typeof val === 'object') {
            collectIds(val, out);
        }
    }
}

/** Append to the index, deduplicating by id+type within a target. */
function addEntry(
    index: Map<string, UsageEntry[]>,
    targetId: string,
    entry: UsageEntry,
): void {
    let list = index.get(targetId);
    if (!list) {
        list = [];
        index.set(targetId, list);
    }
    // Deduplicate: same referrer id and type should appear only once.
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === entry.id && list[i].type === entry.type) return;
    }
    list.push(entry);
}

// ─── Command tree scan ───────────────────────────────────────────────

function scanCommands(
    nodes: readonly ICommandNode[],
    index: Map<string, UsageEntry[]>,
): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const entry: UsageEntry = { id: node.id, label: node.name, type: 'command' };

        if (node.pipelineId) {
            addEntry(index, node.pipelineId, entry);
        }
        if (node.indexBufferId) {
            addEntry(index, node.indexBufferId, entry);
        }
        if (node.vertexBuffers) {
            for (let v = 0; v < node.vertexBuffers.length; v++) {
                addEntry(index, node.vertexBuffers[v], entry);
            }
        }
        if (node.bindGroups) {
            for (let g = 0; g < node.bindGroups.length; g++) {
                addEntry(index, node.bindGroups[g], entry);
            }
        }

        // Deep-scan args for __id fields (serialized GPU object references)
        if (node.args) {
            const ids: string[] = [];
            collectIds(node.args, ids);
            for (let a = 0; a < ids.length; a++) {
                addEntry(index, ids[a], entry);
            }
        }

        if (node.children.length > 0) {
            scanCommands(node.children, index);
        }
    }
}

// ─── Resource graph scan ─────────────────────────────────────────────

function scanResources(
    capture: ICapture,
    index: Map<string, UsageEntry[]>,
): void {
    const res = capture.resources;

    // Render pipelines → shader modules
    for (const [id, rp] of iterateMap(res.renderPipelines)) {
        const label = rp.label ? `${id} (${rp.label})` : id;
        if (rp.vertex?.moduleId) {
            addEntry(index, rp.vertex.moduleId, {
                id, label: `Render Pipeline ${label} (vertex)`, type: 'resource',
            });
        }
        if (rp.fragment?.moduleId) {
            addEntry(index, rp.fragment.moduleId, {
                id, label: `Render Pipeline ${label} (fragment)`, type: 'resource',
            });
        }
        if (rp.layout && rp.layout !== 'auto') {
            addEntry(index, rp.layout, {
                id, label: `Render Pipeline ${label}`, type: 'resource',
            });
        }
    }

    // Compute pipelines → shader modules
    for (const [id, cp] of iterateMap(res.computePipelines)) {
        const label = cp.label ? `${id} (${cp.label})` : id;
        if (cp.compute?.moduleId) {
            addEntry(index, cp.compute.moduleId, {
                id, label: `Compute Pipeline ${label}`, type: 'resource',
            });
        }
        if (cp.layout && cp.layout !== 'auto') {
            addEntry(index, cp.layout, {
                id, label: `Compute Pipeline ${label}`, type: 'resource',
            });
        }
    }

    // Bind groups → buffers, textures, samplers, layouts
    for (const [id, bg] of iterateMap(res.bindGroups)) {
        const label = bg.label ? `${id} (${bg.label})` : id;
        if (bg.layoutId) {
            addEntry(index, bg.layoutId, {
                id, label: `Bind Group ${label}`, type: 'resource',
            });
        }
        if (bg.entries) {
            for (let e = 0; e < bg.entries.length; e++) {
                const entry = bg.entries[e];
                if (entry.resourceId) {
                    addEntry(index, entry.resourceId, {
                        id,
                        label: `Bind Group ${label} [binding ${entry.binding}]`,
                        type: 'resource',
                    });
                }
            }
        }
    }

    // Texture views → textures
    for (const [id, tv] of iterateMap(res.textureViews)) {
        if (tv.textureId) {
            const label = tv.label ? `${id} (${tv.label})` : id;
            addEntry(index, tv.textureId, {
                id, label: `Texture View ${label}`, type: 'resource',
            });
        }
    }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Build a reverse-lookup index: resource-id → list of referrers.
 * Call once per capture; the returned Map is immutable by convention.
 */
export function buildUsageIndex(capture: ICapture): Map<string, UsageEntry[]> {
    const index = new Map<string, UsageEntry[]>();
    scanCommands(capture.commands, index);
    scanResources(capture, index);
    return index;
}
