import React, { useMemo, Suspense } from 'react';
import type {
    IBufferInfo,
    ICapture,
    ICommandNode,
    IVertexBufferLayout,
} from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';

// Babylon.js is lazy-loaded to avoid crashing the page if the engine
// fails to initialize (e.g. Manifest V3 CSP blocking eval/Function).
const LazyMeshViewer = React.lazy(() => import('./BufferMeshViewer').catch(() => ({
    default: () => <div className="mesh-viewer-error">3D viewer unavailable in this context</div>,
})));

// ── Constants ────────────────────────────────────────────────────────

/** GPUBufferUsageFlags bitmask → human-readable label. Ordered by bit position. */
const USAGE_FLAGS: readonly [mask: number, label: string][] = [
    [0x0001, 'MAP_READ'],
    [0x0002, 'MAP_WRITE'],
    [0x0004, 'COPY_SRC'],
    [0x0008, 'COPY_DST'],
    [0x0010, 'INDEX'],
    [0x0020, 'VERTEX'],
    [0x0040, 'UNIFORM'],
    [0x0080, 'STORAGE'],
    [0x0100, 'INDIRECT'],
    [0x0200, 'QUERY_RESOLVE'],
];

const USAGE_VERTEX  = 0x0020;
const USAGE_INDEX   = 0x0010;
const USAGE_UNIFORM = 0x0040;
const USAGE_STORAGE = 0x0080;

// ── Helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeUsageFlags(usage: number): string[] {
    const flags: string[] = [];
    for (let i = 0; i < USAGE_FLAGS.length; i++) {
        if (usage & USAGE_FLAGS[i][0]) flags.push(USAGE_FLAGS[i][1]);
    }
    return flags;
}

/** Decode base64 string to Uint8Array. Returns null on invalid input. */
function decodeBase64(b64: string): Uint8Array | null {
    try {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
}

/** Number of float components for a GPUVertexFormat string. */
function formatComponentCount(format: string): number {
    if (format.includes('x4')) return 4;
    if (format.includes('x3')) return 3;
    if (format.includes('x2')) return 2;
    return 1;
}

/** CSS class for an attribute based on its shader location. */
function attrColorClass(shaderLocation: number): string {
    switch (shaderLocation) {
        case 0: return 'attr-pos';
        case 1: return 'attr-norm';
        case 2: return 'attr-uv';
        default: return '';
    }
}

/** Human-readable label for well-known shader locations. */
function attrLabel(shaderLocation: number): string {
    switch (shaderLocation) {
        case 0: return 'Position';
        case 1: return 'Normal';
        case 2: return 'UV';
        default: return `Attr @${shaderLocation}`;
    }
}

// ── Vertex layout resolution (runs without Babylon) ──────────────────

export interface ResolvedLayout {
    layout: IVertexBufferLayout;
    pipelineId: string;
    slot: number;
}

interface LayoutSearchStats {
    drawCallCount: number;
    passCount: number;
}

export function findVertexLayoutForBuffer(
    bufferId: string,
    capture: ICapture,
): { resolved: ResolvedLayout | null; stats: LayoutSearchStats } {
    const stats: LayoutSearchStats = { drawCallCount: 0, passCount: 0 };
    const resolved = findInCommands(capture.commands, (node) => {
        // Count passes and draw calls for diagnostics
        if (node.type === 'renderPass') stats.passCount++;
        if (node.type === 'draw') stats.drawCallCount++;

        if (!node.vertexBuffers || !node.pipelineId) return null;
        const slot = node.vertexBuffers.indexOf(bufferId);
        if (slot < 0) return null;

        const pipeline = resolveMapEntry(
            capture.resources.renderPipelines,
            node.pipelineId,
        );
        if (!pipeline?.vertex?.buffers?.[slot]) return null;

        return { layout: pipeline.vertex.buffers[slot], pipelineId: node.pipelineId, slot };
    });
    return { resolved, stats };
}

function findInCommands<T>(
    nodes: readonly ICommandNode[],
    predicate: (node: ICommandNode) => T | null,
): T | null {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const result = predicate(node);
        if (result) return result;
        if (node.children.length > 0) {
            const childResult = findInCommands(node.children, predicate);
            if (childResult) return childResult;
        }
    }
    return null;
}

// ── BufferDetail (top-level) ─────────────────────────────────────────

interface BufferDetailProps {
    buffer: IBufferInfo;
    capture: ICapture;
}

export function BufferDetail({ buffer, capture }: BufferDetailProps) {
    const usage = buffer.usage ?? 0;
    const usageFlags = decodeUsageFlags(usage);

    const rawData = useMemo(
        () => (buffer.dataBase64 ? decodeBase64(buffer.dataBase64) : null),
        [buffer.dataBase64],
    );

    const isVertexBuffer  = !!(usage & USAGE_VERTEX);
    const isIndexBuffer   = !!(usage & USAGE_INDEX);
    const isUniformBuffer = !!(usage & USAGE_UNIFORM);
    const isStorageBuffer = !!(usage & USAGE_STORAGE);

    // Resolve vertex layout outside the lazy boundary so we can show
    // the LayoutInfoCard and VertexDataTable without loading Babylon.
    const layoutResult = useMemo(() => {
        if (!isVertexBuffer) return null;
        return findVertexLayoutForBuffer(buffer.id, capture);
    }, [buffer.id, capture, isVertexBuffer]);

    const resolvedLayout = layoutResult?.resolved ?? null;

    // Detect index format from draw call state or buffer size heuristic
    const indexFormat = useMemo((): 'uint16' | 'uint32' => {
        if (!isIndexBuffer || !rawData) return 'uint16';
        // Heuristic: if buffer size isn't divisible by 4 but is by 2, it's uint16.
        // If size is divisible by 4, check if values look reasonable as uint16.
        if (rawData.length % 4 !== 0) return 'uint16';
        // Default to uint16 for small buffers, uint32 for large.
        // Real detection would come from the indexFormat in the draw call state.
        if (rawData.length > 0) {
            const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
            // Sample: if first few uint16 values are all < 65535 and buffer has
            // reasonable triangle count as uint16, prefer uint16.
            const indexCountU16 = rawData.length / 2;
            const indexCountU32 = rawData.length / 4;
            // If u32 index count wouldn't form complete triangles but u16 would, use u16.
            if (indexCountU16 % 3 === 0 && indexCountU32 % 3 !== 0) return 'uint16';
            // Check if any uint32 value would be unreasonably large
            for (let i = 0; i < Math.min(12, indexCountU32); i++) {
                if (dv.getUint32(i * 4, true) > 0xFFFF) return 'uint32';
            }
        }
        return 'uint16';
    }, [isIndexBuffer, rawData]);

    // Index buffer data for MeshViewer (pass-through for indexed rendering)
    const indexData = useMemo(() => {
        if (!isIndexBuffer || !rawData) return undefined;
        return rawData;
    }, [isIndexBuffer, rawData]);

    return (
        <div className="buffer-detail">
            <div className="buffer-info-grid">
                <span className="buf-label">ID:</span>
                <span className="buf-value">{buffer.id}</span>
                {buffer.label && (
                    <>
                        <span className="buf-label">Label:</span>
                        <span className="buf-value">{buffer.label}</span>
                    </>
                )}
                <span className="buf-label">Size:</span>
                <span className="buf-value">{formatBytes(buffer.size)}</span>
                <span className="buf-label">Usage:</span>
                <span className="buf-value buf-usage">
                    {usageFlags.join(' | ') || 'none'}
                </span>
                <span className="buf-label">State:</span>
                <span className="buf-value">{buffer.state}</span>
            </div>

            {/* Vertex buffer: layout card + 3D viewer + vertex data table */}
            {isVertexBuffer && resolvedLayout && (
                <LayoutInfoCard
                    layout={resolvedLayout.layout}
                    pipelineId={resolvedLayout.pipelineId}
                    slot={resolvedLayout.slot}
                />
            )}

            {rawData && isVertexBuffer && resolvedLayout && (
                <>
                    <Suspense fallback={<div className="mesh-viewer-loading">Loading 3D viewer…</div>}>
                        <LazyMeshViewer
                            rawData={rawData}
                            layout={resolvedLayout.layout}
                        />
                    </Suspense>
                    <VertexDataTable rawData={rawData} layout={resolvedLayout.layout} />
                </>
            )}

            {isVertexBuffer && !resolvedLayout && rawData && layoutResult && (
                <div className="mesh-viewer-error">
                    ⚠ No vertex layout found — this buffer was not bound in any draw call during the captured frame.
                    <br/>
                    <span style={{ fontSize: '11px', color: '#606070', marginTop: '4px', display: 'inline-block' }}>
                        Searched {layoutResult.stats.drawCallCount} draw calls across {layoutResult.stats.passCount} render passes.
                        Buffer ID {buffer.id} not found in any vertexBuffers binding.
                    </span>
                </div>
            )}

            {/* Index buffer: index data table */}
            {rawData && isIndexBuffer && !isVertexBuffer && (
                <IndexDataTable rawData={rawData} indexFormat={indexFormat} />
            )}

            {/* Uniform/Storage buffer: float32 view */}
            {rawData && !isVertexBuffer && !isIndexBuffer && (isUniformBuffer || isStorageBuffer) && (
                <Float32Table rawData={rawData} />
            )}

            {rawData && <HexDump data={rawData} maxBytes={2048} />}

            {!rawData && (
                <div className="buffer-no-data">No readback data available</div>
            )}
        </div>
    );
}

// ── LayoutInfoCard ───────────────────────────────────────────────────

function LayoutInfoCard({ layout, pipelineId, slot }: {
    layout: IVertexBufferLayout; pipelineId: string; slot: number;
}) {
    return (
        <div className="layout-card">
            <h5>Vertex Layout (from pipeline {pipelineId}, slot {slot}, stride {layout.arrayStride})</h5>
            {layout.attributes.map((attr, i) => (
                <div key={i} className="layout-attr">
                    <span className="la-loc">@{attr.shaderLocation}</span>
                    <span className="la-fmt">{attr.format}</span>
                    <span className="la-off">offset {attr.offset}</span>
                </div>
            ))}
        </div>
    );
}

// ── VertexDataTable ──────────────────────────────────────────────────

function VertexDataTable({ rawData, layout, maxRows = 20 }: {
    rawData: Uint8Array; layout: IVertexBufferLayout; maxRows?: number;
}) {
    const stride = layout.arrayStride;
    const vertexCount = stride > 0 ? Math.floor(rawData.length / stride) : 0;
    const displayCount = Math.min(vertexCount, maxRows);

    const rows = useMemo(() => {
        if (vertexCount === 0 || stride === 0) return [];
        const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        const result: { values: string[][] }[] = [];
        for (let v = 0; v < displayCount; v++) {
            const attrValues: string[][] = [];
            for (let a = 0; a < layout.attributes.length; a++) {
                const attr = layout.attributes[a];
                const components = formatComponentCount(attr.format);
                const base = v * stride + attr.offset;
                const vals: string[] = [];
                for (let c = 0; c < components; c++) {
                    const off = base + c * 4;
                    if (off + 4 <= rawData.byteLength) {
                        vals.push(dv.getFloat32(off, true).toFixed(4));
                    }
                }
                attrValues.push(vals);
            }
            result.push({ values: attrValues });
        }
        return result;
    }, [rawData, layout, stride, vertexCount, displayCount]);

    if (vertexCount === 0) return null;

    const remaining = vertexCount - displayCount;

    return (
        <div className="vertex-table-section">
            <h4>Vertex Data (first {displayCount.toLocaleString()} of {vertexCount.toLocaleString()})</h4>
            <table className="vertex-table">
                <thead>
                    <tr>
                        <th>#</th>
                        {layout.attributes.map((attr, i) => {
                            const comps = formatComponentCount(attr.format);
                            const label = attrLabel(attr.shaderLocation);
                            const compLabels = comps <= 2 ? '(u, v)' : comps === 3 ? '(x, y, z)' : '(x, y, z, w)';
                            return <th key={i}>{label} {compLabels}</th>;
                        })}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, v) => (
                        <tr key={v}>
                            <td className="vtx-idx">{v}</td>
                            {row.values.map((vals, a) => (
                                <td key={a} className={attrColorClass(layout.attributes[a].shaderLocation)}>
                                    {vals.join(', ')}
                                </td>
                            ))}
                        </tr>
                    ))}
                    {remaining > 0 && (
                        <tr className="trunc-row">
                            <td colSpan={1 + layout.attributes.length}>
                                … {remaining.toLocaleString()} more vertices
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

// ── IndexDataTable ───────────────────────────────────────────────────

function IndexDataTable({ rawData, indexFormat, maxTriangles = 20 }: {
    rawData: Uint8Array; indexFormat: 'uint16' | 'uint32'; maxTriangles?: number;
}) {
    const bytesPerIndex = indexFormat === 'uint32' ? 4 : 2;
    const indexCount = Math.floor(rawData.length / bytesPerIndex);
    const triangleCount = Math.floor(indexCount / 3);
    const displayCount = Math.min(triangleCount, maxTriangles);

    const triangles = useMemo(() => {
        if (triangleCount === 0) return [];
        const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        const result: [number, number, number][] = [];
        const read = indexFormat === 'uint32'
            ? (off: number) => dv.getUint32(off, true)
            : (off: number) => dv.getUint16(off, true);
        for (let t = 0; t < displayCount; t++) {
            const base = t * 3 * bytesPerIndex;
            result.push([read(base), read(base + bytesPerIndex), read(base + bytesPerIndex * 2)]);
        }
        return result;
    }, [rawData, indexFormat, bytesPerIndex, triangleCount, displayCount]);

    if (triangleCount === 0) return null;
    const remaining = triangleCount - displayCount;

    return (
        <div className="vertex-table-section">
            <h4>Index Data ({indexFormat}, {indexCount.toLocaleString()} indices = {triangleCount.toLocaleString()} triangles)</h4>
            <table className="vertex-table">
                <thead>
                    <tr><th>Triangle</th><th>v0</th><th>v1</th><th>v2</th></tr>
                </thead>
                <tbody>
                    {triangles.map(([v0, v1, v2], t) => (
                        <tr key={t}>
                            <td className="vtx-idx">{t}</td>
                            <td>{v0}</td><td>{v1}</td><td>{v2}</td>
                        </tr>
                    ))}
                    {remaining > 0 && (
                        <tr className="trunc-row">
                            <td colSpan={4}>… {remaining.toLocaleString()} more triangles</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

// ── Float32Table (uniform/storage) ───────────────────────────────────

function Float32Table({ rawData, maxRows = 20 }: {
    rawData: Uint8Array; maxRows?: number;
}) {
    const floatCount = Math.floor(rawData.length / 4);
    const rowCount = Math.ceil(floatCount / 4);
    const displayRows = Math.min(rowCount, maxRows);

    const rows = useMemo(() => {
        if (floatCount === 0) return [];
        const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        const result: { offset: number; values: string[] }[] = [];
        for (let r = 0; r < displayRows; r++) {
            const vals: string[] = [];
            for (let c = 0; c < 4; c++) {
                const idx = r * 4 + c;
                if (idx < floatCount) {
                    vals.push(dv.getFloat32(idx * 4, true).toFixed(4));
                }
            }
            result.push({ offset: r * 16, values: vals });
        }
        return result;
    }, [rawData, floatCount, displayRows]);

    if (floatCount === 0) return null;
    const remaining = rowCount - displayRows;

    return (
        <div className="vertex-table-section">
            <h4>Float32 View ({floatCount} values)</h4>
            <table className="vertex-table">
                <thead>
                    <tr><th>Offset</th><th>float[0]</th><th>float[1]</th><th>float[2]</th><th>float[3]</th></tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.offset}>
                            <td className="vtx-idx">{row.offset}</td>
                            {row.values.map((v, i) => <td key={i}>{v}</td>)}
                        </tr>
                    ))}
                    {remaining > 0 && (
                        <tr className="trunc-row">
                            <td colSpan={5}>… {remaining} more rows</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

// ── HexDump ──────────────────────────────────────────────────────────

function HexDump({ data, maxBytes }: { data: Uint8Array; maxBytes: number }) {
    const truncated = data.length > maxBytes;
    const displayData = truncated ? data.subarray(0, maxBytes) : data;

    // Build all rows in a single pass — one string allocation.
    const rows = useMemo(() => {
        const lines: string[] = [];
        const len = displayData.length;
        for (let offset = 0; offset < len; offset += 16) {
            const hex: string[] = [];
            let ascii = '';
            for (let i = 0; i < 16; i++) {
                if (offset + i < len) {
                    const byte = displayData[offset + i];
                    hex.push(byte.toString(16).padStart(2, '0'));
                    ascii += byte >= 0x20 && byte <= 0x7e
                        ? String.fromCharCode(byte)
                        : '.';
                } else {
                    hex.push('  ');
                    ascii += ' ';
                }
            }
            const addr = offset.toString(16).padStart(8, '0');
            lines.push(
                `${addr}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`,
            );
        }
        return lines.join('\n');
    }, [displayData]);

    return (
        <div className="hex-dump-section">
            <h4>
                Raw Data{' '}
                {truncated
                    ? `(first ${formatBytes(maxBytes)} of ${formatBytes(data.length)})`
                    : `(${formatBytes(data.length)})`}
            </h4>
            <pre className="hex-dump">{rows}</pre>
        </div>
    );
}

