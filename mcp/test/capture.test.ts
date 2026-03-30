import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { CaptureManager, RESOURCE_CATEGORIES } from '../src/capture.js';
import sampleCapture from './fixtures/sample-capture.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Playwright Page whose evaluate() resolves with the given data. */
function mockPage(data: object): Page {
  return {
    evaluate: vi.fn().mockResolvedValue(data),
  } as unknown as Page;
}

/** Shorthand: create a CaptureManager that already holds `sampleCapture`. */
async function loadedManager(): Promise<CaptureManager> {
  const mgr = new CaptureManager();
  await mgr.capture(mockPage(sampleCapture));
  return mgr;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('CaptureManager', () => {
  let mgr: CaptureManager;

  beforeEach(() => {
    mgr = new CaptureManager();
  });

  // -------------------------------------------------------------------------
  // RESOURCE_CATEGORIES export
  // -------------------------------------------------------------------------
  describe('RESOURCE_CATEGORIES', () => {
    it('exports exactly 9 category names', () => {
      // If someone adds or removes a category, this test WILL scream.
      expect(RESOURCE_CATEGORIES).toHaveLength(9);
    });

    it('contains every expected category in the correct order', () => {
      expect([...RESOURCE_CATEGORIES]).toEqual([
        'buffers',
        'textures',
        'textureViews',
        'samplers',
        'shaderModules',
        'renderPipelines',
        'computePipelines',
        'bindGroups',
        'bindGroupLayouts',
      ]);
    });

    it('is a readonly tuple (frozen at the type level)', () => {
      // The runtime array should still be iterable, but we're making
      // sure nobody turned it into something else by accident.
      expect(Array.isArray(RESOURCE_CATEGORIES)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getCapture() — pre-capture state
  // -------------------------------------------------------------------------
  describe('getCapture() before any capture', () => {
    it('throws with the exact expected error message', () => {
      expect(() => mgr.getCapture()).toThrowError(
        "No capture available. Run the 'capture' tool first.",
      );
    });

    it('throws an Error instance (not a string or random junk)', () => {
      expect(() => mgr.getCapture()).toThrow(Error);
    });
  });

  // -------------------------------------------------------------------------
  // hasCapture()
  // -------------------------------------------------------------------------
  describe('hasCapture()', () => {
    it('returns false on a freshly constructed instance', () => {
      expect(mgr.hasCapture()).toBe(false);
    });

    it('returns true after a successful capture', async () => {
      await mgr.capture(mockPage(sampleCapture));
      expect(mgr.hasCapture()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // capture() — basic behavior
  // -------------------------------------------------------------------------
  describe('capture()', () => {
    it('stores and returns the capture data', async () => {
      const result = await mgr.capture(mockPage(sampleCapture));
      expect(result).toEqual(sampleCapture);
      // And getCapture() should return the exact same reference
      expect(mgr.getCapture()).toBe(result);
    });

    it('calls page.evaluate with the timeout argument', async () => {
      const page = mockPage(sampleCapture);
      await mgr.capture(page, 5000);

      expect(page.evaluate).toHaveBeenCalledTimes(1);
      // page.evaluate(fn, timeoutMs) — second arg is the timeout
      const callArgs = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1]).toBe(5000);
    });

    it('uses default timeout of 30_000 when none is provided', async () => {
      const page = mockPage(sampleCapture);
      await mgr.capture(page);

      const callArgs = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1]).toBe(30_000);
    });

    it('second capture completely replaces the first', async () => {
      // First capture
      await mgr.capture(mockPage(sampleCapture));
      expect(mgr.hasCapture()).toBe(true);
      expect((mgr.getCapture() as { id: string }).id).toBe('capture_test');

      // Second capture with different data
      const secondCapture = {
        id: 'capture_2',
        resources: {
          buffers: { buf_99: { id: 'buf_99', label: 'replaced' } },
          textures: {},
          textureViews: {},
          samplers: {},
          shaderModules: {},
          renderPipelines: {},
          computePipelines: {},
          bindGroups: {},
          bindGroupLayouts: {},
        },
      };
      await mgr.capture(mockPage(secondCapture));

      // Old data must be GONE
      expect((mgr.getCapture() as { id: string }).id).toBe('capture_2');
      expect(mgr.findResource('buf_1')).toBeNull(); // from first capture
      expect(mgr.findResource('buf_99')).not.toBeNull(); // from second capture
    });

    it('propagates page.evaluate rejection', async () => {
      const failPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Browser crashed')),
      } as unknown as Page;

      await expect(mgr.capture(failPage)).rejects.toThrow('Browser crashed');
      // Must NOT set data on failure
      expect(mgr.hasCapture()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // findResource() — prefix routing
  // -------------------------------------------------------------------------
  describe('findResource()', () => {
    // We test every single prefix→category mapping from PREFIX_TABLE.
    // If someone reorders the table or typos a prefix, we'll know immediately.
    const prefixCases: Array<[id: string, expectedCategory: string]> = [
      ['buf_1', 'buffers'],
      ['buf_2', 'buffers'],
      ['tex_1', 'textures'],
      ['tv_1', 'textureViews'],
      ['smp_1', 'samplers'],
      ['shd_1', 'shaderModules'],
      ['rp_1', 'renderPipelines'],
      ['cp_1', 'computePipelines'],
      ['bg_1', 'bindGroups'],
      ['bgl_1', 'bindGroupLayouts'],
    ];

    describe.each(prefixCases)(
      'findResource("%s") → category "%s"',
      (id, expectedCategory) => {
        it(`returns { category: "${expectedCategory}" } with the correct resource`, async () => {
          const m = await loadedManager();
          const result = m.findResource(id);

          expect(result).not.toBeNull();
          expect(result!.category).toBe(expectedCategory);
          expect((result!.resource as { id: string }).id).toBe(id);
        });
      },
    );

    it('returns full resource object with all properties intact', async () => {
      const m = await loadedManager();
      const result = m.findResource('buf_1');

      expect(result).toEqual({
        category: 'buffers',
        resource: { id: 'buf_1', label: 'vertex', size: 1024, usage: 44 },
      });
    });

    it('returns shader resource with code property intact', async () => {
      const m = await loadedManager();
      const result = m.findResource('shd_1');

      expect(result).toEqual({
        category: 'shaderModules',
        resource: {
          id: 'shd_1',
          label: 'vertex shader',
          code: '@vertex fn main() {}',
        },
      });
    });

    it('returns null for nonexistent resource with valid prefix', async () => {
      // buf_999 has the buf_ prefix but doesn't exist.
      // This exercises the fast-path miss → break → slow-path scan → null path.
      const m = await loadedManager();
      expect(m.findResource('buf_999')).toBeNull();
    });

    it('returns null for completely unknown id', async () => {
      const m = await loadedManager();
      expect(m.findResource('nonexistent_99')).toBeNull();
    });

    it('returns null for empty string id', async () => {
      const m = await loadedManager();
      expect(m.findResource('')).toBeNull();
    });

    it('returns null when no capture is stored', () => {
      // Fresh manager, no capture at all — getResources() returns null
      expect(mgr.findResource('buf_1')).toBeNull();
    });

    // CRITICAL: bgl_ vs bg_ prefix ordering.
    // PREFIX_TABLE has 'bgl_' before 'bg_'. If someone reverses them,
    // 'bgl_1'.startsWith('bg_') would match first, routing to bindGroups
    // instead of bindGroupLayouts. This test catches that regression.
    it('correctly distinguishes bgl_ (bindGroupLayouts) from bg_ (bindGroups)', async () => {
      const m = await loadedManager();

      const bgl = m.findResource('bgl_1');
      expect(bgl).not.toBeNull();
      expect(bgl!.category).toBe('bindGroupLayouts');

      const bg = m.findResource('bg_1');
      expect(bg).not.toBeNull();
      expect(bg!.category).toBe('bindGroups');
    });

    it('falls back to slow-path scan for resources with non-standard prefix', async () => {
      // If a resource somehow has an id that doesn't match any known prefix,
      // findResource should still find it via the slow-path full scan.
      const customCapture = {
        resources: {
          buffers: { weird_id: { id: 'weird_id', label: 'oddball' } },
          textures: {},
          textureViews: {},
          samplers: {},
          shaderModules: {},
          renderPipelines: {},
          computePipelines: {},
          bindGroups: {},
          bindGroupLayouts: {},
        },
      };
      await mgr.capture(mockPage(customCapture));
      const result = mgr.findResource('weird_id');

      expect(result).not.toBeNull();
      expect(result!.category).toBe('buffers');
      expect((result!.resource as { label: string }).label).toBe('oddball');
    });

    it('fast-path prefix match but empty category map still falls to slow path', async () => {
      // A resource with buf_ prefix exists in textures (weird but possible).
      // Fast path matches buf_ → buffers, but buffers is empty, so it breaks
      // and falls through to slow path which scans textures.
      const weirdCapture = {
        resources: {
          buffers: {},
          textures: { buf_1: { id: 'buf_1', label: 'misplaced' } },
          textureViews: {},
          samplers: {},
          shaderModules: {},
          renderPipelines: {},
          computePipelines: {},
          bindGroups: {},
          bindGroupLayouts: {},
        },
      };
      await mgr.capture(mockPage(weirdCapture));
      const result = mgr.findResource('buf_1');

      expect(result).not.toBeNull();
      expect(result!.category).toBe('textures');
      expect((result!.resource as { label: string }).label).toBe('misplaced');
    });
  });

  // -------------------------------------------------------------------------
  // getResourcesByCategory()
  // -------------------------------------------------------------------------
  describe('getResourcesByCategory()', () => {
    it('returns the correct map for "buffers"', async () => {
      const m = await loadedManager();
      const buffers = m.getResourcesByCategory('buffers');

      expect(buffers).not.toBeNull();
      expect(Object.keys(buffers!)).toEqual(['buf_1', 'buf_2']);
      expect(buffers!['buf_1']).toEqual({
        id: 'buf_1',
        label: 'vertex',
        size: 1024,
        usage: 44,
      });
    });

    it('returns the correct map for every valid category', async () => {
      const m = await loadedManager();

      for (const category of RESOURCE_CATEGORIES) {
        const result = m.getResourcesByCategory(category);
        expect(result).not.toBeNull();
        // Every category in our fixture has at least one resource
        expect(typeof result).toBe('object');
      }
    });

    it('returns null for invalid category name', async () => {
      const m = await loadedManager();
      expect(m.getResourcesByCategory('invalid')).toBeNull();
    });

    it('returns null for category name with wrong casing', async () => {
      const m = await loadedManager();
      expect(m.getResourcesByCategory('Buffers')).toBeNull();
      expect(m.getResourcesByCategory('BUFFERS')).toBeNull();
    });

    it('returns null for empty string category', async () => {
      const m = await loadedManager();
      expect(m.getResourcesByCategory('')).toBeNull();
    });

    it('returns null when no capture is stored', () => {
      expect(mgr.getResourcesByCategory('buffers')).toBeNull();
    });

    it('returns null when capture has no resources property', async () => {
      await mgr.capture(mockPage({ id: 'empty' }));
      expect(mgr.getResourcesByCategory('buffers')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getResourceCounts()
  // -------------------------------------------------------------------------
  describe('getResourceCounts()', () => {
    it('returns correct counts from sample capture', async () => {
      const m = await loadedManager();
      const counts = m.getResourceCounts();

      expect(counts).toEqual({
        buffers: 2,
        textures: 1,
        textureViews: 1,
        samplers: 1,
        shaderModules: 1,
        renderPipelines: 1,
        computePipelines: 1,
        bindGroups: 1,
        bindGroupLayouts: 1,
      });
    });

    it('returns all zeroes when no capture is stored', () => {
      const counts = mgr.getResourceCounts();

      for (const category of RESOURCE_CATEGORIES) {
        expect(counts[category]).toBe(0);
      }
    });

    it('has exactly 9 keys matching RESOURCE_CATEGORIES', async () => {
      const m = await loadedManager();
      const counts = m.getResourceCounts();
      const keys = Object.keys(counts);

      expect(keys).toHaveLength(9);
      for (const cat of RESOURCE_CATEGORIES) {
        expect(keys).toContain(cat);
      }
    });

    it('returns all zeroes when capture has no resources property', async () => {
      await mgr.capture(mockPage({ id: 'bare', version: '1.0' }));
      const counts = mgr.getResourceCounts();

      for (const category of RESOURCE_CATEGORIES) {
        expect(counts[category]).toBe(0);
      }
    });

    it('returns correct counts with empty resource categories', async () => {
      const emptyCapture = {
        resources: {
          buffers: {},
          textures: {},
          textureViews: {},
          samplers: {},
          shaderModules: {},
          renderPipelines: {},
          computePipelines: {},
          bindGroups: {},
          bindGroupLayouts: {},
        },
      };
      await mgr.capture(mockPage(emptyCapture));
      const counts = mgr.getResourceCounts();

      for (const category of RESOURCE_CATEGORIES) {
        expect(counts[category]).toBe(0);
      }
    });

    it('counts are numbers, not strings or undefined', async () => {
      const m = await loadedManager();
      const counts = m.getResourceCounts();

      for (const category of RESOURCE_CATEGORIES) {
        expect(typeof counts[category]).toBe('number');
        expect(Number.isFinite(counts[category])).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Full prefix→category mapping coverage (all 9)
  // -------------------------------------------------------------------------
  describe('all 9 prefix→category mappings', () => {
    // This is the definitive test that every prefix maps to the right category.
    // Each test constructs a minimal capture with ONE resource in the expected
    // category, using the prefix in question, and verifies findResource routes
    // to it correctly.

    const mappings: Array<[prefix: string, category: string]> = [
      ['buf_', 'buffers'],
      ['tex_', 'textures'],
      ['tv_', 'textureViews'],
      ['smp_', 'samplers'],
      ['shd_', 'shaderModules'],
      ['rp_', 'renderPipelines'],
      ['cp_', 'computePipelines'],
      ['bg_', 'bindGroups'],
      ['bgl_', 'bindGroupLayouts'],
    ];

    it.each(mappings)(
      'prefix "%s" routes to category "%s"',
      async (prefix, category) => {
        const resourceId = `${prefix}42`;
        const resourceObj = { id: resourceId, label: `test-${prefix}` };

        // Build a capture where only the target category has the resource
        const resources: Record<string, Record<string, object>> = {};
        for (const cat of RESOURCE_CATEGORIES) {
          resources[cat] = cat === category ? { [resourceId]: resourceObj } : {};
        }

        await mgr.capture(mockPage({ resources }));
        const result = mgr.findResource(resourceId);

        expect(result).not.toBeNull();
        expect(result!.category).toBe(category);
        expect(result!.resource).toEqual(resourceObj);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Edge cases & state transitions
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('findResource returns null for resource id that is just a prefix with no suffix', async () => {
      const m = await loadedManager();
      // "buf_" alone is not a resource id in our fixture
      expect(m.findResource('buf_')).toBeNull();
    });

    it('multiple getCapture() calls return the same reference', async () => {
      await mgr.capture(mockPage(sampleCapture));
      const a = mgr.getCapture();
      const b = mgr.getCapture();
      expect(a).toBe(b);
    });

    it('getCapture() throws after construction, works after capture, throws concept does not apply since capture is permanent', async () => {
      // This tests the full lifecycle: no capture → capture → accessible
      expect(() => mgr.getCapture()).toThrow();
      await mgr.capture(mockPage(sampleCapture));
      expect(() => mgr.getCapture()).not.toThrow();
    });

    it('capture with data containing no resources still sets hasCapture to true', async () => {
      await mgr.capture(mockPage({ id: 'minimal' }));
      expect(mgr.hasCapture()).toBe(true);
      // getCapture should return the object, not throw
      expect((mgr.getCapture() as { id: string }).id).toBe('minimal');
    });

    it('findResource with capture that has missing category keys returns null', async () => {
      // Only buffers exists, all other categories are absent (not even empty objects)
      const partial = {
        resources: {
          buffers: { buf_1: { id: 'buf_1' } },
        },
      };
      await mgr.capture(mockPage(partial));

      expect(mgr.findResource('buf_1')).toEqual({
        category: 'buffers',
        resource: { id: 'buf_1' },
      });
      expect(mgr.findResource('tex_1')).toBeNull();
    });

    it('getResourceCounts handles partially populated resources', async () => {
      // Only buffers key exists
      const partial = {
        resources: {
          buffers: { buf_1: { id: 'buf_1' }, buf_2: { id: 'buf_2' } },
        },
      };
      await mgr.capture(mockPage(partial));
      const counts = mgr.getResourceCounts();

      expect(counts.buffers).toBe(2);
      // Missing categories should be 0, not undefined or NaN
      expect(counts.textures).toBe(0);
      expect(counts.shaderModules).toBe(0);
      expect(counts.bindGroupLayouts).toBe(0);
    });
  });
});
