import React from 'react';
import type { ICapture, ICommandNode, IShaderModuleInfo, ITextureInfo } from '@shared/types';
import { highlightWGSL } from './wgslHighlighter';
import { JsonTree } from './JsonTree';

// ── Detect shader stages from WGSL source ─────────────────────────────

type ShaderStage = 'vertex' | 'fragment' | 'compute';

export function detectShaderStages(code: string): ShaderStage[] {
    const stages: ShaderStage[] = [];
    if (/@vertex\b/.test(code)) stages.push('vertex');
    if (/@fragment\b/.test(code)) stages.push('fragment');
    if (/@compute\b/.test(code)) stages.push('compute');
    return stages;
}

// ── Walk command tree to find the first visual output (canvas screenshot) ──

export function findVisualOutput(nodes: readonly ICommandNode[]): string | null {
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

// ── Shader module detail with syntax-highlighted WGSL ─────────────────

export function ShaderModuleDetail({ module }: { module: IShaderModuleInfo }) {
    const code = module.code || '';
    const highlighted = highlightWGSL(code);
    const lines = code.split('\n');
    const stages = detectShaderStages(code);

    return (
        <div className="shader-module-detail">
            <div className="shader-module-header">
                <h4>{module.label || module.id}</h4>
                {stages.map(s => (
                    <span key={s} className={`shader-stage-badge stage-${s}`}>{s}</span>
                ))}
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

// ── Texture thumbnail with rich metadata ──────────────────────────────

export function TextureThumbnail({ texture, capture }: { texture: ITextureInfo; capture: ICapture }) {
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

    // Only show the canvas screenshot for the actual canvas texture
    let previewUrl: string | null = null;
    if (texture.previewDataUrl) {
        previewUrl = texture.previewDataUrl;
    } else if (texture.isCanvasTexture) {
        previewUrl = findVisualOutput(capture.commands);
    }

    const hasFaces = texture.facePreviewUrls && texture.facePreviewUrls.length > 0;

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
            {hasFaces ? (
                <CubeFaceGrid faces={texture.facePreviewUrls!} />
            ) : previewUrl ? (
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

// ── Cube face grid with labels ────────────────────────────────────────

const FACE_LABELS = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'] as const;

function CubeFaceGrid({ faces }: { faces: readonly string[] }) {
    return (
        <div className="cube-face-grid">
            {faces.map((url, i) => (
                <div key={i} className="cube-face">
                    {url ? (
                        <img src={url} alt={FACE_LABELS[i] ?? `Face ${i}`} className="cube-face-img" />
                    ) : (
                        <div className="cube-face-placeholder" />
                    )}
                    <span className="cube-face-label">{FACE_LABELS[i] ?? `L${i}`}</span>
                </div>
            ))}
        </div>
    );
}

// ── Unified resource detail panel ─────────────────────────────────────

interface ResourceDetailProps {
    category: string;
    resource: unknown;
    capture: ICapture;
}

export function ResourceDetail({ category, resource, capture }: ResourceDetailProps) {
    if (!resource) {
        return <div className="empty">Select a resource to view details</div>;
    }

    if (category === 'shaderModules') {
        return <ShaderModuleDetail module={resource as IShaderModuleInfo} />;
    }

    if (category === 'textures' || category === 'textureViews') {
        return (
            <>
                <TextureThumbnail texture={resource as ITextureInfo} capture={capture} />
                <JsonTree data={resource} />
            </>
        );
    }

    return <JsonTree data={resource} />;
}
