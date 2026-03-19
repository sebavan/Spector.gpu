import React, { useState, useCallback } from 'react';
import { CommandType } from '@shared/types';
import type { ICommandNode } from '@shared/types';

interface CommandTreeProps {
    commands: readonly ICommandNode[];
    selectedId: string | null;
    onSelect: (node: ICommandNode) => void;
}

export function CommandTree({ commands, selectedId, onSelect }: CommandTreeProps) {
    return (
        <div className="command-tree">
            <div className="tree-header">
                <h2>Commands</h2>
            </div>
            <div className="tree-content">
                {commands.map(cmd => (
                    <TreeNode
                        key={cmd.id}
                        node={cmd}
                        depth={0}
                        selectedId={selectedId}
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </div>
    );
}

function TreeNode({ node, depth, selectedId, onSelect }: {
    node: ICommandNode;
    depth: number;
    selectedId: string | null;
    onSelect: (node: ICommandNode) => void;
}) {
    const [expanded, setExpanded] = useState(depth < 2);
    const hasChildren = node.children.length > 0;
    const isSelected = node.id === selectedId;
    const typeClass = getTypeClass(node.type);

    const handleClick = useCallback(() => {
        onSelect(node);
    }, [node, onSelect]);

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(prev => !prev);
    }, []);

    return (
        <div className="tree-node-container">
            <div
                className={`tree-node ${typeClass}${isSelected ? ' selected' : ''}`}
                style={{ paddingLeft: `${depth * 20 + 8}px` }}
                onClick={handleClick}
            >
                {hasChildren ? (
                    <span className="toggle" onClick={handleToggle}>
                        {expanded ? '▼' : '▶'}
                    </span>
                ) : (
                    <span className="toggle-spacer" />
                )}
                <span className={`type-badge ${typeClass}`}>{getTypeLabel(node.type)}</span>
                <span className="node-name">{node.name}</span>
                {hasChildren && (
                    <span className="child-count">({node.children.length})</span>
                )}
            </div>
            {expanded && hasChildren && (
                <div className="tree-children">
                    {node.children.map(child => (
                        <TreeNode
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            selectedId={selectedId}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function getTypeClass(type: CommandType): string {
    switch (type) {
        case CommandType.Submit:         return 'type-submit';
        case CommandType.RenderPass:     return 'type-renderpass';
        case CommandType.ComputePass:    return 'type-computepass';
        case CommandType.Draw:           return 'type-draw';
        case CommandType.Dispatch:       return 'type-dispatch';
        case CommandType.SetPipeline:
        case CommandType.SetBindGroup:
        case CommandType.SetVertexBuffer:
        case CommandType.SetIndexBuffer: return 'type-state';
        default:                         return 'type-other';
    }
}

function getTypeLabel(type: CommandType): string {
    switch (type) {
        case CommandType.Submit:           return 'SUB';
        case CommandType.RenderPass:       return 'RP';
        case CommandType.ComputePass:      return 'CP';
        case CommandType.Draw:             return 'DRW';
        case CommandType.Dispatch:         return 'DSP';
        case CommandType.SetPipeline:      return 'PIP';
        case CommandType.SetBindGroup:     return 'BND';
        case CommandType.SetVertexBuffer:  return 'VTX';
        case CommandType.SetIndexBuffer:   return 'IDX';
        case CommandType.WriteBuffer:
        case CommandType.WriteTexture:     return 'WRT';
        case CommandType.CopyBufferToBuffer:
        case CommandType.CopyBufferToTexture:
        case CommandType.CopyTextureToBuffer:
        case CommandType.CopyTextureToTexture: return 'CPY';
        default:                           return 'CMD';
    }
}
