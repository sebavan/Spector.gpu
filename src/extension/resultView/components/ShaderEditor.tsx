import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { ICommandNode, ICapture, IShaderModuleInfo, IRenderPipelineInfo, IComputePipelineInfo } from '@shared/types';
import { resolveMapEntry } from '../resourceMapHelpers';
import { highlightWGSL } from './wgslHighlighter';
import { ResourceLink } from './ResourceLink';

// ── Types ──────────────────────────────────────────────────────────────

interface ShaderEditorProps {
    node: ICommandNode | null;
    capture: ICapture;
}

interface ShaderData {
    label: string;
    code: string;
    moduleId: string;
}

// ── Single shader pane (editor + gutter + toolbar) ─────────────────────

interface ShaderPaneProps {
    shader: ShaderData;
}

function ShaderPane({ shader }: ShaderPaneProps) {
    const [code, setCode] = useState(shader.code);
    const [editing, setEditing] = useState(false);
    const [cursorLine, setCursorLine] = useState(0);
    const [copyLabel, setCopyLabel] = useState('Copy');

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const preRef = useRef<HTMLPreElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);

    // Reset state when the underlying shader changes (e.g. user selects a
    // different draw call).
    const originalCode = shader.code;
    useEffect(() => {
        setCode(originalCode);
        setEditing(false);
        setCursorLine(0);
    }, [originalCode]);

    const modified = code !== originalCode;

    // ── Highlighted HTML (memoised — only recomputes when code changes) ─
    const highlighted = useMemo(() => highlightWGSL(code), [code]);

    // ── Line count (avoid re-splitting the whole string just to count) ──
    const lineCount = useMemo(() => {
        let n = 1;
        for (let i = 0; i < code.length; i++) {
            if (code[i] === '\n') n++;
        }
        return n;
    }, [code]);

    // ── Scroll sync ────────────────────────────────────────────────────
    const handleScroll = useCallback(() => {
        const ta = textareaRef.current;
        const pre = preRef.current;
        const gutter = gutterRef.current;
        if (!ta) return;
        if (pre) {
            pre.scrollTop = ta.scrollTop;
            pre.scrollLeft = ta.scrollLeft;
        }
        if (gutter) {
            gutter.scrollTop = ta.scrollTop;
        }
    }, []);

    // ── Cursor tracking (for current-line highlight) ───────────────────
    const updateCursorLine = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const pos = ta.selectionStart;
        let line = 0;
        for (let i = 0; i < pos && i < ta.value.length; i++) {
            if (ta.value[i] === '\n') line++;
        }
        setCursorLine(line);
    }, []);

    // ── Change handler ─────────────────────────────────────────────────
    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setCode(e.target.value);
    }, []);

    // ── Key handler (Tab → 4 spaces, Enter → auto-indent) ─────────────
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ta = e.currentTarget;

        if (e.key === 'Tab') {
            e.preventDefault();
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const val = ta.value;
            const updated = val.substring(0, start) + '    ' + val.substring(end);
            setCode(updated);
            // Restore cursor position after React re-render.
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + 4;
            });
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const val = ta.value;

            // Find the start of the current line.
            let lineStart = start;
            while (lineStart > 0 && val[lineStart - 1] !== '\n') lineStart--;

            // Measure leading whitespace.
            let indent = '';
            let k = lineStart;
            while (k < val.length && (val[k] === ' ' || val[k] === '\t')) {
                indent += val[k];
                k++;
            }

            const insertion = '\n' + indent;
            const updated = val.substring(0, start) + insertion + val.substring(end);
            setCode(updated);
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + insertion.length;
            });
        }
    }, []);

    // ── Toolbar actions ────────────────────────────────────────────────
    const toggleEdit = useCallback(() => {
        setEditing(prev => !prev);
    }, []);

    const handleRevert = useCallback(() => {
        setCode(originalCode);
    }, [originalCode]);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopyLabel('Copied!');
            setTimeout(() => setCopyLabel('Copy'), 1500);
        } catch {
            // Fallback for environments without clipboard API.
            setCopyLabel('Failed');
            setTimeout(() => setCopyLabel('Copy'), 1500);
        }
    }, [code]);

    // ── Render ──────────────────────────────────────────────────────────
    return (
        <div className="shader-section">
            <h4>
                {shader.label} (<ResourceLink id={shader.moduleId} />)
                {modified && <span className="modified-indicator" title="Modified"> •</span>}
            </h4>

            {/* Toolbar */}
            <div className="shader-editor-toolbar">
                <button
                    className={editing ? 'toolbar-btn active' : 'toolbar-btn'}
                    onClick={toggleEdit}
                    data-testid="edit-toggle"
                >
                    {editing ? 'Read-only' : 'Edit'}
                </button>
                {editing && modified && (
                    <button className="toolbar-btn" onClick={handleRevert} data-testid="revert-btn">
                        Revert
                    </button>
                )}
                <button className="toolbar-btn" onClick={handleCopy} data-testid="copy-btn">
                    {copyLabel}
                </button>
            </div>

            {/* Editor container */}
            <div className={`editor-container${editing ? ' editing' : ''}`}>
                {/* Gutter */}
                <div className="line-numbers" ref={gutterRef} aria-hidden="true">
                    {Array.from({ length: lineCount }, (_, idx) => (
                        <div
                            key={idx}
                            className={idx === cursorLine ? 'line-number current' : 'line-number'}
                        >
                            {idx + 1}
                        </div>
                    ))}
                </div>

                {/* Code layers */}
                <div className="editor-layers">
                    {/* Highlighted pre layer (visual) */}
                    <pre
                        ref={preRef}
                        className="editor-highlight"
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
                    />

                    {/* Textarea overlay (interactive) */}
                    <textarea
                        ref={textareaRef}
                        className="editor-textarea"
                        value={code}
                        onChange={handleChange}
                        onScroll={handleScroll}
                        onKeyDown={handleKeyDown}
                        onKeyUp={updateCursorLine}
                        onClick={updateCursorLine}
                        readOnly={!editing}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        data-testid="shader-textarea"
                    />
                </div>
            </div>
        </div>
    );
}

// ── Main exported component ────────────────────────────────────────────

export function ShaderEditor({ node, capture }: ShaderEditorProps) {
    const shaders = useMemo(() => {
        if (!node?.pipelineId) return null;

        const { resources } = capture;
        const pipeline: IRenderPipelineInfo | IComputePipelineInfo | undefined =
            resolveMapEntry(resources.renderPipelines, node.pipelineId) ??
            resolveMapEntry(resources.computePipelines, node.pipelineId);

        if (!pipeline) return null;

        const result: ShaderData[] = [];

        if ('vertex' in pipeline && pipeline.vertex) {
            const mod = resolveMapEntry<IShaderModuleInfo>(resources.shaderModules, pipeline.vertex.moduleId);
            if (mod) {
                result.push({
                    label: `Vertex Shader (${pipeline.vertex.entryPoint ?? 'main'})`,
                    code: mod.code,
                    moduleId: pipeline.vertex.moduleId,
                });
            }
        }
        if ('fragment' in pipeline && pipeline.fragment) {
            const mod = resolveMapEntry<IShaderModuleInfo>(resources.shaderModules, pipeline.fragment.moduleId);
            if (mod) {
                result.push({
                    label: `Fragment Shader (${pipeline.fragment.entryPoint ?? 'main'})`,
                    code: mod.code,
                    moduleId: pipeline.fragment.moduleId,
                });
            }
        }
        if ('compute' in pipeline && pipeline.compute) {
            const mod = resolveMapEntry<IShaderModuleInfo>(resources.shaderModules, pipeline.compute.moduleId);
            if (mod) {
                result.push({
                    label: `Compute Shader (${pipeline.compute.entryPoint ?? 'main'})`,
                    code: mod.code,
                    moduleId: pipeline.compute.moduleId,
                });
            }
        }

        return result.length > 0 ? result : null;
    }, [node, capture]);

    if (!shaders) {
        return (
            <div className="shader-editor empty">
                {node ? 'No shader associated with this command' : 'Select a draw/dispatch call to view shaders'}
            </div>
        );
    }

    return (
        <div className="shader-editor">
            {shaders.map((shader, i) => (
                <ShaderPane key={shader.moduleId + i} shader={shader} />
            ))}
        </div>
    );
}
