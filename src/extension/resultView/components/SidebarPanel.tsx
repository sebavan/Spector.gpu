import React, { useState, useCallback } from 'react';
import type { ICapture, ICommandNode, IResourceMap } from '@shared/types';
import type { ResourceCategory } from './NavigationContext';
import { CommandTree } from './CommandTree';
import { resolveMapToRecord } from '../resourceMapHelpers';
import { detectShaderStages } from './ResourceDetail';

type SidebarMode = 'commands' | 'resources';

interface SidebarPanelProps {
    capture: ICapture;
    mode: SidebarMode;
    onModeChange: (mode: SidebarMode) => void;
    selectedCommandId: string | null;
    onSelectCommand: (node: ICommandNode) => void;
    selectedResourceCategory: ResourceCategory | null;
    selectedResourceId: string | null;
    onSelectResource: (category: ResourceCategory, id: string) => void;
}

const CATEGORIES: readonly { key: ResourceCategory; label: string }[] = [
    { key: 'buffers', label: 'Buffers' },
    { key: 'textures', label: 'Textures' },
    { key: 'textureViews', label: 'Texture Views' },
    { key: 'samplers', label: 'Samplers' },
    { key: 'shaderModules', label: 'Shader Modules' },
    { key: 'renderPipelines', label: 'Render Pipelines' },
    { key: 'computePipelines', label: 'Compute Pipelines' },
    { key: 'bindGroups', label: 'Bind Groups' },
    { key: 'bindGroupLayouts', label: 'Bind Group Layouts' },
];

export function SidebarPanel({
    capture,
    mode,
    onModeChange,
    selectedCommandId,
    onSelectCommand,
    selectedResourceCategory,
    selectedResourceId,
    onSelectResource,
}: SidebarPanelProps) {
    return (
        <div className="sidebar-panel">
            <div className="mode-toggle">
                <button
                    className={mode === 'commands' ? 'active' : ''}
                    onClick={() => onModeChange('commands')}
                >
                    Commands
                </button>
                <button
                    className={mode === 'resources' ? 'active' : ''}
                    onClick={() => onModeChange('resources')}
                >
                    Resources
                </button>
            </div>
            {mode === 'commands' ? (
                <CommandTree
                    commands={capture.commands}
                    selectedId={selectedCommandId}
                    onSelect={onSelectCommand}
                />
            ) : (
                <ResourceBrowser
                    resources={capture.resources}
                    selectedCategory={selectedResourceCategory}
                    selectedId={selectedResourceId}
                    onSelectResource={onSelectResource}
                />
            )}
        </div>
    );
}

// ── Collapsible resource browser ──────────────────────────────────────

interface ResourceBrowserProps {
    resources: IResourceMap;
    selectedCategory: ResourceCategory | null;
    selectedId: string | null;
    onSelectResource: (category: ResourceCategory, id: string) => void;
}

function ResourceBrowser({ resources, selectedCategory, selectedId, onSelectResource }: ResourceBrowserProps) {
    // Track which groups are expanded. Default: all expanded.
    const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
        const init: Record<string, boolean> = {};
        for (let i = 0; i < CATEGORIES.length; i++) {
            init[CATEGORIES[i].key] = true;
        }
        return init;
    });

    const toggleGroup = useCallback((key: string) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    return (
        <div className="resource-browser">
            {CATEGORIES.map(cat => {
                const record = resolveMapToRecord(
                    resources[cat.key] as Map<string, unknown>,
                );
                const ids = Object.keys(record);
                const isExpanded = expanded[cat.key] ?? true;

                return (
                    <div key={cat.key} className="res-group">
                        <div
                            className="res-group-header"
                            onClick={() => toggleGroup(cat.key)}
                        >
                            <span className="g-toggle">{isExpanded ? '▼' : '▶'}</span>
                            <span>{cat.label}</span>
                            <span className="g-count">{ids.length}</span>
                        </div>
                        {isExpanded && ids.map(id => {
                            const res = record[id] as { label?: string; code?: string } | undefined;
                            const isSelected = selectedCategory === cat.key && selectedId === id;
                            const shaderStages = cat.key === 'shaderModules' && res?.code
                                ? detectShaderStages(res.code) : [];
                            return (
                                <div
                                    key={id}
                                    className={`resource-item${isSelected ? ' selected' : ''}`}
                                    onClick={() => onSelectResource(cat.key, id)}
                                >
                                    <span className="resource-id">{id}</span>
                                    {shaderStages.map(s => (
                                        <span key={s} className={`shader-stage-badge stage-${s} small`}>{s[0].toUpperCase()}</span>
                                    ))}
                                    {res?.label && <span className="resource-label">{res.label}</span>}
                                </div>
                            );
                        })}
                        {isExpanded && ids.length === 0 && (
                            <div className="empty res-empty">None</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
