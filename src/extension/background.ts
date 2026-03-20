/**
 * Spector.GPU Background Service Worker
 *
 * Routes messages between content scripts (MAIN ↔ ISOLATED proxy) and
 * the popup / result-view UI. Maintains per-tab state (WebGPU detection,
 * capture status) in-memory, with cleanup on tab close / navigation.
 *
 * Storage: captures are stored in chrome.storage.local as JSON strings.
 * Large captures (>4 MB) are automatically chunked.
 */

import { MessageType } from '../shared/types/messages';
import type { IMessage, IStatusResponse, ICaptureCompletePayload } from '../shared/types/messages';
import { writeCapture } from '../shared/utils/captureStorage';

// ── Per-tab state ────────────────────────────────────────────────────

interface TabState {
    webgpuDetected: boolean;
    isCapturing: boolean;
    lastCaptureId?: string;
    adapterInfo?: unknown;
}

const tabStates = new Map<number, TabState>();

function getTabState(tabId: number): TabState {
    let state = tabStates.get(tabId);
    if (state === undefined) {
        state = { webgpuDetected: false, isCapturing: false };
        tabStates.set(tabId, state);
    }
    return state;
}

// ── Message router ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: IMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id ?? message.tabId;

    switch (message.type) {
        case MessageType.WEBGPU_DETECTED: {
            if (tabId !== undefined) {
                const state = getTabState(tabId);
                state.webgpuDetected = true;
                state.adapterInfo = message.payload;
                chrome.action.setIcon({
                    tabId,
                    path: {
                        16: 'icons/icon16.png',
                        48: 'icons/icon48-active.png',
                        128: 'icons/icon128-active.png',
                    },
                }).catch(() => {});
                chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
            }
            break;
        }

        case MessageType.WEBGPU_NOT_DETECTED: {
            if (tabId !== undefined) {
                const state = getTabState(tabId);
                state.webgpuDetected = false;
                chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
            }
            break;
        }

        case MessageType.CAPTURE_COMPLETE: {
            if (tabId !== undefined) {
                const state = getTabState(tabId);
                state.isCapturing = false;
                const payload = message.payload as ICaptureCompletePayload;
                state.lastCaptureId = payload.captureId;

                // Open result view — reuse an existing Spector.GPU result tab if one exists
                const resultUrl = chrome.runtime.getURL('result.html');
                chrome.tabs.query({ url: resultUrl + '*' }, (existingTabs) => {
                    const targetUrl = `${resultUrl}?captureId=${payload.captureId}&tabId=${tabId}`;
                    if (existingTabs && existingTabs.length > 0) {
                        // Reuse the first existing result tab
                        const existingTab = existingTabs[0];
                        chrome.tabs.update(existingTab.id!, { url: targetUrl, active: true })
                            .catch(e => console.error('[Spector.GPU] Failed to update result tab:', e));
                    } else {
                        chrome.tabs.create({ url: targetUrl })
                            .catch(e => console.error('[Spector.GPU] Failed to open result tab:', e));
                    }
                });
            }
            break;
        }

        case MessageType.CAPTURE_ERROR: {
            if (tabId !== undefined) {
                const state = getTabState(tabId);
                state.isCapturing = false;
            }
            break;
        }

        case MessageType.CAPTURE_REQUEST: {
            if (tabId !== undefined) {
                const state = getTabState(tabId);
                state.isCapturing = true;
                chrome.tabs.sendMessage(tabId, {
                    type: MessageType.START_CAPTURE,
                    payload: message.payload,
                }).catch(e => console.error('[Spector.GPU] Failed to send capture request:', e));
            }
            break;
        }

        case MessageType.STATUS_QUERY: {
            if (tabId !== undefined) {
                const state = getTabState(tabId);
                const response: IStatusResponse = {
                    webgpuDetected: state.webgpuDetected,
                    adapterInfo: state.adapterInfo as IStatusResponse['adapterInfo'],
                    isCapturing: state.isCapturing,
                    lastCaptureId: state.lastCaptureId,
                };
                sendResponse(response);
                return true; // keep message channel open for async response
            }
            break;
        }

        case MessageType.CAPTURE_DATA: {
            const { captureId, data } = message.payload as { captureId: string; data: unknown };
            if (captureId && data) {
                // Content script sends pre-serialized JSON string.
                // Defensive: if it's an object (Maps already lost in transit),
                // re-serialize as best-effort.
                const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
                writeCapture(captureId, jsonStr).catch(e =>
                    console.error('[Spector.GPU] Failed to store capture:', e),
                );
            }
            break;
        }
    }
});

// ── Tab lifecycle cleanup ────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        const state = tabStates.get(tabId);
        if (state) {
            state.webgpuDetected = false;
            state.isCapturing = false;
        }
        chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }
});

console.log('[Spector.GPU] Background service worker started');
