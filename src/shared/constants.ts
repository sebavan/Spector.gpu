/** Semver for the Spector.GPU extension; embedded in every ICapture. */
export const SPECTOR_GPU_VERSION = '0.1.0' as const;

/** Prefix for chrome.storage.local keys holding serialized captures. */
export const STORAGE_KEY_PREFIX = 'spectorGpu_capture_' as const;

/**
 * Hard ceiling on ICommandNode count per capture.
 * Prevents runaway memory when intercepting pathological frames.
 */
export const MAX_COMMAND_COUNT = 50_000;

/**
 * Maximum wall-clock time (ms) before a capture is force-stopped.
 * Guards against infinite loops in the intercepted page.
 */
export const CAPTURE_TIMEOUT_MS = 30_000;
