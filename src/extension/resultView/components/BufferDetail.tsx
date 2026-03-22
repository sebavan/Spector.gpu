import React, { useMemo, Suspense } from 'react';
import type { IBufferInfo, ICapture, ICommandNode, IVertexBufferLayout } from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';
import { ResourceLink } from './ResourceLink';

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

const USAGE_VERTEX = 0x0020;
const USAGE_INDEX = 0x0010;

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

// ── Vertex layout resolution ─────────────────────────────────────────

interface ResolvedLayout {
    layout: IVertexBufferLayout;
    slot: number;
    pipelineId: string;
    indexBufferId?: string;
}

interface LayoutSearchStats {
    drawCallCount: number;
    passCount: number;
}

type LayoutSearchResult =
    | { resolved: ResolvedLayout; stats: LayoutSearchStats }
    | { resolved: null; stats: LayoutSearchStats };

function findVertexLayoutForBuffer(
    bufferId: string,
    capture: ICapture,
): LayoutSearchResult {
    let drawCallCount = 0;
    let passCount = 0;

    function searchCommands(nodes: readonly ICommandNode[]): ResolvedLayout | null {
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.type === 'renderPass') passCount++;
            if (node.vertexBuffers && node.pipelineId) {
                drawCallCount++;
                const slot = node.vertexBuffers.indexOf(bufferId);
                if (slot >= 0) {
                    const pipeline = resolveMapEntry(
                        capture.resources.renderPipelines, node.pipelineId,
                    );
                    if (pipeline?.vertex?.buffers?.[slot]) {
                        return {
                            layout: pipeline.vertex.buffers[slot],
                            slot,
                            pipelineId: node.pipelineId,
                            indexBufferId: node.indexBufferId,
                        };
                    }
                }
            }
            if (node.children.length > 0) {
                const found = searchCommands(node.children);
                if (found) return found;
            }
        }
        return null;
    }

    const resolved = searchCommands(capture.commands);
    return { resolved, stats: { drawCallCount, passCount } };
}

// ── Format helpers for vertex attributes ─────────────────────────────

/** Number of float32 components in a vertex format. Returns 0 for unknown. */
function formatComponentCount(format: string): number {
    if (format.includes('x4')) return 4;
    if (format.includes('x3')) return 3;
    if (format.includes('x2')) return 2;
    if (format === 'float32' || format === 'uint32' || format === 'sint32') return 1;
    return 0;
}

/** Read a single component from a DataView as a number. */
function readComponent(dv: DataView, offset: number, format: string): number {
    if (format.startsWith('float32') || format.startsWith('float16')) {
        return dv.getFloat32(offset, true);
    }
    if (format.startsWith('uint')) return dv.getUint32(offset, true);
    if (format.startsWith('sint')) return dv.getInt32(offset, true);
    // fallback: treat as float32
    return dv.getFloat32(offset, true);
}

// ── BufferDetail (top-level) ─────────────────────────────────────────

const USAGE_UNIFORM = 0x0040;
const USAGE_STORAGE = 0x0080;

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

    const isVertexBuffer = !!(usage & USAGE_VERTEX);
    const isIndexBuffer = !!(usage & USAGE_INDEX);
    const isUniformOrStorage = !!(usage & (USAGE_UNIFORM | USAGE_STORAGE));

    // Resolve vertex layout from capture pipelines (only for vertex buffers)
    const layoutResult = useMemo((): LayoutSearchResult | null => {
        if (!isVertexBuffer || isIndexBuffer) return null;
        return findVertexLayoutForBuffer(buffer.id, capture);
    }, [buffer.id, capture, isVertexBuffer, isIndexBuffer]);

    const resolved = layoutResult?.resolved ?? null;

    // Resolve index buffer data for proper wireframe rendering
    const indexInfo = useMemo(() => {
        if (!resolved?.indexBufferId) return null;
        const idxBuf = resolveMapEntry(capture.resources.buffers, resolved.indexBufferId) as IBufferInfo | undefined;
        if (!idxBuf?.dataBase64) return null;
        const binary = atob(idxBuf.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // Detect uint16 vs uint32: if buffer size = vertexCount * 2 and max index fits uint16, use uint16
        const indexFormat: 'uint16' | 'uint32' = idxBuf.size <= 65536 * 2 ? 'uint16' : 'uint32';
        return { data: bytes, format: indexFormat };
    }, [resolved?.indexBufferId, capture.resources.buffers]);

    return (
        <div className="buffer-detail">
            <div className="buffer-info-grid">
                <span className="buf-label">ID:</span>
                <span className="buf-value"><ResourceLink id={buffer.id} /></span>
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

            {resolved && <LayoutInfoCard resolved={resolved} />}

            {rawData && isVertexBuffer && !isIndexBuffer && resolved && (
                <Suspense fallback={<div className="mesh-viewer-loading">Loading 3D viewer...</div>}>
                    <LazyMeshViewer
                        rawData={rawData}
                        layout={resolved.layout}
                        indexData={indexInfo?.data}
                        indexFormat={indexInfo?.format}
                    />
                </Suspense>
            )}

            {rawData && isVertexBuffer && !isIndexBuffer && !resolved && layoutResult && (
                <div className="mesh-viewer-error">
                    No vertex layout found — searched {layoutResult.stats.drawCallCount} draw calls
                    across {layoutResult.stats.passCount} render passes
                </div>
            )}

            {rawData && isIndexBuffer && !isVertexBuffer && (
                <div className="mesh-viewer-error">
                    Index buffer — select the corresponding vertex buffer for 3D view
                </div>
            )}

            {rawData && (
                <div className="buffer-data-panels">
                    <div className="buffer-data-left">
                        {resolved && (
                            <VertexDataTable rawData={rawData} layout={resolved.layout} />
                        )}
                        {isUniformOrStorage && !isVertexBuffer && (
                            <Float32Table rawData={rawData} />
                        )}
                        {!resolved && !isUniformOrStorage && (
                            <HexDump data={rawData} maxBytes={2048} />
                        )}
                    </div>
                    <div className="buffer-data-right">
                        <HexDump data={rawData} maxBytes={2048} />
                    </div>
                </div>
            )}

            {!rawData && (
                <div className="buffer-no-data">No readback data available</div>
            )}
        </div>
    );
}

// ── LayoutInfoCard ───────────────────────────────────────────────────

function LayoutInfoCard({ resolved }: { resolved: ResolvedLayout }) {
    const { layout, pipelineId, slot } = resolved;
    return (
        <div className="layout-card">
            <h5>Vertex Layout (pipeline {pipelineId}, slot {slot}, stride {layout.arrayStride})</h5>
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

const MAX_VERTEX_ROWS = 20;

function VertexDataTable({ rawData, layout }: { rawData: Uint8Array; layout: IVertexBufferLayout }) {
    const stride = layout.arrayStride;
    if (stride === 0) return null;

    const vertexCount = Math.floor(rawData.length / stride);
    if (vertexCount === 0) return null;

    const displayCount = Math.min(vertexCount, MAX_VERTEX_ROWS);
    const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    const attrs = layout.attributes;

    // Build column headers: one per component (e.g., pos.x, pos.y, pos.z)
    const columns: { label: string; attrIdx: number; compIdx: number }[] = [];
    for (let a = 0; a < attrs.length; a++) {
        const attr = attrs[a];
        const count = formatComponentCount(attr.format);
        const suffix = count > 1 ? ['x', 'y', 'z', 'w'] : [''];
        for (let c = 0; c < count; c++) {
            columns.push({ label: `@${attr.shaderLocation}.${suffix[c]}`, attrIdx: a, compIdx: c });
        }
    }

    // Build row data
    const rows: number[][] = [];
    for (let v = 0; v < displayCount; v++) {
        const row: number[] = [];
        for (const col of columns) {
            const attr = attrs[col.attrIdx];
            const byteOffset = v * stride + attr.offset + col.compIdx * 4;
            if (byteOffset + 4 <= rawData.byteLength) {
                row.push(readComponent(dv, byteOffset, attr.format));
            } else {
                row.push(NaN);
            }
        }
        rows.push(row);
    }

    return (
        <div className="vertex-table-section">
            <h4>Vertex Data {vertexCount > MAX_VERTEX_ROWS && `(first ${MAX_VERTEX_ROWS} of ${vertexCount})`}</h4>
            <div className="vertex-table-wrap">
                <table className="vertex-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            {columns.map((col, i) => <th key={i}>{col.label}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, v) => (
                            <tr key={v}>
                                <td>{v}</td>
                                {row.map((val, c) => (
                                    <td key={c}>{Number.isNaN(val) ? '—' : val.toFixed(4)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Float32Table for UNIFORM/STORAGE buffers ─────────────────────────

const MAX_FLOAT_ROWS = 64;

function Float32Table({ rawData }: { rawData: Uint8Array }) {
    const floatCount = Math.floor(rawData.byteLength / 4);
    if (floatCount === 0) return null;

    const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    const displayFloats = Math.min(floatCount, MAX_FLOAT_ROWS * 4);
    const rowCount = Math.ceil(displayFloats / 4);

    const rows: number[][] = [];
    for (let r = 0; r < rowCount; r++) {
        const row: number[] = [];
        for (let c = 0; c < 4; c++) {
            const idx = r * 4 + c;
            if (idx < floatCount) {
                row.push(dv.getFloat32(idx * 4, true));
            }
        }
        rows.push(row);
    }

    return (
        <div className="vertex-table-section">
            <h4>Float32 Data {floatCount > MAX_FLOAT_ROWS * 4 && `(first ${MAX_FLOAT_ROWS * 4} of ${floatCount})`}</h4>
            <div className="vertex-table-wrap">
                <table className="vertex-table">
                    <thead>
                        <tr>
                            <th>Offset</th>
                            <th>[0]</th><th>[1]</th><th>[2]</th><th>[3]</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, r) => (
                            <tr key={r}>
                                <td>{r * 4}</td>
                                {row.map((val, c) => (
                                    <td key={c}>{val.toFixed(4)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
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
                {truncated &&
                    `(first ${formatBytes(maxBytes)} of ${formatBytes(data.length)})`}
            </h4>
            <pre className="hex-dump">{rows}</pre>
        </div>
    );
}

