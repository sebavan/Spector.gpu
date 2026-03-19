import React, { useState, useEffect, useCallback } from 'react';
import type { ICapture, ICommandNode } from '@shared/types';
import { readCapture } from '@shared/utils/captureStorage';
import { CommandTree } from './CommandTree';
import { CommandDetail } from './CommandDetail';
import { ShaderEditor } from './ShaderEditor';
import { PipelineInspector } from './PipelineInspector';
import { ResourceInspector } from './ResourceInspector';
import { CaptureHeader } from './CaptureHeader';
import { NavigationContext, type NavigationTarget } from './NavigationContext';

type DetailTab = 'detail' | 'shader' | 'pipeline' | 'resources';

export function ResultApp() {
    const [capture, setCapture] = useState<ICapture | null>(null);
    const [selectedNode, setSelectedNode] = useState<ICommandNode | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<DetailTab>('detail');
    const [resourceNavTarget, setResourceNavTarget] = useState<NavigationTarget | null>(null);

    const navigateToResource = useCallback((target: NavigationTarget) => {
        setActiveTab('resources');
        setResourceNavTarget(target);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const captureId = params.get('captureId');

        if (!captureId) {
            setError('No capture ID provided');
            setLoading(false);
            return;
        }

        readCapture(captureId)
            .then(data => {
                if (data) {
                    const cap = data as ICapture;
                    setCapture(cap);
                    // Auto-select the first command if present.
                    if (cap.commands.length > 0) {
                        setSelectedNode(cap.commands[0]);
                    }
                } else {
                    setError('Capture not found');
                }
            })
            .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : 'Failed to load capture');
            })
            .finally(() => setLoading(false));
    }, []);

    const handleSelect = useCallback((node: ICommandNode) => {
        setSelectedNode(node);
    }, []);

    if (loading) {
        return <div className="loading">Loading capture…</div>;
    }

    if (error || !capture) {
        return <div className="error">{error ?? 'Unknown error'}</div>;
    }

    return (
        <NavigationContext.Provider value={navigateToResource}>
            <div className="result-app">
                <CaptureHeader capture={capture} />
                <div className="result-content">
                    <div className="left-panel">
                        <CommandTree
                            commands={capture.commands}
                            selectedId={selectedNode?.id ?? null}
                            onSelect={handleSelect}
                        />
                    </div>
                    <div className="right-panel">
                        <div className="tab-bar">
                            <TabButton label="Details"   tab="detail"    active={activeTab} onClick={setActiveTab} />
                            <TabButton label="Shaders"   tab="shader"    active={activeTab} onClick={setActiveTab} />
                            <TabButton label="Pipeline"  tab="pipeline"  active={activeTab} onClick={setActiveTab} />
                            <TabButton label="Resources" tab="resources" active={activeTab} onClick={setActiveTab} />
                        </div>
                        <div className="tab-content">
                            {activeTab === 'detail'    && <CommandDetail node={selectedNode} capture={capture} />}
                            {activeTab === 'shader'    && <ShaderEditor node={selectedNode} capture={capture} />}
                            {activeTab === 'pipeline'  && <PipelineInspector node={selectedNode} capture={capture} />}
                            {activeTab === 'resources' && <ResourceInspector capture={capture} navTarget={resourceNavTarget} />}
                        </div>
                    </div>
                </div>
            </div>
        </NavigationContext.Provider>
    );
}

function TabButton({ label, tab, active, onClick }: {
    label: string;
    tab: DetailTab;
    active: DetailTab;
    onClick: (t: DetailTab) => void;
}) {
    const handleClick = useCallback(() => onClick(tab), [onClick, tab]);
    return (
        <button className={active === tab ? 'active' : ''} onClick={handleClick}>
            {label}
        </button>
    );
}
