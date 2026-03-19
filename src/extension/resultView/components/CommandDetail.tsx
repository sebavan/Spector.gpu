import React from 'react';
import type { ICommandNode, ICapture } from '@shared/types';
import { JsonTree } from './JsonTree';
import { ResourceLink } from './ResourceLink';

export function CommandDetail({ node, capture: _capture }: { node: ICommandNode | null; capture: ICapture }) {
    if (!node) {
        return <div className="command-detail empty">Select a command to view details</div>;
    }

    const hasArgs = Object.keys(node.args).length > 0;

    return (
        <div className="command-detail">
            <h3>{node.name}</h3>

            {node.visualOutput && (
                <div className="detail-section">
                    <h4>Visual Output</h4>
                    <div className="visual-output">
                        <img src={node.visualOutput} alt="render output" />
                    </div>
                </div>
            )}

            <div className="detail-section">
                <h4>Info</h4>
                <div className="detail-grid">
                    <span className="detail-label">Type:</span>
                    <span className="detail-value">{node.type}</span>
                    <span className="detail-label">ID:</span>
                    <span className="detail-value">{node.id}</span>
                    <span className="detail-label">Children:</span>
                    <span className="detail-value">{node.children.length}</span>
                </div>
            </div>

            {hasArgs && (
                <div className="detail-section">
                    <h4>Arguments</h4>
                    <JsonTree data={node.args} />
                </div>
            )}

            {node.pipelineId != null && (
                <div className="detail-section">
                    <h4>GPU State</h4>
                    <div className="detail-grid">
                        <span className="detail-label">Pipeline:</span>
                        <span className="detail-value"><ResourceLink id={node.pipelineId!} /></span>
                        {node.bindGroups != null && (
                            <>
                                <span className="detail-label">Bind Groups:</span>
                                <span className="detail-value">
                                    {node.bindGroups.length > 0
                                        ? node.bindGroups.map((bg, i) => (
                                            <React.Fragment key={bg}>
                                                {i > 0 && ', '}
                                                <ResourceLink id={bg} />
                                            </React.Fragment>
                                        ))
                                        : 'none'}
                                </span>
                            </>
                        )}
                        {node.vertexBuffers != null && (
                            <>
                                <span className="detail-label">Vertex Buffers:</span>
                                <span className="detail-value">
                                    {node.vertexBuffers.length > 0
                                        ? node.vertexBuffers.map((vb, i) => (
                                            <React.Fragment key={vb}>
                                                {i > 0 && ', '}
                                                <ResourceLink id={vb} />
                                            </React.Fragment>
                                        ))
                                        : 'none'}
                                </span>
                            </>
                        )}
                        {node.indexBufferId != null && (
                            <>
                                <span className="detail-label">Index Buffer:</span>
                                <span className="detail-value"><ResourceLink id={node.indexBufferId} /></span>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
