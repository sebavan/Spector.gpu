/**
 * CJS→ESM bridge for the buildSummary function.
 *
 * The existing summary.js in skills/spector-gpu-capture/ is CommonJS.
 * This module uses createRequire to import it from our ESM package.
 *
 * Resolution base: import.meta.url resolves to the COMPILED location
 * (mcp/dist/summary.js), so '../../skills/...' correctly reaches the
 * repo root's skills/ directory.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const summaryModule = require('../../skills/spector-gpu-capture/summary.js');

/**
 * Build a human/AI-readable summary from a full capture object.
 * @param capture - The full capture object from CaptureManager
 * @returns JSON string with adapter info, stats, command tree, resources
 */
export const buildSummary: (capture: object) => string = summaryModule.buildSummary;
