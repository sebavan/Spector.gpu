import type { Page } from 'playwright';

/** All WebGPU resource categories tracked by Spector.GPU. */
export const RESOURCE_CATEGORIES = [
  'buffers', 'textures', 'textureViews', 'samplers', 'shaderModules',
  'renderPipelines', 'computePipelines', 'bindGroups', 'bindGroupLayouts',
] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

/**
 * Prefix→category lookup table.
 * Ordered so longer prefixes are checked first ('bgl_' before 'bg_').
 */
const PREFIX_TABLE: ReadonlyArray<readonly [prefix: string, category: ResourceCategory]> = [
  ['buf_', 'buffers'],
  ['tex_', 'textures'],
  ['tv_',  'textureViews'],
  ['smp_', 'samplers'],
  ['shd_', 'shaderModules'],
  ['rp_',  'renderPipelines'],
  ['cp_',  'computePipelines'],
  ['bgl_', 'bindGroupLayouts'],
  ['bg_',  'bindGroups'],
];

/**
 * Executes WebGPU frame captures via Playwright and provides
 * query methods over the captured resource data.
 */
export class CaptureManager {
  private data: object | null = null;

  /**
   * Trigger a Spector.GPU frame capture in the browser page.
   *
   * Calls `window.__spectorGpuInstance.captureNextFrame()` inside
   * `page.evaluate()`, waits for the `onCaptureComplete` event,
   * converts any Maps to plain objects for JSON serialization,
   * and stores the full result (no stripping).
   *
   * @param page - Playwright Page with Spector.GPU already injected
   * @param timeoutMs - Max milliseconds to wait for capture (default 30 000)
   * @returns The full capture object
   */
  async capture(page: Page, timeoutMs = 30_000): Promise<object> {
    const result = await page.evaluate((timeout: number) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Capture timeout')),
          timeout,
        );

        // globalThis === window in browser context; avoids needing DOM lib types
        const s = (globalThis as Record<string, unknown>).__spectorGpuInstance as
          | {
              onCaptureComplete: { add(cb: (c: unknown) => void): void };
              onCaptureError: { add(cb: (e: { error?: { message?: string } }) => void): void };
              captureNextFrame(): void;
            }
          | undefined;

        if (!s) {
          clearTimeout(timer);
          reject(new Error('No WebGPU instance'));
          return;
        }

        s.onCaptureComplete.add((capture: unknown) => {
          clearTimeout(timer);

          /** Recursively convert Map instances to plain objects. */
          function mapsToObjects(obj: unknown): unknown {
            if (obj instanceof Map) {
              const out: Record<string, unknown> = {};
              for (const [k, v] of obj) out[k] = mapsToObjects(v);
              return out;
            }
            if (Array.isArray(obj)) return obj.map(mapsToObjects);
            if (obj && typeof obj === 'object') {
              const out: Record<string, unknown> = {};
              for (const k of Object.keys(obj)) {
                out[k] = mapsToObjects((obj as Record<string, unknown>)[k]);
              }
              return out;
            }
            return obj;
          }

          resolve(mapsToObjects(capture));
        });

        s.onCaptureError.add(({ error }) => {
          clearTimeout(timer);
          reject(new Error(error?.message ?? String(error)));
        });

        s.captureNextFrame();
      });
    }, timeoutMs);

    this.data = result as object;
    return this.data;
  }

  /**
   * Return the stored capture object.
   * @throws If no capture has been performed yet
   */
  getCapture(): object {
    if (this.data === null) {
      throw new Error("No capture available. Run the 'capture' tool first.");
    }
    return this.data;
  }

  /**
   * Check whether a capture result is currently stored.
   */
  hasCapture(): boolean {
    return this.data !== null;
  }

  /**
   * Find a resource by its ID.
   *
   * Uses a prefix→category table for O(1) lookup (e.g. `buf_1` → `buffers`).
   * Falls back to scanning all 9 categories if the prefix doesn't yield a hit.
   *
   * @param id - Resource identifier (e.g. `'buf_1'`, `'tex_3'`, `'bgl_0'`)
   * @returns The category name and resource object, or `null` if not found
   */
  findResource(id: string): { category: string; resource: object } | null {
    const resources = this.getResources();
    if (!resources) return null;

    // Fast path: prefix-based lookup
    for (const [prefix, category] of PREFIX_TABLE) {
      if (id.startsWith(prefix)) {
        const map = resources[category] as Record<string, object> | undefined;
        if (map && id in map) {
          return { category, resource: map[id] };
        }
        // Prefix matched but resource absent — fall through to full scan
        break;
      }
    }

    // Slow path: scan every category
    for (const category of RESOURCE_CATEGORIES) {
      const map = resources[category] as Record<string, object> | undefined;
      if (map && id in map) {
        return { category, resource: map[id] };
      }
    }

    return null;
  }

  /**
   * Return all resources in the given category.
   * @param category - One of the {@link RESOURCE_CATEGORIES} values
   * @returns The resource map keyed by resource ID, or `null` if the category is invalid or no capture exists
   */
  getResourcesByCategory(category: string): Record<string, object> | null {
    const resources = this.getResources();
    if (!resources) return null;
    if (!(RESOURCE_CATEGORIES as readonly string[]).includes(category)) return null;
    return (resources[category] as Record<string, object>) ?? null;
  }

  /**
   * Return a count of resources in each of the 9 categories.
   * Returns all zeroes if no capture is stored.
   */
  getResourceCounts(): Record<string, number> {
    const resources = this.getResources();
    const counts: Record<string, number> = {};
    for (const category of RESOURCE_CATEGORIES) {
      const map = resources?.[category] as Record<string, unknown> | undefined;
      counts[category] = map ? Object.keys(map).length : 0;
    }
    return counts;
  }

  /** Internal helper: extract `capture.resources` with a single cast. */
  private getResources(): Record<string, unknown> | null {
    if (this.data === null) return null;
    return (this.data as { resources?: Record<string, unknown> }).resources ?? null;
  }
}
