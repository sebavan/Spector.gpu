import React from 'react';
import type { ICapture } from '@shared/types';

export function CaptureHeader({ capture }: { capture: ICapture }) {
    const { stats, adapterInfo, duration } = capture;

    return (
        <header className="capture-header">
            <div className="header-title">
                <h1>SpectorGPU Capture</h1>
                <span className="adapter-info">
                    {adapterInfo.description || adapterInfo.vendor || 'Unknown GPU'}
                </span>
            </div>
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
