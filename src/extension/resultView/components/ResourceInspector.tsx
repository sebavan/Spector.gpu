import React, { useState, useCallback, useEffect } from 'react';
import type { ICapture, IResourceMap, ITextureInfo } from '@shared/types';
import { resolveMapToRecord } from '../resourceMapHelpers';
import { JsonTree } from './JsonTree';
import type { NavigationTarget } from './NavigationContext';

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

export function ResourceInspector({ capture, navTarget }: { capture: ICapture; navTarget?: NavigationTarget | null }) {
    const [selectedCategory, setSelectedCategory] = useState<ResourceCategory>('buffers');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // When an external navigation target arrives, switch category + select item.
    useEffect(() => {
        if (!navTarget) return;
        setSelectedCategory(navTarget.category as ResourceCategory);
        setSelectedId(navTarget.id);
    }, [navTarget]);

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
                    {selectedCategory === 'textures' && selectedResource ? (
                        <>
                            <TextureThumbnail texture={selectedResource as ITextureInfo} />
                            <JsonTree data={selectedResource} />
                        </>
                    ) : selectedResource ? (
                        <JsonTree data={selectedResource} />
                    ) : (
                        <div className="empty">Select a resource to view details</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function TextureThumbnail({ texture }: { texture: ITextureInfo }) {
    const width = texture.size?.width ?? 0;
    const height = texture.size?.height ?? 0;
    const format = texture.format ?? 'unknown';

    // Pick a background color based on texture format.
    const bgColor = format.includes('depth')
        ? '#4a3060'
        : format.includes('stencil')
            ? '#305060'
            : format.includes('float')
                ? '#2a4a2a'
                : '#2a3a5a';

    const MAX_DISPLAY_WIDTH = 200;
    const scale = width > 0 ? Math.min(1, MAX_DISPLAY_WIDTH / width) : 1;
    const displayWidth = Math.max(40, Math.round(width * scale));
    const displayHeight = Math.max(30, Math.round(height * scale));

    return (
        <div className="texture-thumbnail-container">
            {texture.previewDataUrl ? (
                <img
                    src={texture.previewDataUrl}
                    alt="texture preview"
                    className="texture-preview-img"
                />
            ) : (
                <div
                    className="texture-thumbnail"
                    style={{
                        width: displayWidth,
                        height: displayHeight,
                        backgroundColor: bgColor,
                    }}
                >
                    <span className="texture-dimensions">
                        {width} × {height}
                    </span>
                </div>
            )}
            <div className="texture-format">{format}</div>
        </div>
    );
}
