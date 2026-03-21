import React, { useMemo } from 'react';
import type { ICommandNode, ICapture, IShaderModuleInfo, IRenderPipelineInfo, IComputePipelineInfo } from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';
import { ResourceLink } from './ResourceLink';

export function ShaderViewer({ node, capture }: { node: ICommandNode | null; capture: ICapture }) {
    const shaders = useMemo(() => {
        if (!node?.pipelineId) return null;

        const { resources } = capture;
        const pipeline: IRenderPipelineInfo | IComputePipelineInfo | undefined =
            resolveMapEntry(resources.renderPipelines, node.pipelineId) ??
            resolveMapEntry(resources.computePipelines, node.pipelineId);

        if (!pipeline) return null;

        const result: { label: string; code: string; moduleId: string }[] = [];

        if ('vertex' in pipeline && pipeline.vertex) {
            const mod = resolveMapEntry<IShaderModuleInfo>(resources.shaderModules, pipeline.vertex.moduleId);
            if (mod) {
                result.push({
                    label: `Vertex Shader (${pipeline.vertex.entryPoint ?? 'main'})`,
                    code: mod.code,
                    moduleId: pipeline.vertex.moduleId,
                });
            }
        }
        if ('fragment' in pipeline && pipeline.fragment) {
            const mod = resolveMapEntry<IShaderModuleInfo>(resources.shaderModules, pipeline.fragment.moduleId);
            if (mod) {
                result.push({
                    label: `Fragment Shader (${pipeline.fragment.entryPoint ?? 'main'})`,
                    code: mod.code,
                    moduleId: pipeline.fragment.moduleId,
                });
            }
        }
        if ('compute' in pipeline && pipeline.compute) {
            const mod = resolveMapEntry<IShaderModuleInfo>(resources.shaderModules, pipeline.compute.moduleId);
            if (mod) {
                result.push({
                    label: `Compute Shader (${pipeline.compute.entryPoint ?? 'main'})`,
                    code: mod.code,
                    moduleId: pipeline.compute.moduleId,
                });
            }
        }

        return result.length > 0 ? result : null;
    }, [node, capture]);

    if (!shaders) {
        return (
            <div className="shader-viewer empty">
                {node ? 'No shader associated with this command' : 'Select a draw/dispatch call to view shaders'}
            </div>
        );
    }

    return (
        <div className="shader-viewer">
            {shaders.map((shader, i) => (
                <div key={i} className="shader-section">
                    <h4>{shader.label} — <ResourceLink id={shader.moduleId} /></h4>
                    <pre className="shader-code"><code>{shader.code}</code></pre>
                </div>
            ))}
        </div>
    );
}
