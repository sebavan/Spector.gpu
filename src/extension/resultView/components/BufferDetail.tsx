import React, { useMemo, Suspense } from 'react';
import type { IBufferInfo, ICapture } from '@shared/types';

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

    const isVertexBuffer = !!(usage & USAGE_VERTEX);
    const isIndexBuffer = !!(usage & USAGE_INDEX);

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

            {rawData && (isVertexBuffer || isIndexBuffer) && (
                <Suspense fallback={<div className="mesh-viewer-loading">Loading 3D viewer...</div>}>
                    <LazyMeshViewer
                        buffer={buffer}
                        rawData={rawData}
                        capture={capture}
                        isIndex={isIndexBuffer && !isVertexBuffer}
                    />
                </Suspense>
            )}

            {rawData && <HexDump data={rawData} maxBytes={2048} />}

            {!rawData && (
                <div className="buffer-no-data">No readback data available</div>
            )}
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

