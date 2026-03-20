import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { IVertexBufferLayout } from '@shared/types';

// ── Babylon.js tree-shaken imports ───────────────────────────────────
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ── Types ────────────────────────────────────────────────────────────

type RenderMode = 'wireframe' | 'solid' | 'points';

interface BufferMeshViewerProps {
    rawData: Uint8Array;
    layout: IVertexBufferLayout;
    indexData?: Uint8Array;
    indexFormat?: 'uint16' | 'uint32';
}

interface MeshStats {
    vertices: number;
    triangles: number;
    boundsMin: [number, number, number];
    boundsMax: [number, number, number];
}

// ── BufferMeshViewer — 3D wireframe via Babylon.js ───────────────────

export default function BufferMeshViewer({
    rawData,
    layout,
    indexData,
    indexFormat,
}: BufferMeshViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const meshRef = useRef<Mesh | null>(null);
    const matRef = useRef<StandardMaterial | null>(null);
    const cameraRef = useRef<ArcRotateCamera | null>(null);
    const disposedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [renderMode, setRenderMode] = useState<RenderMode>('wireframe');
    const [stats, setStats] = useState<MeshStats | null>(null);

    // ── Build mesh stats without Babylon (pure math) ──
    const meshStats = useMemo((): MeshStats | null => {
        const stride = layout.arrayStride;
        if (stride === 0) return null;
        const vertexCount = Math.floor(rawData.length / stride);
        if (vertexCount === 0) return null;

        let posAttr = layout.attributes.find((a) => a.shaderLocation === 0);
        if (!posAttr) {
            posAttr = layout.attributes.find(
                (a) => a.format === 'float32x3' || a.format === 'float32x4',
            );
        }
        if (!posAttr) return null;

        const components = posAttr.format.includes('x4') ? 4
            : posAttr.format.includes('x3') ? 3
            : posAttr.format.includes('x2') ? 2 : 1;
        const readCount = Math.min(components, 3);

        const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
        const min: [number, number, number] = [Infinity, Infinity, Infinity];
        const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

        for (let v = 0; v < vertexCount; v++) {
            const base = v * stride + posAttr.offset;
            for (let c = 0; c < readCount; c++) {
                const val = dv.getFloat32(base + c * 4, true);
                if (val < min[c]) min[c] = val;
                if (val > max[c]) max[c] = val;
            }
        }
        // Fill missing components with 0
        for (let c = readCount; c < 3; c++) {
            min[c] = 0;
            max[c] = 0;
        }

        const triangles = indexData
            ? Math.floor(indexData.length / (indexFormat === 'uint32' ? 4 : 2) / 3)
            : Math.floor(vertexCount / 3);

        return { vertices: vertexCount, triangles, boundsMin: min, boundsMax: max };
    }, [rawData, layout, indexData, indexFormat]);

    // ── Apply render mode to existing material ──
    const applyRenderMode = useCallback((mode: RenderMode, mat: StandardMaterial) => {
        switch (mode) {
            case 'wireframe':
                mat.wireframe = true;
                mat.pointsCloud = false;
                mat.emissiveColor = new Color3(0.31, 0.76, 0.97);
                mat.disableLighting = true;
                break;
            case 'solid':
                mat.wireframe = false;
                mat.pointsCloud = false;
                mat.emissiveColor = new Color3(0.15, 0.38, 0.48);
                mat.disableLighting = false;
                break;
            case 'points':
                mat.wireframe = false;
                mat.pointsCloud = true;
                mat.pointSize = 3;
                mat.emissiveColor = new Color3(0.31, 0.76, 0.97);
                mat.disableLighting = true;
                break;
        }
    }, []);

    // ── Initialize Babylon scene ──
    useEffect(() => {
        const canvas = canvasRef.current;
        disposedRef.current = false;
        if (!canvas || !rawData) return;

        let engine: Engine | null = null;
        try {
            engine = new Engine(canvas, true, {
                preserveDrawingBuffer: true,
                stencil: false,
            });
            engineRef.current = engine;

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
            cameraRef.current = camera;

            new HemisphericLight('light', new Vector3(0, 1, 0.5), scene);

            const mesh = createMeshFromVertexData(rawData, layout, indexData, indexFormat, scene);
            meshRef.current = mesh;

            if (mesh) {
                const bounds = mesh.getBoundingInfo().boundingBox;
                const center = bounds.center;
                const extent = bounds.extendSize.length();
                camera.target = center.clone();
                camera.radius = extent * 2.5;

                const mat = mesh.material as StandardMaterial;
                matRef.current = mat;
                applyRenderMode(renderMode, mat);

                const min = bounds.minimumWorld;
                const max = bounds.maximumWorld;
                setStats({
                    vertices: meshStats?.vertices ?? 0,
                    triangles: meshStats?.triangles ?? 0,
                    boundsMin: [min.x, min.y, min.z],
                    boundsMax: [max.x, max.y, max.z],
                });
            }

            engine.runRenderLoop(() => scene.render());

            const onResize = () => { if (!disposedRef.current && engineRef.current) engineRef.current.resize(); };
            window.addEventListener('resize', onResize);

            const eng = engine;
            return () => {
                disposedRef.current = true;
                window.removeEventListener('resize', onResize);
                engineRef.current = null;
                meshRef.current = null;
                matRef.current = null;
                cameraRef.current = null;
                eng.dispose();
            };
        } catch (e) {
            setError(`3D viewer error: ${e}`);
            if (engine) {
                try { engine.dispose(); } catch { /* best-effort */ }
            }
        }
    // We intentionally exclude renderMode — handled in the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawData, layout, indexData, indexFormat]);

    // ── Update render mode on material without re-creating scene ──
    useEffect(() => {
        if (matRef.current) {
            applyRenderMode(renderMode, matRef.current);
        }
    }, [renderMode, applyRenderMode]);

    const resetCamera = useCallback(() => {
        const mesh = meshRef.current;
        const camera = cameraRef.current;
        if (!mesh || !camera) return;
        const bounds = mesh.getBoundingInfo().boundingBox;
        camera.target = bounds.center.clone();
        camera.radius = bounds.extendSize.length() * 2.5;
        camera.alpha = Math.PI / 4;
        camera.beta = Math.PI / 3;
    }, []);

    if (error) {
        return <div className="mesh-viewer-error">{error}</div>;
    }

    const fmtV = (v: number) => v.toFixed(1);

    return (
        <div className="mesh-viewer-section">
            <h4>3D Preview</h4>
            <div className="mesh-viewer-toolbar">
                <button
                    className={renderMode === 'wireframe' ? 'active' : ''}
                    onClick={() => setRenderMode('wireframe')}
                >Wireframe</button>
                <button
                    className={renderMode === 'solid' ? 'active' : ''}
                    onClick={() => setRenderMode('solid')}
                >Solid</button>
                <button
                    className={renderMode === 'points' ? 'active' : ''}
                    onClick={() => setRenderMode('points')}
                >Points</button>
                <button onClick={resetCamera}>Reset Camera</button>
            </div>
            <canvas ref={canvasRef} className="mesh-viewer-canvas" />
            {stats && (
                <div className="mesh-viewer-stats">
                    Vertices: <span>{stats.vertices.toLocaleString()}</span>
                    &nbsp; Triangles: <span>{stats.triangles.toLocaleString()}</span>
                    &nbsp; Bounds: <span>
                        [{fmtV(stats.boundsMin[0])}, {fmtV(stats.boundsMin[1])}, {fmtV(stats.boundsMin[2])}]
                        → [{fmtV(stats.boundsMax[0])}, {fmtV(stats.boundsMax[1])}, {fmtV(stats.boundsMax[2])}]
                    </span>
                </div>
            )}
        </div>
    );
}

// ── Mesh construction from raw vertex data ───────────────────────────

function createMeshFromVertexData(
    rawData: Uint8Array,
    layout: IVertexBufferLayout,
    indexData: Uint8Array | undefined,
    indexFormat: 'uint16' | 'uint32' | undefined,
    scene: Scene,
): Mesh | null {
    const stride = layout.arrayStride;
    if (stride === 0) return null;

    const vertexCount = Math.floor(rawData.length / stride);
    if (vertexCount === 0) return null;

    let posAttr = layout.attributes.find((a) => a.shaderLocation === 0);
    if (!posAttr) {
        posAttr = layout.attributes.find(
            (a) => a.format === 'float32x3' || a.format === 'float32x4',
        );
    }
    if (!posAttr) return null;

    const dv = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

    const components = posAttr.format.includes('x4')
        ? 4
        : posAttr.format.includes('x3')
            ? 3
            : posAttr.format.includes('x2')
                ? 2
                : 1;

    const positions = new Float32Array(vertexCount * 3);
    const readCount = Math.min(components, 3);
    for (let v = 0; v < vertexCount; v++) {
        const baseOffset = v * stride + posAttr.offset;
        const outBase = v * 3;
        for (let c = 0; c < readCount; c++) {
            positions[outBase + c] = dv.getFloat32(baseOffset + c * 4, true);
        }
    }

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

    // Build index array: use provided index data or generate sequential.
    let indices: Uint32Array;
    if (indexData && indexData.length > 0) {
        const idxDv = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);
        if (indexFormat === 'uint32') {
            const count = Math.floor(indexData.length / 4);
            indices = new Uint32Array(count);
            for (let i = 0; i < count; i++) {
                indices[i] = idxDv.getUint32(i * 4, true);
            }
        } else {
            const count = Math.floor(indexData.length / 2);
            indices = new Uint32Array(count);
            for (let i = 0; i < count; i++) {
                indices[i] = idxDv.getUint16(i * 2, true);
            }
        }
    } else {
        indices = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            indices[i] = i;
        }
    }

    const mesh = new Mesh('bufferPreview', scene);
    const vd = new VertexData();
    vd.positions = positions;
    if (normals) vd.normals = normals;
    vd.indices = indices;
    vd.applyToMesh(mesh);

    const mat = new StandardMaterial('wireMat', scene);
    mat.wireframe = true;
    mat.emissiveColor = new Color3(0.31, 0.76, 0.97);
    mat.disableLighting = true;
    mesh.material = mat;

    return mesh;
}
