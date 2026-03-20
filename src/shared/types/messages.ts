/**
 * Chrome extension messaging types for Spector.GPU.
 *
 * All cross-context communication (content script ↔ background ↔ popup
 * ↔ result page) flows through these message types. The discriminated
 * union on MessageType makes exhaustive switch/case checking possible.
 */

import type { IAdapterInfo, ICaptureStats } from './capture';

// ─── Message discriminant ────────────────────────────────────────────

/** Every message sent via chrome.runtime.sendMessage carries one of these. */
export enum MessageType {
    // Content script → Background
    WEBGPU_DETECTED     = 'WEBGPU_DETECTED',
    WEBGPU_NOT_DETECTED = 'WEBGPU_NOT_DETECTED',
    CAPTURE_COMPLETE    = 'CAPTURE_COMPLETE',
    CAPTURE_ERROR       = 'CAPTURE_ERROR',
    ADAPTER_INFO        = 'ADAPTER_INFO',

    // Background → Content script
    START_CAPTURE       = 'START_CAPTURE',
    STOP_CAPTURE        = 'STOP_CAPTURE',
    STATUS_QUERY        = 'STATUS_QUERY',

    // Background → Popup
    STATUS_RESPONSE     = 'STATUS_RESPONSE',

    // Popup → Background
    CAPTURE_REQUEST     = 'CAPTURE_REQUEST',

    // Background → Result page
    CAPTURE_DATA        = 'CAPTURE_DATA',
}

// ─── Wire message ────────────────────────────────────────────────────

/**
 * Envelope for every chrome.runtime message.
 *
 * `payload` is typed as `unknown` at the wire level; callers narrow
 * it via MessageType after receipt.
 */
export interface IMessage {
    readonly type: MessageType;
    readonly tabId?: number;
    readonly payload?: unknown;
}

// ─── Typed payloads ──────────────────────────────────────────────────

/** Payload for MessageType.STATUS_RESPONSE. */
export interface IStatusResponse {
    readonly webgpuDetected: boolean;
    readonly adapterInfo?: IAdapterInfo;
    readonly isCapturing: boolean;
    readonly lastCaptureId?: string;
}

/** Payload for MessageType.CAPTURE_REQUEST. */
export interface ICaptureRequest {
    /** When true, skip expensive texture readback for faster captures. */
    readonly quickCapture: boolean;
}

/** Payload for MessageType.CAPTURE_COMPLETE. */
export interface ICaptureCompletePayload {
    /** Key used to retrieve the full ICapture from chrome.storage.local. */
    readonly captureId: string;
    readonly stats: ICaptureStats;
}

/** Payload for MessageType.CAPTURE_ERROR. */
export interface ICaptureErrorPayload {
    readonly message: string;
    readonly stack?: string;
}
