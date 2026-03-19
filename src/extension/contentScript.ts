/**
 * SpectorGPU Content Script — MAIN world
 *
 * Runs in the page's JavaScript context (MAIN world) so it has direct
 * access to navigator.gpu, GPUDevice, and all WebGPU objects.
 *
 * Responsibilities:
 *   1. Instantiate SpectorGPU in passive mode (detect adapter/device).
 *   2. Relay detection events to the extension via the ISOLATED proxy.
 *   3. Listen for capture commands from the extension (START_CAPTURE,
 *      STOP_CAPTURE, STATUS_QUERY) and drive SpectorGPU accordingly.
 *   4. Serialize completed captures to JSON and send through the
 *      message channel for storage in chrome.storage.local.
 */

import { SpectorGPU } from '../core/spectorGpu';
import { MessageType } from '../shared/types/messages';
import { captureToJSON } from '../shared/utils/serialization';

const SPECTOR_GPU_PREFIX = 'SPECTOR_GPU_';

let spectorGpu: SpectorGPU | null = null;

function init(): void {
    spectorGpu = new SpectorGPU();

    // ── WebGPU detection → extension ─────────────────────────────────

    spectorGpu.onWebGPUDetected.add((adapterInfo) => {
        sendToExtension(MessageType.WEBGPU_DETECTED, adapterInfo);
    });

    // ── Capture lifecycle → extension ────────────────────────────────

    spectorGpu.onCaptureComplete.add((capture) => {
        const captureId = `spectorGpu_capture_${Date.now()}`;

        // Serialize with Map→Object support BEFORE posting through the
        // message channel. chrome.runtime.sendMessage uses JSON internally,
        // which would silently drop Map entries.
        const serialized = captureToJSON(capture);

        sendToExtension(MessageType.CAPTURE_DATA, {
            captureId,
            data: serialized,
        });

        // Notify completion (stats are plain numbers — JSON-safe).
        sendToExtension(MessageType.CAPTURE_COMPLETE, {
            captureId,
            stats: capture.stats,
        });

        // Expose last capture stats for E2E test verification
        (window as any).__lastCaptureStats = capture.stats;
    });

    spectorGpu.onCaptureError.add(({ error }) => {
        sendToExtension(MessageType.CAPTURE_ERROR, {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
    });

    // ── Initialize passive mode ──────────────────────────────────────

    spectorGpu.init();

    // Expose instance for E2E test access (Playwright reads this via page.evaluate)
    (window as any).__spectorGpuInstance = spectorGpu;

    // ── Listen for commands from extension (via ISOLATED proxy) ──────

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data?.type?.startsWith(SPECTOR_GPU_PREFIX)) return;

        const type = data.type.slice(SPECTOR_GPU_PREFIX.length);

        switch (type) {
            case MessageType.START_CAPTURE:
                spectorGpu?.captureNextFrame();
                // Auto-finalize after one frame boundary (2 rAFs).
                // stopCapture() is idempotent — safe if already stopped.
                if (typeof requestAnimationFrame !== 'undefined') {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            if (spectorGpu?.isCapturing) {
                                spectorGpu.stopCapture();
                            }
                        });
                    });
                }
                break;

            case MessageType.STOP_CAPTURE:
                spectorGpu?.stopCapture();
                break;

            case MessageType.STATUS_QUERY:
                sendToExtension(MessageType.STATUS_RESPONSE, {
                    webgpuDetected: !!spectorGpu?.adapterInfo,
                    isCapturing: spectorGpu?.isCapturing ?? false,
                    adapterInfo: spectorGpu?.adapterInfo,
                });
                break;
        }
    });
}

/** Post a prefixed message to window for the ISOLATED proxy to pick up. */
function sendToExtension(type: string, payload: unknown): void {
    window.postMessage(
        { type: SPECTOR_GPU_PREFIX + type, payload },
        '*',
    );
}

// Auto-initialize on injection.
init();

console.log('[SpectorGPU] Content script (MAIN) loaded');
