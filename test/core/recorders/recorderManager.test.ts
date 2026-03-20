import { describe, it, expect, beforeEach } from 'vitest';
import { RecorderManager } from '@core/recorders/recorderManager';
import { globalIdGenerator } from '@shared/utils/idGenerator';

/**
 * Fresh RecorderManager + deterministic IDs for every test.
 */
let mgr: RecorderManager;

beforeEach(() => {
    globalIdGenerator.reset();
    mgr = new RecorderManager();
});

// ─── Object ID tracking ──────────────────────────────────────────────

describe('Object ID tracking', () => {
    it('trackObject returns same ID for same object', () => {
        const obj = {};
        const id1 = mgr.trackObject(obj, 'x');
        const id2 = mgr.trackObject(obj, 'x');
        expect(id1).toBe(id2);
    });

    it('different objects get different IDs', () => {
        const a = {};
        const b = {};
        const idA = mgr.trackObject(a, 'x');
        const idB = mgr.trackObject(b, 'x');
        expect(idA).not.toBe(idB);
    });

    it('getId returns undefined for untracked objects', () => {
        expect(mgr.getId({})).toBeUndefined();
    });

    it('getId returns the tracking ID after trackObject', () => {
        const obj = {};
        const id = mgr.trackObject(obj, 'foo');
        expect(mgr.getId(obj)).toBe(id);
    });
});

// ─── Buffer ──────────────────────────────────────────────────────────

describe('Buffer recording', () => {
    it('recordBufferCreation assigns ID and stores info', () => {
        const buf = {};
        const id = mgr.recordBufferCreation(buf, {
            label: 'vertex-buf',
            size: 1024,
            usage: 0x0028, // VERTEX | COPY_DST
            mappedAtCreation: false,
        });

        expect(id).toBe('buf_1');
        expect(mgr.getId(buf)).toBe(id);

        const snap = mgr.snapshot();
        const info = snap.buffers.get(id)!;
        expect(info).toBeDefined();
        expect(info.label).toBe('vertex-buf');
        expect(info.size).toBe(1024);
        expect(info.usage).toBe(0x0028);
        expect(info.mappedAtCreation).toBe(false);
        expect(info.state).toBe('unmapped');
    });

    it('mappedAtCreation defaults to false and state to unmapped', () => {
        const id = mgr.recordBufferCreation({}, { size: 64, usage: 1 });
        const info = mgr.snapshot().buffers.get(id)!;
        expect(info.mappedAtCreation).toBe(false);
        expect(info.state).toBe('unmapped');
    });

    it('mappedAtCreation true sets state to mapped', () => {
        const id = mgr.recordBufferCreation({}, {
            size: 64,
            usage: 1,
            mappedAtCreation: true,
        });
        const info = mgr.snapshot().buffers.get(id)!;
        expect(info.mappedAtCreation).toBe(true);
        expect(info.state).toBe('mapped');
    });

    it('updateBufferState changes state', () => {
        const buf = {};
        const id = mgr.recordBufferCreation(buf, { size: 64, usage: 1 });
        mgr.updateBufferState(buf, 'mapping-pending');

        const info = mgr.snapshot().buffers.get(id)!;
        expect(info.state).toBe('mapping-pending');
    });

    it('updateBufferState is a no-op for untracked objects', () => {
        // Should not throw
        mgr.updateBufferState({}, 'destroyed');
    });

    it('recordBufferDestroy marks as destroyed', () => {
        const buf = {};
        const id = mgr.recordBufferCreation(buf, { size: 256, usage: 1 });
        mgr.recordBufferDestroy(buf);

        // Destroyed buffers are filtered from snapshot
        expect(mgr.snapshot().buffers.has(id)).toBe(false);
        expect(mgr.isBufferDestroyed(id)).toBe(true);
    });
});

// ─── Texture ─────────────────────────────────────────────────────────

describe('Texture recording', () => {
    it('recordTextureCreation handles size as object (dict)', () => {
        const tex = {};
        const id = mgr.recordTextureCreation(tex, {
            label: 'diffuse',
            size: { width: 512, height: 256, depthOrArrayLayers: 1 },
            format: 'rgba8unorm',
            usage: 0x06, // TEXTURE_BINDING | COPY_DST
        });

        expect(id).toBe('tex_1');
        const info = mgr.snapshot().textures.get(id)!;
        expect(info.size).toEqual({ width: 512, height: 256, depthOrArrayLayers: 1 });
        expect(info.format).toBe('rgba8unorm');
        expect(info.label).toBe('diffuse');
    });

    it('recordTextureCreation handles size as array', () => {
        const id = mgr.recordTextureCreation({}, {
            size: [640, 480, 1],
            format: 'bgra8unorm',
            usage: 0x10,
        });
        const info = mgr.snapshot().textures.get(id)!;
        expect(info.size).toEqual({ width: 640, height: 480, depthOrArrayLayers: 1 });
    });

    it('recordTextureCreation handles size as number', () => {
        const id = mgr.recordTextureCreation({}, {
            size: 128,
            format: 'r8unorm',
            usage: 0x04,
            dimension: '1d',
        });
        const info = mgr.snapshot().textures.get(id)!;
        expect(info.size).toEqual({ width: 128, height: 1, depthOrArrayLayers: 1 });
        expect(info.dimension).toBe('1d');
    });

    it('defaults mipLevelCount, sampleCount, dimension', () => {
        const id = mgr.recordTextureCreation({}, {
            size: { width: 64, height: 64 },
            format: 'rgba8unorm',
            usage: 0x04,
        });
        const info = mgr.snapshot().textures.get(id)!;
        expect(info.mipLevelCount).toBe(1);
        expect(info.sampleCount).toBe(1);
        expect(info.dimension).toBe('2d');
    });

    it('labels are preserved', () => {
        const id = mgr.recordTextureCreation({}, {
            label: 'my-texture',
            size: { width: 1 },
            format: 'r8unorm',
            usage: 1,
        });
        expect(mgr.snapshot().textures.get(id)!.label).toBe('my-texture');
    });
});

// ─── Texture View ────────────────────────────────────────────────────

describe('Texture View recording', () => {
    it('recordTextureViewCreation links to parent texture', () => {
        const tex = {};
        const texId = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256 },
            format: 'rgba8unorm',
            usage: 0x04,
            mipLevelCount: 4,
        });

        const view = {};
        const viewId = mgr.recordTextureViewCreation(view, tex, {
            label: 'my-view',
            format: 'rgba8unorm',
        });

        expect(viewId).toBe('tv_1');
        const info = mgr.snapshot().textureViews.get(viewId)!;
        expect(info.textureId).toBe(texId);
        expect(info.label).toBe('my-view');
        expect(info.format).toBe('rgba8unorm');
    });

    it('default values are correct (inherits from texture)', () => {
        const tex = {};
        mgr.recordTextureCreation(tex, {
            size: { width: 64, height: 64 },
            format: 'bgra8unorm',
            usage: 0x04,
            mipLevelCount: 3,
            dimension: '2d',
        });

        const view = {};
        // No descriptor — all defaults
        const viewId = mgr.recordTextureViewCreation(view, tex, undefined);

        const info = mgr.snapshot().textureViews.get(viewId)!;
        expect(info.format).toBe('bgra8unorm');     // inherited from texture
        expect(info.dimension).toBe('2d');           // inherited from texture
        expect(info.mipLevelCount).toBe(3);          // inherited from texture
        expect(info.baseMipLevel).toBe(0);
        expect(info.baseArrayLayer).toBe(0);
        expect(info.arrayLayerCount).toBe(1);
        expect(info.aspect).toBe('all');
    });

    it('textureId is "unknown" if texture is not tracked', () => {
        const untrackedTex = {};
        const view = {};
        const viewId = mgr.recordTextureViewCreation(view, untrackedTex, {});
        const info = mgr.snapshot().textureViews.get(viewId)!;
        expect(info.textureId).toBe('unknown');
    });
});

// ─── Sampler ─────────────────────────────────────────────────────────

describe('Sampler recording', () => {
    it('recordSamplerCreation fills WebGPU spec defaults', () => {
        const sampler = {};
        const id = mgr.recordSamplerCreation(sampler, {});

        const info = mgr.snapshot().samplers.get(id)!;
        expect(info.addressModeU).toBe('clamp-to-edge');
        expect(info.addressModeV).toBe('clamp-to-edge');
        expect(info.addressModeW).toBe('clamp-to-edge');
        expect(info.magFilter).toBe('nearest');
        expect(info.minFilter).toBe('nearest');
        expect(info.mipmapFilter).toBe('nearest');
        expect(info.lodMinClamp).toBe(0);
        expect(info.lodMaxClamp).toBe(32);
        expect(info.compare).toBeUndefined();
        expect(info.maxAnisotropy).toBe(1);
    });

    it('recordSamplerCreation preserves custom values', () => {
        const id = mgr.recordSamplerCreation({}, {
            label: 'linear-sampler',
            addressModeU: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            compare: 'less',
            maxAnisotropy: 16,
        });
        const info = mgr.snapshot().samplers.get(id)!;
        expect(info.label).toBe('linear-sampler');
        expect(info.addressModeU).toBe('repeat');
        expect(info.addressModeV).toBe('clamp-to-edge'); // default
        expect(info.magFilter).toBe('linear');
        expect(info.compare).toBe('less');
        expect(info.maxAnisotropy).toBe(16);
    });

    it('handles undefined descriptor (default sampler)', () => {
        const id = mgr.recordSamplerCreation({}, undefined);
        const info = mgr.snapshot().samplers.get(id)!;
        expect(info.addressModeU).toBe('clamp-to-edge');
        expect(info.magFilter).toBe('nearest');
    });
});

// ─── Shader Module ───────────────────────────────────────────────────

describe('Shader Module recording', () => {
    it('recordShaderModuleCreation captures WGSL code', () => {
        const wgsl = `@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0); }`;
        const mod = {};
        const id = mgr.recordShaderModuleCreation(mod, {
            label: 'triangle-shader',
            code: wgsl,
        });

        expect(id).toBe('shd_1');
        const info = mgr.snapshot().shaderModules.get(id)!;
        expect(info.label).toBe('triangle-shader');
        expect(info.code).toBe(wgsl);
    });

    it('defaults code to empty string', () => {
        const id = mgr.recordShaderModuleCreation({}, {});
        expect(mgr.snapshot().shaderModules.get(id)!.code).toBe('');
    });
});

// ─── Render Pipeline ─────────────────────────────────────────────────

describe('Render Pipeline recording', () => {
    it('recordRenderPipelineCreation captures vertex/fragment module IDs', () => {
        const vsMod = {};
        const fsMod = {};
        const vsId = mgr.recordShaderModuleCreation(vsMod, { code: 'vs' });
        const fsId = mgr.recordShaderModuleCreation(fsMod, { code: 'fs' });

        const pipeline = {};
        const rpId = mgr.recordRenderPipelineCreation(pipeline, {
            label: 'main-pipeline',
            layout: 'auto',
            vertex: {
                module: vsMod,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: fsMod,
                entryPoint: 'fs_main',
                targets: [{ format: 'bgra8unorm' }],
            },
        });

        expect(rpId).toBe('rp_1');
        const info = mgr.snapshot().renderPipelines.get(rpId)!;
        expect(info.label).toBe('main-pipeline');
        expect(info.layout).toBe('auto');
        expect(info.vertex.moduleId).toBe(vsId);
        expect(info.vertex.entryPoint).toBe('vs_main');
        expect(info.fragment).toBeDefined();
        expect(info.fragment!.moduleId).toBe(fsId);
        expect(info.fragment!.entryPoint).toBe('fs_main');
    });

    it('fragment is undefined when not specified', () => {
        const mod = {};
        mgr.recordShaderModuleCreation(mod, { code: 'vs' });
        const rpId = mgr.recordRenderPipelineCreation({}, {
            layout: 'auto',
            vertex: { module: mod },
        });
        const info = mgr.snapshot().renderPipelines.get(rpId)!;
        expect(info.fragment).toBeUndefined();
    });

    it('layout resolves to pipeline layout ID', () => {
        const layoutObj = {};
        mgr.trackObject(layoutObj, 'pl');
        const mod = {};
        mgr.recordShaderModuleCreation(mod, { code: '' });

        const rpId = mgr.recordRenderPipelineCreation({}, {
            layout: layoutObj,
            vertex: { module: mod },
        });
        const info = mgr.snapshot().renderPipelines.get(rpId)!;
        expect(info.layout).toBe('pl_1');
    });
});

// ─── Compute Pipeline ────────────────────────────────────────────────

describe('Compute Pipeline recording', () => {
    it('recordComputePipelineCreation captures module ID', () => {
        const mod = {};
        const modId = mgr.recordShaderModuleCreation(mod, {
            code: '@compute @workgroup_size(64) fn main() {}',
        });

        const pipeline = {};
        const cpId = mgr.recordComputePipelineCreation(pipeline, {
            label: 'compute-pipe',
            layout: 'auto',
            compute: {
                module: mod,
                entryPoint: 'main',
            },
        });

        expect(cpId).toBe('cp_1');
        const info = mgr.snapshot().computePipelines.get(cpId)!;
        expect(info.label).toBe('compute-pipe');
        expect(info.layout).toBe('auto');
        expect(info.compute.moduleId).toBe(modId);
        expect(info.compute.entryPoint).toBe('main');
    });
});

// ─── Bind Group ──────────────────────────────────────────────────────

describe('Bind Group recording', () => {
    it('recordBindGroupCreation identifies buffer vs sampler vs texture view entries', () => {
        // Set up resources
        const buf = {};
        const bufId = mgr.recordBufferCreation(buf, { size: 256, usage: 0x40 });

        const sampler = {};
        const samplerId = mgr.recordSamplerCreation(sampler, {});

        const tex = {};
        mgr.recordTextureCreation(tex, {
            size: { width: 64, height: 64 },
            format: 'rgba8unorm',
            usage: 0x04,
        });
        const view = {};
        const viewId = mgr.recordTextureViewCreation(view, tex, {});

        // Create bind group layout (needed for the layoutId)
        const layout = {};
        const layoutId = mgr.recordBindGroupLayoutCreation(layout, { entries: [] });

        // Create bind group
        const bg = {};
        const bgId = mgr.recordBindGroupCreation(bg, {
            layout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: buf, offset: 0, size: 256 },
                },
                {
                    binding: 1,
                    resource: sampler,
                },
                {
                    binding: 2,
                    resource: view,
                },
            ],
        });

        expect(bgId).toBe('bg_1');
        const info = mgr.snapshot().bindGroups.get(bgId)!;
        expect(info.layoutId).toBe(layoutId);
        expect(info.entries).toHaveLength(3);

        // Buffer entry
        expect(info.entries[0].binding).toBe(0);
        expect(info.entries[0].resourceType).toBe('buffer');
        expect(info.entries[0].resourceId).toBe(bufId);
        expect(info.entries[0].offset).toBe(0);
        expect(info.entries[0].size).toBe(256);

        // Sampler entry
        expect(info.entries[1].binding).toBe(1);
        expect(info.entries[1].resourceType).toBe('sampler');
        expect(info.entries[1].resourceId).toBe(samplerId);

        // Texture view entry
        expect(info.entries[2].binding).toBe(2);
        expect(info.entries[2].resourceType).toBe('textureView');
        expect(info.entries[2].resourceId).toBe(viewId);
    });

    it('buffer entry defaults offset to 0', () => {
        const buf = {};
        mgr.recordBufferCreation(buf, { size: 128, usage: 0x40 });
        const layout = {};
        mgr.trackObject(layout, 'bgl');

        const bgId = mgr.recordBindGroupCreation({}, {
            layout,
            entries: [{ binding: 0, resource: { buffer: buf } }],
        });
        const entry = mgr.snapshot().bindGroups.get(bgId)!.entries[0];
        expect(entry.offset).toBe(0);
        expect(entry.size).toBeUndefined();
    });
});

// ─── Bind Group Layout ───────────────────────────────────────────────

describe('Bind Group Layout recording', () => {
    it('recordBindGroupLayoutCreation stores entries with correct types', () => {
        const layout = {};
        const id = mgr.recordBindGroupLayoutCreation(layout, {
            label: 'my-layout',
            entries: [
                { binding: 0, visibility: 1, buffer: { type: 'uniform' } },
                { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
                { binding: 2, visibility: 2, texture: { sampleType: 'float' } },
            ],
        });

        const info = mgr.snapshot().bindGroupLayouts.get(id)!;
        expect(info.label).toBe('my-layout');
        expect(info.entries).toHaveLength(3);
        expect(info.entries[0].type).toBe('buffer');
        expect(info.entries[0].visibility).toBe(1);
        expect(info.entries[0].descriptor).toEqual({ type: 'uniform' });
        expect(info.entries[1].type).toBe('sampler');
        expect(info.entries[2].type).toBe('texture');
    });

    it('defaults to buffer type when no specific entry type key is present', () => {
        const id = mgr.recordBindGroupLayoutCreation({}, {
            entries: [{ binding: 0 }],
        });
        const entry = mgr.snapshot().bindGroupLayouts.get(id)!.entries[0];
        expect(entry.type).toBe('buffer');
        expect(entry.descriptor).toEqual({});
        expect(entry.visibility).toBe(0);
    });
});

// ─── Snapshot ────────────────────────────────────────────────────────

describe('Snapshot', () => {
    it('snapshot returns a copy — modifying manager after snapshot does not affect it', () => {
        const buf = {};
        const bufId = mgr.recordBufferCreation(buf, { size: 64, usage: 1 });

        const snap1 = mgr.snapshot();
        expect(snap1.buffers.size).toBe(1);

        // Add a new buffer after the snapshot
        mgr.recordBufferCreation({}, { size: 128, usage: 1 });
        expect(snap1.buffers.size).toBe(1); // snapshot is unaffected

        // Update the first buffer's state after the snapshot
        mgr.updateBufferState(buf, 'destroyed');
        expect(snap1.buffers.get(bufId)!.state).toBe('unmapped'); // snapshot is unaffected
    });

    it('snapshot contains all 9 resource map keys', () => {
        const snap = mgr.snapshot();
        expect(snap.buffers).toBeInstanceOf(Map);
        expect(snap.textures).toBeInstanceOf(Map);
        expect(snap.textureViews).toBeInstanceOf(Map);
        expect(snap.samplers).toBeInstanceOf(Map);
        expect(snap.shaderModules).toBeInstanceOf(Map);
        expect(snap.renderPipelines).toBeInstanceOf(Map);
        expect(snap.computePipelines).toBeInstanceOf(Map);
        expect(snap.bindGroups).toBeInstanceOf(Map);
        expect(snap.bindGroupLayouts).toBeInstanceOf(Map);
    });
});

// ─── Resource Counts ─────────────────────────────────────────────────

describe('Resource counts', () => {
    it('getResourceCounts is accurate', () => {
        mgr.recordBufferCreation({}, { size: 64, usage: 1 });
        mgr.recordBufferCreation({}, { size: 128, usage: 1 });
        mgr.recordTextureCreation({}, { size: { width: 1 }, format: 'r8unorm', usage: 1 });
        mgr.recordShaderModuleCreation({}, { code: '' });

        const mod = {};
        mgr.recordShaderModuleCreation(mod, { code: '' });
        mgr.recordRenderPipelineCreation({}, { layout: 'auto', vertex: { module: mod } });
        mgr.recordComputePipelineCreation({}, { layout: 'auto', compute: { module: mod } });
        mgr.recordBindGroupCreation({}, { entries: [] });

        const counts = mgr.getResourceCounts();
        expect(counts.bufferCount).toBe(2);
        expect(counts.textureCount).toBe(1);
        expect(counts.shaderModuleCount).toBe(2);
        expect(counts.pipelineCount).toBe(2); // 1 render + 1 compute
        expect(counts.bindGroupCount).toBe(1);
    });
});

// ─── Reset ───────────────────────────────────────────────────────────

describe('Reset', () => {
    it('clears all maps and WeakMap', () => {
        const buf = {};
        mgr.recordBufferCreation(buf, { size: 64, usage: 1 });
        mgr.recordTextureCreation({}, { size: { width: 1 }, format: 'r8unorm', usage: 1 });
        mgr.recordSamplerCreation({}, {});
        mgr.recordShaderModuleCreation({}, { code: '' });

        mgr.reset();

        const counts = mgr.getResourceCounts();
        expect(counts.bufferCount).toBe(0);
        expect(counts.textureCount).toBe(0);
        expect(counts.shaderModuleCount).toBe(0);
        expect(counts.pipelineCount).toBe(0);
        expect(counts.bindGroupCount).toBe(0);

        // WeakMap is also cleared — previously tracked objects are unknown
        expect(mgr.getId(buf)).toBeUndefined();

        // Snapshot is empty
        const snap = mgr.snapshot();
        expect(snap.buffers.size).toBe(0);
        expect(snap.textures.size).toBe(0);
        expect(snap.samplers.size).toBe(0);
        expect(snap.shaderModules.size).toBe(0);
    });
});

// ─── Cubemap detection via texture views (PR #10) ────────────────────

describe('hasTextureCubeView', () => {
    it('returns true when texture has a cube view', () => {
        const tex = {};
        const view = {};
        const texId = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: 0x04,
            dimension: '2d',
        });
        mgr.recordTextureViewCreation(view, tex, { dimension: 'cube' });
        expect(mgr.hasTextureCubeView(texId)).toBe(true);
    });

    it('returns false when texture has only 2d views', () => {
        const tex = {};
        const view = {};
        const texId = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: 0x04,
            dimension: '2d',
        });
        mgr.recordTextureViewCreation(view, tex, { dimension: '2d' });
        expect(mgr.hasTextureCubeView(texId)).toBe(false);
    });

    it('returns true for cube-array dimension', () => {
        const tex = {};
        const view = {};
        const texId = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256, depthOrArrayLayers: 12 },
            format: 'rgba8unorm',
            usage: 0x04,
            dimension: '2d',
        });
        mgr.recordTextureViewCreation(view, tex, { dimension: 'cube-array' });
        expect(mgr.hasTextureCubeView(texId)).toBe(true);
    });

    it('returns false when no views exist', () => {
        const tex = {};
        const texId = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            usage: 0x04,
            dimension: '2d',
        });
        expect(mgr.hasTextureCubeView(texId)).toBe(false);
    });

    it('returns false for non-existent texture ID', () => {
        expect(mgr.hasTextureCubeView('tex_999')).toBe(false);
    });
});

// ─── Canvas texture deduplication (PR #13) ───────────────────────────

describe('Canvas texture deduplication', () => {
    it('only keeps the latest canvas texture', () => {
        const tex1 = {};
        const tex2 = {};
        const tex3 = {};

        mgr.recordCanvasTexture(tex1, 'bgra8unorm', 1920, 1080);
        mgr.recordCanvasTexture(tex2, 'bgra8unorm', 1920, 1080);
        const id3 = mgr.recordCanvasTexture(tex3, 'bgra8unorm', 1920, 1080);

        const snapshot = mgr.snapshot();
        // Only the latest canvas texture should be in the snapshot
        let canvasCount = 0;
        for (const [, tex] of snapshot.textures) {
            if (tex.isCanvasTexture) canvasCount++;
        }
        expect(canvasCount).toBe(1);
        expect(snapshot.textures.get(id3)?.isCanvasTexture).toBe(true);
    });

    it('canvas texture is idempotent for same object', () => {
        const tex = {};
        const id1 = mgr.recordCanvasTexture(tex, 'bgra8unorm', 1920, 1080);
        const id2 = mgr.recordCanvasTexture(tex, 'bgra8unorm', 1920, 1080);
        expect(id1).toBe(id2);
    });

    it('canvas texture is recorded with correct properties', () => {
        const tex = {};
        const id = mgr.recordCanvasTexture(tex, 'bgra8unorm', 1920, 1080);

        const snapshot = mgr.snapshot();
        const info = snapshot.textures.get(id)!;
        expect(info).toBeDefined();
        expect(info.format).toBe('bgra8unorm');
        expect(info.size.width).toBe(1920);
        expect(info.size.height).toBe(1080);
        expect(info.isCanvasTexture).toBe(true);
        expect(info.label).toBe('Canvas Texture');
    });
});

// ─── Snapshot filters destroyed resources (PR #14) ───────────────────

describe('Snapshot filtering', () => {
    it('filters out destroyed textures', () => {
        const tex = {};
        const id = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256 },
            format: 'rgba8unorm',
            usage: 0x04,
            dimension: '2d',
        });
        mgr.recordTextureDestroy(tex);

        const snapshot = mgr.snapshot();
        expect(snapshot.textures.has(id)).toBe(false);
    });

    it('isTextureDestroyed returns true after destroy', () => {
        const tex = {};
        const id = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256 },
            format: 'rgba8unorm',
            usage: 0x04,
        });
        expect(mgr.isTextureDestroyed(id)).toBe(false);
        mgr.recordTextureDestroy(tex);
        expect(mgr.isTextureDestroyed(id)).toBe(true);
    });

    it('filters out destroyed buffers', () => {
        const buf = {};
        const id = mgr.recordBufferCreation(buf, { size: 256, usage: 1 });
        mgr.recordBufferDestroy(buf);

        const snapshot = mgr.snapshot();
        expect(snapshot.buffers.has(id)).toBe(false);
    });

    it('keeps non-destroyed resources in snapshot', () => {
        const tex = {};
        const id = mgr.recordTextureCreation(tex, {
            size: { width: 256, height: 256 },
            format: 'rgba8unorm',
            usage: 0x04,
            dimension: '2d',
        });

        const snapshot = mgr.snapshot();
        expect(snapshot.textures.has(id)).toBe(true);
    });

    it('keeps non-destroyed buffers alongside destroyed ones', () => {
        const buf1 = {};
        const buf2 = {};
        const id1 = mgr.recordBufferCreation(buf1, { size: 256, usage: 1 });
        const id2 = mgr.recordBufferCreation(buf2, { size: 128, usage: 1 });
        mgr.recordBufferDestroy(buf1);

        const snapshot = mgr.snapshot();
        expect(snapshot.buffers.has(id1)).toBe(false);
        expect(snapshot.buffers.has(id2)).toBe(true);
    });
});
