import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ICapture, ICommandNode } from '@shared/types';
import { readCapture } from '@shared/utils/captureStorage';
import { CommandDetail } from './CommandDetail';
import { ShaderEditor } from './ShaderEditor';
import { PipelineInspector } from './PipelineInspector';
import { CaptureHeader } from './CaptureHeader';
import { NavigationContext, type NavigationTarget, type ResourceCategory } from './NavigationContext';
import { SidebarPanel } from './SidebarPanel';
import { DraggableDivider } from './DraggableDivider';
import { ResourceDetail } from './ResourceDetail';
import { resolveMapToRecord } from '../resourceMapHelpers';
import { buildUsageIndex } from '../usageIndex';

type CommandTab = 'detail' | 'shader' | 'pipeline';
type SidebarMode = 'commands' | 'resources';

const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 500;
const DEFAULT_LEFT_WIDTH = 320;

/** Category key → human label for breadcrumbs. */
const CATEGORY_LABELS: Record<ResourceCategory, string> = {
    buffers: 'Buffers',
    textures: 'Textures',
    textureViews: 'Texture Views',
    samplers: 'Samplers',
    shaderModules: 'Shader Modules',
    renderPipelines: 'Render Pipelines',
    computePipelines: 'Compute Pipelines',
    bindGroups: 'Bind Groups',
    bindGroupLayouts: 'Bind Group Layouts',
};

// ── History state for back/forward navigation ─────────────────────────

interface NavState {
    mode: SidebarMode;
    commandId: string | null;
    tab: CommandTab;
    resourceCategory: ResourceCategory | null;
    resourceId: string | null;
}

/** DFS lookup of a command node by id. */
function findNodeById(nodes: readonly ICommandNode[], id: string): ICommandNode | null {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return nodes[i];
        if (nodes[i].children.length > 0) {
            const found = findNodeById(nodes[i].children, id);
            if (found) return found;
        }
    }
    return null;
}

export function ResultApp() {
    const [capture, setCapture] = useState<ICapture | null>(null);
    const [selectedNode, setSelectedNode] = useState<ICommandNode | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<CommandTab>('detail');

    // Sidebar state
    const [sidebarMode, setSidebarMode] = useState<SidebarMode>('commands');
    const [selectedResourceCategory, setSelectedResourceCategory] = useState<ResourceCategory | null>(null);
    const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
    const [leftPanelWidth, setLeftPanelWidth] = useState(DEFAULT_LEFT_WIDTH);

    // Guard: don't push history when restoring from popstate
    const restoringRef = useRef(false);

    // ── Push browser history on navigation changes ────────────────────
    const pushHistory = useCallback((state: NavState) => {
        if (restoringRef.current) return;
        try { history.pushState(state, ''); } catch { /* extension sandbox */ }
    }, []);

    // ── Restore state from popstate (back/forward) ────────────────────
    useEffect(() => {
        const onPopState = (e: PopStateEvent) => {
            const s = e.state as NavState | null;
            if (!s || !capture) return;
            restoringRef.current = true;
            setSidebarMode(s.mode);
            setActiveTab(s.tab);
            setSelectedResourceCategory(s.resourceCategory);
            setSelectedResourceId(s.resourceId);
            if (s.commandId) {
                const node = findNodeById(capture.commands, s.commandId);
                setSelectedNode(node);
            } else {
                setSelectedNode(null);
            }
            restoringRef.current = false;
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [capture]);

    const navigateToResource = useCallback((target: NavigationTarget) => {
        setSidebarMode('resources');
        setSelectedResourceCategory(target.category);
        setSelectedResourceId(target.id);
        pushHistory({
            mode: 'resources',
            commandId: null,
            tab: 'detail',
            resourceCategory: target.category,
            resourceId: target.id,
        });
    }, [pushHistory]);

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
                    const firstNode = cap.commands.length > 0 ? cap.commands[0] : null;
                    setSelectedNode(firstNode);
                    // Replace (not push) initial state so the first back
                    // doesn't go to a blank page.
                    try {
                        history.replaceState({
                            mode: 'commands',
                            commandId: firstNode?.id ?? null,
                            tab: 'detail',
                            resourceCategory: null,
                            resourceId: null,
                        } as NavState, '');
                    } catch { /* extension sandbox */ }
                } else {
                    setError('Capture not found');
                }
            })
            .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : 'Failed to load capture');
            })
            .finally(() => setLoading(false));
    }, []);

    const handleSelectCommand = useCallback((node: ICommandNode) => {
        setSelectedNode(node);
        pushHistory({
            mode: sidebarMode,
            commandId: node.id,
            tab: activeTab,
            resourceCategory: selectedResourceCategory,
            resourceId: selectedResourceId,
        });
    }, [pushHistory, sidebarMode, activeTab, selectedResourceCategory, selectedResourceId]);

    const handleSelectResource = useCallback((category: ResourceCategory, id: string) => {
        setSelectedResourceCategory(category);
        setSelectedResourceId(id);
        pushHistory({
            mode: 'resources',
            commandId: selectedNode?.id ?? null,
            tab: activeTab,
            resourceCategory: category,
            resourceId: id,
        });
    }, [pushHistory, selectedNode, activeTab]);

    const handleModeChange = useCallback((mode: SidebarMode) => {
        setSidebarMode(mode);
        pushHistory({
            mode,
            commandId: selectedNode?.id ?? null,
            tab: activeTab,
            resourceCategory: selectedResourceCategory,
            resourceId: selectedResourceId,
        });
    }, [pushHistory, selectedNode, activeTab, selectedResourceCategory, selectedResourceId]);

    const handleTabChange = useCallback((tab: CommandTab) => {
        setActiveTab(tab);
        pushHistory({
            mode: sidebarMode,
            commandId: selectedNode?.id ?? null,
            tab,
            resourceCategory: selectedResourceCategory,
            resourceId: selectedResourceId,
        });
    }, [pushHistory, sidebarMode, selectedNode, selectedResourceCategory, selectedResourceId]);

    const handleDividerDrag = useCallback((deltaX: number) => {
        setLeftPanelWidth(prev => {
            const next = prev + deltaX;
            if (next < MIN_LEFT_WIDTH) return MIN_LEFT_WIDTH;
            if (next > MAX_LEFT_WIDTH) return MAX_LEFT_WIDTH;
            return next;
        });
    }, []);

    // Resolve the currently selected resource object for the detail panel
    const selectedResource = useMemo(() => {
        if (!capture || !selectedResourceCategory || !selectedResourceId) return null;
        const record = resolveMapToRecord(
            capture.resources[selectedResourceCategory] as Map<string, unknown>,
        );
        return record[selectedResourceId] ?? null;
    }, [capture, selectedResourceCategory, selectedResourceId]);

    const usageIndex = useMemo(() => {
        if (!capture) return new Map<string, never[]>();
        return buildUsageIndex(capture);
    }, [capture]);

    if (loading) {
        return <div className="loading">Loading capture…</div>;
    }

    if (error || !capture) {
        return <div className="error">{error ?? 'Unknown error'}</div>;
    }

    // Build breadcrumb
    const breadcrumb = sidebarMode === 'resources'
        ? buildResourceBreadcrumb(selectedResourceCategory, selectedResourceId)
        : buildCommandBreadcrumb(selectedNode);

    return (
        <NavigationContext.Provider value={navigateToResource}>
            <div className="result-app">
                <CaptureHeader capture={capture} />
                <div className="result-content">
                    <div className="left-panel" style={{ width: leftPanelWidth }}>
                        <SidebarPanel
                            capture={capture}
                            mode={sidebarMode}
                            onModeChange={handleModeChange}
                            selectedCommandId={selectedNode?.id ?? null}
                            onSelectCommand={handleSelectCommand}
                            selectedResourceCategory={selectedResourceCategory}
                            selectedResourceId={selectedResourceId}
                            onSelectResource={handleSelectResource}
                        />
                    </div>
                    <DraggableDivider onDrag={handleDividerDrag} />
                    <div className="right-panel">
                        <div className="breadcrumb">
                            {breadcrumb}
                        </div>
                        {sidebarMode === 'commands' ? (
                            <>
                                <div className="tab-bar">
                                    <TabButton label="Details"  tab="detail"   active={activeTab} onClick={handleTabChange} />
                                    <TabButton label="Shaders"  tab="shader"   active={activeTab} onClick={handleTabChange} />
                                    <TabButton label="Pipeline" tab="pipeline" active={activeTab} onClick={handleTabChange} />
                                </div>
                                <div className="tab-content">
                                    {activeTab === 'detail'   && <CommandDetail node={selectedNode} capture={capture} />}
                                    {activeTab === 'shader'   && <ShaderEditor node={selectedNode} capture={capture} />}
                                    {activeTab === 'pipeline' && <PipelineInspector node={selectedNode} capture={capture} />}
                                </div>
                            </>
                        ) : (
                            <div className="tab-content">
                                <ResourceDetail
                                    category={selectedResourceCategory ?? ''}
                                    resource={selectedResource}
                                    capture={capture}
                                    usageIndex={usageIndex}
                                    resourceId={selectedResourceId}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </NavigationContext.Provider>
    );
}

// ── Breadcrumb helpers ────────────────────────────────────────────────

function buildCommandBreadcrumb(node: ICommandNode | null): React.ReactNode {
    if (!node) {
        return <span className="crumb-active">Commands</span>;
    }
    // Walk up the command path — for now we just show the node name since
    // we don't have easy access to the full parent chain in the flat state.
    return (
        <>
            <span>Commands</span>
            <span className="sep">›</span>
            <span className="crumb-active">{node.name}</span>
        </>
    );
}

function buildResourceBreadcrumb(
    category: ResourceCategory | null,
    id: string | null,
): React.ReactNode {
    if (!category) {
        return <span className="crumb-active">Resources</span>;
    }
    if (!id) {
        return (
            <>
                <span>Resources</span>
                <span className="sep">›</span>
                <span className="crumb-active">{CATEGORY_LABELS[category]}</span>
            </>
        );
    }
    return (
        <>
            <span>Resources</span>
            <span className="sep">›</span>
            <span>{CATEGORY_LABELS[category]}</span>
            <span className="sep">›</span>
            <span className="crumb-active">{id}</span>
        </>
    );
}

// ── Tab button ────────────────────────────────────────────────────────

function TabButton({ label, tab, active, onClick }: {
    label: string;
    tab: CommandTab;
    active: CommandTab;
    onClick: (t: CommandTab) => void;
}) {
    const handleClick = useCallback(() => onClick(tab), [onClick, tab]);
    return (
        <button className={active === tab ? 'active' : ''} onClick={handleClick}>
            {label}
        </button>
    );
}
