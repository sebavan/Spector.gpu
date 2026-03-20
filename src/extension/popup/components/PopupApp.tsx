import { useState, useEffect, useCallback } from 'react';
import { MessageType } from '../../../shared/types/messages';
import type { IStatusResponse } from '../../../shared/types/messages';

export function PopupApp(): React.JSX.Element {
    const [status, setStatus] = useState<IStatusResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [capturing, setCapturing] = useState(false);

    useEffect(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (tabId === undefined) {
                setLoading(false);
                return;
            }

            chrome.runtime.sendMessage(
                {
                    type: MessageType.STATUS_QUERY,
                    tabId,
                },
                (response: IStatusResponse) => {
                    if (response) {
                        setStatus(response);
                        setCapturing(response.isCapturing);
                    }
                    setLoading(false);
                },
            );
        });
    }, []);

    const handleCapture = useCallback(() => {
        setCapturing(true);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0]?.id;
            if (tabId === undefined) return;

            chrome.runtime.sendMessage({
                type: MessageType.CAPTURE_REQUEST,
                tabId,
                payload: { quickCapture: false },
            });
        });

        // Close popup after triggering capture — capture continues in background
        setTimeout(() => window.close(), 500);
    }, []);

    if (loading) {
        return (
            <div className="popup">
                <div className="popup-loading">Checking WebGPU status…</div>
            </div>
        );
    }

    const detected = status?.webgpuDetected ?? false;
    const info = status?.adapterInfo;

    return (
        <div className="popup">
            <div className="popup-header">
                <div className="logo">
                    <span className="logo-icon">◆</span>
                    <span className="logo-text">Spector.GPU</span>
                </div>
            </div>

            <div className="popup-body">
                {/* Detection status */}
                <div className={`status-section ${detected ? 'detected' : 'not-detected'}`}>
                    <div className="status-dot" />
                    <div className="status-text">
                        {detected ? 'WebGPU Active' : 'No WebGPU Detected'}
                    </div>
                </div>

                {/* Adapter info */}
                {detected && info != null && (
                    <div className="info-section">
                        {info.description && (
                            <div className="info-row">
                                <span className="info-label">GPU:</span>
                                <span className="info-value">{info.description}</span>
                            </div>
                        )}
                        {info.vendor && (
                            <div className="info-row">
                                <span className="info-label">Vendor:</span>
                                <span className="info-value">{info.vendor}</span>
                            </div>
                        )}
                        {info.architecture && (
                            <div className="info-row">
                                <span className="info-label">Arch:</span>
                                <span className="info-value">{info.architecture}</span>
                            </div>
                        )}
                        {info.backend && (
                            <div className="info-row">
                                <span className="info-label">Backend:</span>
                                <span className="info-value">{info.backend}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Capture button */}
                <button
                    className="capture-btn"
                    disabled={!detected || capturing}
                    onClick={handleCapture}
                    type="button"
                >
                    {capturing ? '⏳ Capturing…' : '📸 Capture Frame'}
                </button>

                {!detected && (
                    <div className="hint">
                        Navigate to a page using WebGPU to enable capture.
                        Try reloading if the page loaded before Spector.GPU.
                    </div>
                )}
            </div>

            <div className="popup-footer">
                <span>Spector.GPU v0.1.0</span>
            </div>
        </div>
    );
}
