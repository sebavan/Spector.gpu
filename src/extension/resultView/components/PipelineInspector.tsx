import React, { useMemo } from 'react';
import type { ICommandNode, ICapture, IRenderPipelineInfo, IComputePipelineInfo } from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';
import { JsonTree } from './JsonTree';

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

    return (
        <div className="pipeline-inspector">
            <h3>Pipeline: {pipeline.label ?? pipeline.id}</h3>
            <div className="pipeline-sections">
                {isRender && (
                    <>
                        <PipelineSection title="Vertex Stage" data={(pipeline as IRenderPipelineInfo).vertex} />
                        {(pipeline as IRenderPipelineInfo).fragment && (
                            <PipelineSection title="Fragment Stage" data={(pipeline as IRenderPipelineInfo).fragment} />
                        )}
                        {(pipeline as IRenderPipelineInfo).primitive && (
                            <PipelineSection title="Primitive" data={(pipeline as IRenderPipelineInfo).primitive} />
                        )}
                        {(pipeline as IRenderPipelineInfo).depthStencil && (
                            <PipelineSection title="Depth/Stencil" data={(pipeline as IRenderPipelineInfo).depthStencil} />
                        )}
                        {(pipeline as IRenderPipelineInfo).multisample && (
                            <PipelineSection title="Multisample" data={(pipeline as IRenderPipelineInfo).multisample} />
                        )}
                    </>
                )}
                {!isRender && (
                    <PipelineSection title="Compute Stage" data={(pipeline as IComputePipelineInfo).compute} />
                )}
                <PipelineSection title="Layout" data={{ layout: pipeline.layout }} />
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
