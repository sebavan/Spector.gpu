import React, { useState, useCallback, useEffect } from 'react';
import type { ICapture, ICommandNode, IResourceMap, IShaderModuleInfo, ITextureInfo } from '@shared/types';
import { resolveMapToRecord } from '../resourceMapHelpers';
import { highlightWGSL } from './wgslHighlighter';
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
                    {selectedCategory === 'shaderModules' && selectedResource ? (
                        <ShaderModuleDetail module={selectedResource as IShaderModuleInfo} />
                    ) : selectedCategory === 'textures' && selectedResource ? (
                        <TextureThumbnail texture={selectedResource as ITextureInfo} capture={capture} />
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

// ── Shader module detail with syntax-highlighted WGSL ─────────────────

function ShaderModuleDetail({ module }: { module: IShaderModuleInfo }) {
    const code = module.code || '';
    const highlighted = highlightWGSL(code);
    const lines = code.split('\n');

    return (
        <div className="shader-module-detail">
            <div className="shader-module-header">
                <h4>{module.label || module.id}</h4>
                <span className="shader-module-meta">{lines.length} lines</span>
                <button
                    className="copy-btn"
                    onClick={() => { navigator.clipboard?.writeText(code).catch(() => {}); }}
                >
                    Copy
                </button>
            </div>
            <div className="shader-code-container">
                <div className="line-numbers">
                    {lines.map((_, i) => (
                        <div key={i} className="line-number">{i + 1}</div>
                    ))}
                </div>
                <pre
                    className="shader-code highlighted"
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                />
            </div>
            {module.compilationInfo && module.compilationInfo.length > 0 && (
                <div className="compilation-info">
                    <h4>Compilation Messages</h4>
                    {module.compilationInfo.map((msg, i) => (
                        <div key={i} className={`comp-msg comp-msg-${msg.type}`}>
                            <span className="comp-type">{msg.type}</span>
                            <span className="comp-line">Line {msg.lineNum}:{msg.linePos}</span>
                            <span className="comp-text">{msg.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Walk command tree to find the first visual output (canvas screenshot) ──

function findVisualOutput(nodes: readonly ICommandNode[]): string | null {
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.visualOutput) return n.visualOutput;
        if (n.children.length > 0) {
            const found = findVisualOutput(n.children);
            if (found) return found;
        }
    }
    return null;
}

// ── Texture thumbnail with rich metadata ──────────────────────────────

function TextureThumbnail({ texture, capture }: { texture: ITextureInfo; capture: ICapture }) {
    const width = texture.size?.width ?? 0;
    const height = texture.size?.height ?? 0;
    const format = texture.format ?? 'unknown';
    const dimension = texture.dimension ?? '2d';
    const mipLevels = texture.mipLevelCount ?? 1;
    const sampleCount = texture.sampleCount ?? 1;
    const usage = texture.usage ?? 0;

    // Decode GPUTextureUsageFlags bitmask
    const usageFlags: string[] = [];
    if (usage & 0x01) usageFlags.push('COPY_SRC');
    if (usage & 0x02) usageFlags.push('COPY_DST');
    if (usage & 0x04) usageFlags.push('TEXTURE_BINDING');
    if (usage & 0x08) usageFlags.push('STORAGE_BINDING');
    if (usage & 0x10) usageFlags.push('RENDER_ATTACHMENT');

    // Canvas/swapchain textures: RENDER_ATTACHMENT + common swapchain format
    const isLikelyCanvas = !!(usage & 0x10) &&
        (format.includes('bgra8') || format.includes('rgba8'));

    // Use the capture's visual output as a proxy preview for canvas textures
    let previewUrl: string | null = null;
    if (texture.previewDataUrl) {
        previewUrl = texture.previewDataUrl;
    } else if (isLikelyCanvas) {
        previewUrl = findVisualOutput(capture.commands);
    }

    // Pick a background color based on texture format
    const bgColor = format.includes('depth')
        ? '#4a3060'
        : format.includes('stencil')
            ? '#305060'
            : format.includes('float')
                ? '#2a4a2a'
                : '#2a3a5a';

    const MAX_DISPLAY = 200;
    const scale = width > 0 ? Math.min(1, MAX_DISPLAY / width) : 1;
    const displayW = Math.max(60, Math.round(width * scale));
    const displayH = Math.max(45, Math.round(height * scale));

    const depthOrLayers = texture.size?.depthOrArrayLayers ?? 1;

    return (
        <div className="texture-thumbnail-container">
            {previewUrl ? (
                <img src={previewUrl} alt="texture preview" className="texture-preview-img" />
            ) : (
                <div
                    className="texture-thumbnail"
                    style={{ width: displayW, height: displayH, backgroundColor: bgColor }}
                >
                    <span className="texture-dimensions">{width} × {height}</span>
                </div>
            )}
            <div className="texture-info-grid">
                <span className="tex-label">Format:</span>
                <span className="tex-value">{format}</span>
                <span className="tex-label">Dimension:</span>
                <span className="tex-value">{dimension}</span>
                <span className="tex-label">Size:</span>
                <span className="tex-value">
                    {width} × {height}{depthOrLayers > 1 ? ` × ${depthOrLayers}` : ''}
                </span>
                {mipLevels > 1 && (
                    <>
                        <span className="tex-label">Mip Levels:</span>
                        <span className="tex-value">{mipLevels}</span>
                    </>
                )}
                {sampleCount > 1 && (
                    <>
                        <span className="tex-label">Samples:</span>
                        <span className="tex-value">{sampleCount}×</span>
                    </>
                )}
                <span className="tex-label">Usage:</span>
                <span className="tex-value tex-usage">{usageFlags.join(' | ') || 'none'}</span>
            </div>
        </div>
    );
}
