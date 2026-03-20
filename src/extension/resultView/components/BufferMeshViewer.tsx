import React, { useMemo, useRef, useEffect, useState } from 'react';
import type {
    IBufferInfo,
    ICapture,
    ICommandNode,
    IVertexBufferLayout,
} from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';

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

// ── BufferMeshViewer — 3D wireframe via Babylon.js ───────────────────

export default function BufferMeshViewer({
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

            const eng = engine;
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

    const mat = new StandardMaterial('wireMat', scene);
    mat.wireframe = true;
    mat.emissiveColor = new Color3(0.31, 0.76, 0.97);
    mat.disableLighting = true;
    mesh.material = mat;

    return mesh;
}
