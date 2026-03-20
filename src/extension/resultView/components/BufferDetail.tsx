import React, { useMemo, useRef, useEffect, useState } from 'react';
import type {
    IBufferInfo,
    ICapture,
    ICommandNode,
    IVertexBufferLayout,
} from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';

// ── Babylon.js tree-shaken imports ───────────────────────────────────
// Side-effect imports register subsystems with the Babylon.js engine.
// Without them the engine silently skips vertex-data upload / camera input.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

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
                <BufferMeshViewer
                    buffer={buffer}
                    rawData={rawData}
                    capture={capture}
                    isIndex={isIndexBuffer && !isVertexBuffer}
                />
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

// ── BufferMeshViewer — 3D wireframe via Babylon.js ───────────────────

function BufferMeshViewer({
    buffer,
    rawData,
    capture,
    isIndex,
}: {
    buffer: IBufferInfo;
    rawData: Uint8Array;
    capture: ICapture;
    isIndex: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);

    // Resolve vertex layout from capture pipelines
    const vertexLayout = useMemo(() => {
        if (isIndex) return null;
        return findVertexLayoutForBuffer(buffer.id, capture);
    }, [buffer.id, capture, isIndex]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !rawData) return;

        if (isIndex) {
            setError(
                'Index buffer — select the corresponding vertex buffer for 3D view',
            );
            return;
        }
        if (!vertexLayout) {
            setError(
                'No vertex layout found — buffer is not bound in any draw call',
            );
            return;
        }

        let engine: Engine | null = null;
        try {
            engine = new Engine(canvas, true, {
                preserveDrawingBuffer: true,
                stencil: false,
            });

            const scene = new Scene(engine);
            scene.clearColor = new Color4(0.04, 0.04, 0.06, 1);

            const camera = new ArcRotateCamera(
                'cam',
                Math.PI / 4,
                Math.PI / 3,
                5,
                Vector3.Zero(),
                scene,
            );
            camera.attachControl(canvas, true);
            camera.wheelPrecision = 50;
            camera.minZ = 0.01;

            new HemisphericLight('light', new Vector3(0, 1, 0.5), scene);

            const mesh = createMeshFromVertexData(rawData, vertexLayout, scene);
            if (mesh) {
                const bounds = mesh.getBoundingInfo().boundingBox;
                const center = bounds.center;
                const extent = bounds.extendSize.length();
                camera.target = center;
                camera.radius = extent * 2.5;
            }

            engine.runRenderLoop(() => scene.render());

            const onResize = () => engine!.resize();
            window.addEventListener('resize', onResize);

            const eng = engine; // capture for cleanup
            return () => {
                window.removeEventListener('resize', onResize);
                eng.dispose();
            };
        } catch (e) {
            setError(`3D viewer error: ${e}`);
            if (engine) {
                try { engine.dispose(); } catch { /* best-effort */ }
            }
        }
    }, [rawData, vertexLayout, isIndex]);

    if (error) {
        return <div className="mesh-viewer-error">{error}</div>;
    }

    return (
        <div className="mesh-viewer-section">
            <h4>3D Preview</h4>
            <canvas ref={canvasRef} className="mesh-viewer-canvas" />
        </div>
    );
}

// ── Vertex layout resolution ─────────────────────────────────────────

interface ResolvedLayout {
    layout: IVertexBufferLayout;
    slot: number;
}

/**
 * Search the command tree for a draw call that binds `bufferId` as a
 * vertex buffer. Returns the matching vertex buffer layout from the
 * pipeline, or null if none found.
 */
function findVertexLayoutForBuffer(
    bufferId: string,
    capture: ICapture,
): ResolvedLayout | null {
    return findInCommands(capture.commands, (node) => {
        if (!node.vertexBuffers || !node.pipelineId) return null;
        const slot = node.vertexBuffers.indexOf(bufferId);
        if (slot < 0) return null;

        const pipeline = resolveMapEntry(
            capture.resources.renderPipelines,
            node.pipelineId,
        );
        if (!pipeline?.vertex?.buffers?.[slot]) return null;

        return { layout: pipeline.vertex.buffers[slot], slot };
    });
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

// ── Mesh construction from raw vertex data ───────────────────────────

/**
 * Parse raw vertex buffer bytes according to the pipeline's vertex
 * buffer layout and create a Babylon.js wireframe mesh.
 *
 * Only float32 position attributes are supported. Falls back gracefully
 * if the buffer is too small or the layout has no recognisable position
 * attribute.
 */
function createMeshFromVertexData(
    rawData: Uint8Array,
    layoutInfo: ResolvedLayout,
    scene: Scene,
): Mesh | null {
    const { layout } = layoutInfo;
    const stride = layout.arrayStride;
    if (stride === 0) return null;

    const vertexCount = Math.floor(rawData.length / stride);
    if (vertexCount === 0) return null;

    // Find position attribute — prefer shaderLocation 0, fallback to any float32x3/x4
    let posAttr = layout.attributes.find((a) => a.shaderLocation === 0);
    if (!posAttr) {
        posAttr = layout.attributes.find(
            (a) => a.format === 'float32x3' || a.format === 'float32x4',
        );
    }
    if (!posAttr) return null;

    const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

    // Determine component count from format string
    const components = posAttr.format.includes('x4')
        ? 4
        : posAttr.format.includes('x3')
            ? 3
            : posAttr.format.includes('x2')
                ? 2
                : 1;

    // Extract positions — always emit 3 components per vertex for Babylon
    const positions = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
        const baseOffset = v * stride + posAttr.offset;
        const outBase = v * 3;
        const readCount = Math.min(components, 3);
        for (let c = 0; c < readCount; c++) {
            positions[outBase + c] = dv.getFloat32(baseOffset + c * 4, true);
        }
        // Components beyond 3 are ignored; missing components stay 0 (Float32Array default)
    }

    // Extract normals (shaderLocation 1 if float32x3/x4)
    const normalAttr = layout.attributes.find(
        (a) =>
            a.shaderLocation === 1 &&
            (a.format === 'float32x3' || a.format === 'float32x4'),
    );
    let normals: Float32Array | undefined;
    if (normalAttr) {
        normals = new Float32Array(vertexCount * 3);
        const nComp = normalAttr.format.includes('x4') ? 4 : 3;
        const readN = Math.min(nComp, 3);
        for (let v = 0; v < vertexCount; v++) {
            const baseOffset = v * stride + normalAttr.offset;
            const outBase = v * 3;
            for (let c = 0; c < readN; c++) {
                normals[outBase + c] = dv.getFloat32(baseOffset + c * 4, true);
            }
        }
    }

    // Build sequential index list (triangle-list topology)
    const indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        indices[i] = i;
    }

    const mesh = new Mesh('bufferPreview', scene);
    const vd = new VertexData();
    vd.positions = positions;
    if (normals) vd.normals = normals;
    vd.indices = indices;
    vd.applyToMesh(mesh);

    // Wireframe material with accent color
    const mat = new StandardMaterial('wireMat', scene);
    mat.wireframe = true;
    mat.emissiveColor = new Color3(0.31, 0.76, 0.97);
    mat.disableLighting = true;
    mesh.material = mat;

    return mesh;
}
