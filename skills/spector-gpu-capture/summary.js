// ── Summary builder ──────────────────────────────────────────────────
// Extracted from capture-cli.js for testability and reuse.

function decodeBufferUsage(usage) {
    const flags = [];
    if (usage & 0x0001) flags.push('MAP_READ');
    if (usage & 0x0002) flags.push('MAP_WRITE');
    if (usage & 0x0004) flags.push('COPY_SRC');
    if (usage & 0x0008) flags.push('COPY_DST');
    if (usage & 0x0010) flags.push('INDEX');
    if (usage & 0x0020) flags.push('VERTEX');
    if (usage & 0x0040) flags.push('UNIFORM');
    if (usage & 0x0080) flags.push('STORAGE');
    if (usage & 0x0100) flags.push('INDIRECT');
    return flags.join('|');
}

function decodeTextureUsage(usage) {
    const flags = [];
    if (usage & 0x01) flags.push('COPY_SRC');
    if (usage & 0x02) flags.push('COPY_DST');
    if (usage & 0x04) flags.push('TEXTURE_BINDING');
    if (usage & 0x08) flags.push('STORAGE_BINDING');
    if (usage & 0x10) flags.push('RENDER_ATTACHMENT');
    return flags.join('|');
}

function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function outlineCommands(nodes, depth = 0) {
    const lines = [];
    for (const node of nodes) {
        const indent = '  '.repeat(depth);
        const childInfo = node.children?.length ? ` (${node.children.length} children)` : '';
        lines.push(`${indent}[${node.type}] ${node.name}${childInfo}`);
        if (node.children?.length && depth < 3) {
            lines.push(...outlineCommands(node.children, depth + 1));
        }
    }
    return lines;
}

/**
 * Build a human/AI-readable summary from a full capture object.
 * Returns a JSON string.
 */
function buildSummary(capture) {
    const { stats, adapterInfo, resources, commands } = capture;

    const textures = resources.textures ? Object.values(resources.textures) : [];
    const buffers = resources.buffers ? Object.values(resources.buffers) : [];
    const shaders = resources.shaderModules ? Object.values(resources.shaderModules) : [];
    const renderPipelines = resources.renderPipelines ? Object.values(resources.renderPipelines) : [];
    const computePipelines = resources.computePipelines ? Object.values(resources.computePipelines) : [];

    const summary = {
        adapter: {
            vendor: adapterInfo.vendor,
            architecture: adapterInfo.architecture,
            description: adapterInfo.description,
        },
        stats,
        duration: `${capture.duration?.toFixed(1)}ms`,
        commandTree: outlineCommands(commands),
        textures: textures.map(t => ({
            id: t.id,
            label: t.label,
            format: t.format,
            size: `${t.size?.width}×${t.size?.height}${(t.size?.depthOrArrayLayers || 1) > 1 ? `×${t.size.depthOrArrayLayers}` : ''}`,
            usage: decodeTextureUsage(t.usage || 0),
            hasPreview: !!t.previewDataUrl,
            isCube: (t.size?.depthOrArrayLayers || 1) === 6,
        })),
        buffers: buffers.map(b => ({
            id: b.id,
            label: b.label,
            size: formatBytes(b.size),
            usage: decodeBufferUsage(b.usage || 0),
            hasData: !!b.dataBase64,
        })),
        shaderModules: shaders.map(s => ({
            id: s.id,
            label: s.label,
            code: s.code,
            lines: s.code?.split('\n').length || 0,
            ...(s.compilationInfo?.length ? { compilationInfo: s.compilationInfo } : {}),
        })),
        pipelines: {
            render: renderPipelines.map(p => ({ id: p.id, label: p.label })),
            compute: computePipelines.map(p => ({ id: p.id, label: p.label })),
        },
    };

    return JSON.stringify(summary, null, 2);
}

module.exports = { buildSummary };
