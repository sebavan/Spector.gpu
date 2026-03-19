/**
 * SpectorGPU Content Script Proxy — ISOLATED world
 *
 * Bridges messages between the MAIN world content script (which has
 * access to navigator.gpu) and the extension's background service worker.
 *
 * MAIN world ←→ window.postMessage (prefixed) ←→ this proxy ←→ chrome.runtime
 *
 * All SpectorGPU messages are prefixed with SPECTOR_GPU_ to avoid
 * collisions with other window.postMessage traffic on the page.
 */

const SPECTOR_GPU_PREFIX = 'SPECTOR_GPU_';

// ── MAIN world → background ─────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
    // Only accept messages from this window (not iframes).
    if (event.source !== window) return;

    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    if (!data.type.startsWith(SPECTOR_GPU_PREFIX)) return;

    // Strip prefix and forward to background service worker.
    const message = {
        type: data.type.slice(SPECTOR_GPU_PREFIX.length),
        payload: data.payload,
    };

    chrome.runtime.sendMessage(message).catch((e: unknown) => {
        // Extension context invalidated (e.g. extension reloaded) — swallow.
        if (e instanceof Error && e.message.includes('Extension context invalidated')) return;
        console.error('[SpectorGPU Proxy] Failed to send to background:', e);
    });
});

// ── Background → MAIN world ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    // Forward to MAIN world via window.postMessage with prefix.
    window.postMessage(
        {
            type: SPECTOR_GPU_PREFIX + message.type,
            payload: message.payload,
        },
        '*',
    );
});

console.log('[SpectorGPU] Content script proxy (ISOLATED) loaded');
