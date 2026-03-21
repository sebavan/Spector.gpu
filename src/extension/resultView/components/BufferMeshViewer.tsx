import React, { useRef, useEffect, useState } from 'react';
import type {
    IVertexBufferLayout,
} from '@shared/types';

// ── Babylon.js tree-shaken imports ───────────────────────────────────
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ── Render mode ──────────────────────────────────────────────────────

type RenderMode = 'wireframe' | 'solid' | 'points';

// ── BufferMeshViewer — 3D preview via Babylon.js ─────────────────────

export default function BufferMeshViewer({
    rawData,
    layout,
    indexData,
    indexFormat,
}: {
    rawData: Uint8Array;
    layout: IVertexBufferLayout;
    indexData?: Uint8Array;
    indexFormat?: 'uint16' | 'uint32';
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const disposedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [renderMode, setRenderMode] = useState<RenderMode>('wireframe');
    const [stats, setStats] = useState<string>('');
    const engineRef = useRef<Engine | null>(null);
    const cameraRef = useRef<ArcRotateCamera | null>(null);
    const materialRef = useRef<StandardMaterial | null>(null);

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

            const mesh = createMeshFromVertexData(rawData, layout, scene, indexData, indexFormat);
            if (mesh) {
                const bounds = mesh.getBoundingInfo().boundingBox;
                const center = bounds.center;
                const extent = bounds.extendSize.length();
                camera.target = center;
                camera.radius = extent * 2.5;

                const vertexCount = Math.floor(rawData.length / layout.arrayStride);
                const min = bounds.minimumWorld;
                const max = bounds.maximumWorld;
                setStats(
                    `${vertexCount} vertices | bounds [${min.x.toFixed(2)}, ${min.y.toFixed(2)}, ${min.z.toFixed(2)}] → [${max.x.toFixed(2)}, ${max.y.toFixed(2)}, ${max.z.toFixed(2)}]`,
                );
            }

            // Store material ref for render mode changes
            if (mesh?.material instanceof StandardMaterial) {
                materialRef.current = mesh.material;
            }

            engine.runRenderLoop(() => scene.render());

            const onResize = () => { if (!disposedRef.current && engine) engine.resize(); };
            window.addEventListener('resize', onResize);

            const eng = engine;
            return () => {
                disposedRef.current = true;
                window.removeEventListener('resize', onResize);
                engineRef.current = null;
                cameraRef.current = null;
                materialRef.current = null;
                eng.dispose();
            };
        } catch (e) {
            setError(`3D viewer error: ${e}`);
            if (engine) {
                try { engine.dispose(); } catch { /* best-effort */ }
            }
        }
    }, [rawData, layout, indexData, indexFormat]);

    // Apply render mode changes without recreating the scene
    useEffect(() => {
        const mat = materialRef.current;
        if (!mat) return;
        switch (renderMode) {
            case 'wireframe':
                mat.fillMode = Material.WireFrameFillMode;
                mat.pointsCloud = false;
                break;
            case 'solid':
                mat.fillMode = Material.TriangleFillMode;
                mat.pointsCloud = false;
                break;
            case 'points':
                mat.fillMode = Material.TriangleFillMode;
                mat.pointsCloud = true;
                mat.pointSize = 3;
                break;
        }
    }, [renderMode]);

    const handleResetCamera = () => {
        const cam = cameraRef.current;
        if (!cam) return;
        cam.alpha = Math.PI / 4;
        cam.beta = Math.PI / 3;
    };

    if (error) {
        return <div className="mesh-viewer-error">{error}</div>;
    }

    return (
        <div className="mesh-viewer-section">
            <h4>3D Preview</h4>
            <div className="mesh-viewer-toolbar">
                <button className={renderMode === 'wireframe' ? 'active' : ''} onClick={() => setRenderMode('wireframe')}>Wireframe</button>
                <button className={renderMode === 'solid' ? 'active' : ''} onClick={() => setRenderMode('solid')}>Solid</button>
                <button className={renderMode === 'points' ? 'active' : ''} onClick={() => setRenderMode('points')}>Points</button>
                <button onClick={handleResetCamera}>Reset Camera</button>
            </div>
            <canvas ref={canvasRef} className="mesh-viewer-canvas" />
            {stats && <div className="mesh-viewer-stats">{stats}</div>}
        </div>
    );
}

// ── Mesh construction from raw vertex data ───────────────────────────

function createMeshFromVertexData(
    rawData: Uint8Array,
    layout: IVertexBufferLayout,
    scene: Scene,
    indexData?: Uint8Array,
    indexFormat?: 'uint16' | 'uint32',
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
    for (let v = 0; v < vertexCount; v++) {
        const baseOffset = v * stride + posAttr.offset;
        const outBase = v * 3;
        const readCount = Math.min(components, 3);
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

    // Use actual index buffer if available, otherwise sequential
    let indices: Uint32Array;
    if (indexData && indexData.length > 0) {
        const idv = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);
        if (indexFormat === 'uint32') {
            const count = Math.floor(indexData.length / 4);
            indices = new Uint32Array(count);
            for (let i = 0; i < count; i++) {
                indices[i] = idv.getUint32(i * 4, true);
            }
        } else {
            // uint16
            const count = Math.floor(indexData.length / 2);
            indices = new Uint32Array(count);
            for (let i = 0; i < count; i++) {
                indices[i] = idv.getUint16(i * 2, true);
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
    mat.fillMode = Material.WireFrameFillMode;
    mat.emissiveColor = new Color3(0.31, 0.76, 0.97);
    mat.disableLighting = true;
    mesh.material = mat;

    return mesh;
}
