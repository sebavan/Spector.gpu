import React, { useMemo } from 'react';
import type { ICommandNode, ICapture, IRenderPipelineInfo, IComputePipelineInfo } from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';
import { JsonTree } from './JsonTree';
import { ResourceLink } from './ResourceLink';

export function PipelineInspector({ node, capture }: { node: ICommandNode | null; capture: ICapture }) {
    const pipeline = useMemo((): IRenderPipelineInfo | IComputePipelineInfo | null => {
        if (!node?.pipelineId) return null;
        const { resources } = capture;
        return resolveMapEntry(resources.renderPipelines, node.pipelineId)
            ?? resolveMapEntry(resources.computePipelines, node.pipelineId)
            ?? null;
    }, [node, capture]);

    if (!pipeline) {
        return (
            <div className="pipeline-inspector empty">
                {node ? 'No pipeline bound at this command' : 'Select a command to inspect pipeline state'}
            </div>
        );
    }

    const isRender = 'vertex' in pipeline;

    const rp = pipeline as IRenderPipelineInfo;
    const cpipe = pipeline as IComputePipelineInfo;

    return (
        <div className="pipeline-inspector">
            <h3>Pipeline: <ResourceLink id={pipeline.id} /> {pipeline.label && `— ${pipeline.label}`}</h3>
            <div className="pipeline-sections">
                {isRender && (
                    <>
                        <PipelineStageSection title="Vertex Stage" moduleId={rp.vertex.moduleId} data={rp.vertex} />
                        {rp.fragment && (
                            <PipelineStageSection title="Fragment Stage" moduleId={rp.fragment.moduleId} data={rp.fragment} />
                        )}
                        {rp.primitive && (
                            <PipelineSection title="Primitive" data={rp.primitive} />
                        )}
                        {rp.depthStencil && (
                            <PipelineSection title="Depth/Stencil" data={rp.depthStencil} />
                        )}
                        {rp.multisample && (
                            <PipelineSection title="Multisample" data={rp.multisample} />
                        )}
                    </>
                )}
                {!isRender && (
                    <PipelineStageSection title="Compute Stage" moduleId={cpipe.compute.moduleId} data={cpipe.compute} />
                )}
                <div className="pipeline-section">
                    <h4>Layout</h4>
                    <div style={{ marginLeft: 16, fontFamily: "'Cascadia Code', 'Consolas', monospace", fontSize: 12 }}>
                        <ResourceLink id={pipeline.layout} />
                    </div>
                </div>
            </div>
        </div>
    );
}

function PipelineSection({ title, data }: { title: string; data: unknown }) {
    return (
        <div className="pipeline-section">
            <h4>{title}</h4>
            <JsonTree data={data} />
        </div>
    );
}

/**
 * Pipeline stage section that displays the module ID as a clickable link
 * above the stage data rendered via JsonTree.
 *
 * Strips `moduleId` from the data before rendering — it's already shown as
 * a navigable link in the heading, so repeating it in the JSON tree is pure noise.
 */
function PipelineStageSection({ title, moduleId, data }: { title: string; moduleId: string; data: unknown }) {
    const filteredData = useMemo(() => {
        if (!data || typeof data !== 'object') return data;
        const { moduleId: _, ...rest } = data as Record<string, unknown>;
        return rest;
    }, [data]);

    return (
        <div className="pipeline-section">
            <h4>{title} — <ResourceLink id={moduleId} /></h4>
            <JsonTree data={filteredData} />
        </div>
    );
}
