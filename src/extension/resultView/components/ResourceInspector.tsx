import React, { useState, useCallback } from 'react';
import type { ICapture, IResourceMap } from '@shared/types';
import { resolveMapToRecord } from '../resourceMapHelpers';
import { JsonTree } from './JsonTree';

/** All resource categories present in IResourceMap. */
type ResourceCategory = keyof IResourceMap;

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

export function ResourceInspector({ capture }: { capture: ICapture }) {
    const [selectedCategory, setSelectedCategory] = useState<ResourceCategory>('buffers');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { resources } = capture;

    // Resources[category] is a union of Map<string, T> for different T.
    // We only need string keys and opaque values for display, so erase T.
    const currentResources = resolveMapToRecord(
        resources[selectedCategory] as Map<string, unknown>,
    );
    const resourceIds = Object.keys(currentResources);
    const selectedResource = selectedId != null ? currentResources[selectedId] ?? null : null;

    const handleCategoryChange = useCallback((key: ResourceCategory) => {
        setSelectedCategory(key);
        setSelectedId(null);
    }, []);

    return (
        <div className="resource-inspector">
            <div className="resource-categories">
                {CATEGORIES.map(cat => {
                    const count = Object.keys(resolveMapToRecord(
                        resources[cat.key] as Map<string, unknown>,
                    )).length;
                    return (
                        <button
                            key={cat.key}
                            className={`category-btn${selectedCategory === cat.key ? ' active' : ''}`}
                            onClick={() => handleCategoryChange(cat.key)}
                        >
                            {cat.label} ({count})
                        </button>
                    );
                })}
            </div>
            <div className="resource-content">
                <div className="resource-list">
                    {resourceIds.map(id => {
                        const res = currentResources[id] as { label?: string } | undefined;
                        return (
                            <div
                                key={id}
                                className={`resource-item${selectedId === id ? ' selected' : ''}`}
                                onClick={() => setSelectedId(id)}
                            >
                                <span className="resource-id">{id}</span>
                                {res?.label && <span className="resource-label">{res.label}</span>}
                            </div>
                        );
                    })}
                    {resourceIds.length === 0 && (
                        <div className="empty">No {selectedCategory} in this capture</div>
                    )}
                </div>
                <div className="resource-detail">
                    {selectedResource ? (
                        <JsonTree data={selectedResource} />
                    ) : (
                        <div className="empty">Select a resource to view details</div>
                    )}
                </div>
            </div>
        </div>
    );
}
