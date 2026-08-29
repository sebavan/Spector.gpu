import React, { useCallback, useState } from 'react';
import type { ICapture } from '@shared/types';

/** Props for the capture summary and retention controls. */
export interface CaptureHeaderProps {
    capture: ICapture;
    deleting: boolean;
    onDelete: () => Promise<void>;
}

/** Display capture statistics and allow deletion from local extension storage. */
export function CaptureHeader({ capture, deleting, onDelete }: CaptureHeaderProps) {
    const { stats, adapterInfo, duration } = capture;
    const [deleteArmed, setDeleteArmed] = useState(false);

    const handleDelete = useCallback(async () => {
        if (!deleteArmed) {
            setDeleteArmed(true);
            return;
        }
        await onDelete();
    }, [deleteArmed, onDelete]);

    return (
        <header className="capture-header">
            <div className="header-title">
                <h1>Spector.GPU Capture</h1>
                <span className="adapter-info">
                    {adapterInfo.description || adapterInfo.vendor || 'Unknown GPU'}
                </span>
            </div>
            <div className="header-actions">
                <div className="header-stats">
                    <StatBadge label="Commands" value={stats.totalCommands} />
                    <StatBadge label="Draw Calls" value={stats.drawCalls} />
                    <StatBadge label="Dispatches" value={stats.dispatchCalls} />
                    <StatBadge label="Render Passes" value={stats.renderPasses} />
                    <StatBadge label="Compute Passes" value={stats.computePasses} />
                    <StatBadge label="Pipelines" value={stats.pipelineCount} />
                    <StatBadge label="Buffers" value={stats.bufferCount} />
                    <StatBadge label="Textures" value={stats.textureCount} />
                    <StatBadge label="Duration" value={`${duration.toFixed(1)}ms`} />
                </div>
                <button
                    className={`header-delete${deleteArmed ? ' armed' : ''}`}
                    disabled={deleting}
                    onClick={handleDelete}
                    type="button"
                >
                    {deleting
                        ? 'Deleting…'
                        : deleteArmed
                            ? 'Confirm delete'
                            : 'Delete stored capture'}
                </button>
            </div>
        </header>
    );
}

function StatBadge({ label, value }: { label: string; value: number | string }) {
    return (
        <div className="stat-badge">
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
        </div>
    );
}
