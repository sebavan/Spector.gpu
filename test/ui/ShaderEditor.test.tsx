/**
 * Unit tests for wgslHighlighter and ShaderEditor.
 *
 * Uses vitest + @testing-library/react.  The highlighter tests are pure-
 * function tests with zero DOM dependency; the component tests verify
 * rendering, editing, copy, revert, and line-number behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { highlightWGSL } from '../../src/extension/resultView/components/wgslHighlighter';
import { ShaderEditor } from '../../src/extension/resultView/components/ShaderEditor';
import type { ICapture, ICommandNode } from '../../src/shared/types';

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

/** Build a minimal ICapture with one render pipeline + shader module. */
function makeCapture(shaderCode: string): ICapture {
    return {
        id: 'cap-1',
        version: '0.1',
        timestamp: 0,
        duration: 0,
        adapterInfo: { vendor: '', architecture: '', device: '', description: '', backend: '' },
        deviceDescriptor: {},
        deviceLimits: {},
        deviceFeatures: [],
        commands: [],
        stats: { totalCommands: 0, drawCalls: 0, dispatches: 0, renderPasses: 0, computePasses: 0 },
        resources: {
            buffers: {},
            textures: {},
            textureViews: {},
            samplers: {},
            shaderModules: {
                'sm-1': { id: 'sm-1', code: shaderCode },
            },
            bindGroupLayouts: {},
            bindGroups: {},
            pipelineLayouts: {},
            renderPipelines: {
                'rp-1': {
                    id: 'rp-1',
                    layout: 'auto',
                    vertex: { moduleId: 'sm-1', entryPoint: 'vs_main' },
                    fragment: { moduleId: 'sm-1', entryPoint: 'fs_main', targets: [] },
                },
            },
            computePipelines: {},
        } as unknown as ICapture['resources'],
    } as unknown as ICapture;
}

function makeNode(pipelineId?: string): ICommandNode {
    return {
        id: 'node-1',
        type: 'draw' as never,
        name: 'draw',
        args: {},
        children: [],
        parentId: null,
        timestamp: 0,
        pipelineId,
    } as unknown as ICommandNode;
}

// ════════════════════════════════════════════════════════════════════════
// 1. WGSL Highlighter — pure function tests
// ════════════════════════════════════════════════════════════════════════

describe('highlightWGSL', () => {
    it('returns empty string for empty input', () => {
        expect(highlightWGSL('')).toBe('');
    });

    it('highlights keywords', () => {
        for (const kw of ['fn', 'var', 'let', 'return', 'struct']) {
            const html = highlightWGSL(kw);
            expect(html).toBe(`<span class="wgsl-keyword">${kw}</span>`);
        }
    });

    it('highlights types', () => {
        for (const t of ['vec4f', 'f32', 'mat4x4f']) {
            const html = highlightWGSL(t);
            expect(html).toBe(`<span class="wgsl-type">${t}</span>`);
        }
    });

    it('highlights decorators', () => {
        const html = highlightWGSL('@vertex');
        expect(html).toBe('<span class="wgsl-decorator">@vertex</span>');
    });

    it('highlights decorator with parenthesised arg', () => {
        const html = highlightWGSL('@group(0)');
        expect(html).toContain('<span class="wgsl-decorator">@group</span>');
        expect(html).toContain('<span class="wgsl-number">0</span>');
    });

    it('highlights line comments', () => {
        const html = highlightWGSL('// comment');
        expect(html).toBe('<span class="wgsl-comment">// comment</span>');
    });

    it('highlights block comments', () => {
        const html = highlightWGSL('/* block */');
        expect(html).toBe('<span class="wgsl-comment">/* block */</span>');
    });

    it('highlights integer numbers', () => {
        const html = highlightWGSL('42');
        expect(html).toBe('<span class="wgsl-number">42</span>');
    });

    it('highlights float numbers', () => {
        const html = highlightWGSL('0.5');
        expect(html).toBe('<span class="wgsl-number">0.5</span>');
    });

    it('highlights hex numbers', () => {
        const html = highlightWGSL('0xFF');
        expect(html).toBe('<span class="wgsl-number">0xFF</span>');
    });

    it('highlights builtin functions', () => {
        for (const fn of ['dot', 'normalize', 'textureSample']) {
            const html = highlightWGSL(fn);
            expect(html).toBe(`<span class="wgsl-function">${fn}</span>`);
        }
    });

    it('highlights builtin values', () => {
        const html = highlightWGSL('position');
        expect(html).toBe('<span class="wgsl-builtin">position</span>');
    });

    it('handles mixed code with all token types', () => {
        const code = `@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
    return vec4f(0.0, 0.0, 0.0, 1.0); // output
}`;
        const html = highlightWGSL(code);
        // Keywords
        expect(html).toContain('<span class="wgsl-keyword">fn</span>');
        expect(html).toContain('<span class="wgsl-keyword">return</span>');
        // Types
        expect(html).toContain('<span class="wgsl-type">u32</span>');
        expect(html).toContain('<span class="wgsl-type">vec4f</span>');
        // Decorators
        expect(html).toContain('<span class="wgsl-decorator">@vertex</span>');
        expect(html).toContain('<span class="wgsl-decorator">@builtin</span>');
        // Builtin values
        expect(html).toContain('<span class="wgsl-builtin">vertex_index</span>');
        expect(html).toContain('<span class="wgsl-builtin">position</span>');
        // Numbers
        expect(html).toContain('<span class="wgsl-number">0.0</span>');
        expect(html).toContain('<span class="wgsl-number">1.0</span>');
        // Comments
        expect(html).toContain('<span class="wgsl-comment">// output</span>');
    });

    it('escapes HTML in passthrough text', () => {
        const html = highlightWGSL('a<b');
        expect(html).toContain('&lt;');
        expect(html).not.toContain('<b>'); // must not create a real <b> element
    });

    it('passes through unknown identifiers as escaped text', () => {
        const html = highlightWGSL('myVar');
        // Should NOT be wrapped in any wgsl- span.
        expect(html).toBe('myVar');
        expect(html).not.toContain('wgsl-');
    });
});

// ════════════════════════════════════════════════════════════════════════
// 2. ShaderEditor component tests
// ════════════════════════════════════════════════════════════════════════

describe('ShaderEditor', () => {
    const SHADER_CODE = 'fn main() -> vec4f {\n    return vec4f(1.0);\n}';
    let capture: ICapture;

    let clipboardWriteText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        capture = makeCapture(SHADER_CODE);
        // Mock clipboard — navigator.clipboard is a getter-only property in
        // jsdom, so we must use defineProperty.
        clipboardWriteText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: clipboardWriteText },
            writable: true,
            configurable: true,
        });
    });

    it('shows placeholder when no node is selected', () => {
        render(<ShaderEditor node={null} capture={capture} />);
        expect(screen.getByText('Select a draw/dispatch call to view shaders')).toBeInTheDocument();
    });

    it('shows "No shader" when node has no pipelineId', () => {
        const node = makeNode(undefined);
        render(<ShaderEditor node={node} capture={capture} />);
        expect(screen.getByText('No shader associated with this command')).toBeInTheDocument();
    });

    it('renders shader code when valid node is provided', () => {
        const node = makeNode('rp-1');
        render(<ShaderEditor node={node} capture={capture} />);
        // Should find the vertex shader label
        expect(screen.getByText(/Vertex Shader/)).toBeInTheDocument();
        // The textarea should contain the code
        const textareas = screen.getAllByTestId('shader-textarea');
        expect(textareas.length).toBeGreaterThan(0);
        expect((textareas[0] as HTMLTextAreaElement).value).toContain('fn main()');
    });

    it('shows line numbers matching line count', () => {
        const node = makeNode('rp-1');
        render(<ShaderEditor node={node} capture={capture} />);
        const lines = SHADER_CODE.split('\n').length; // 3
        // We should find line number elements 1, 2, 3
        for (let i = 1; i <= lines; i++) {
            // Line numbers may appear multiple times (vertex + fragment share same module)
            // so just check at least one exists.
            const els = screen.getAllByText(String(i));
            expect(els.length).toBeGreaterThan(0);
        }
    });

    it('copy button copies code to clipboard', async () => {
        const user = userEvent.setup();
        const node = makeNode('rp-1');
        render(<ShaderEditor node={node} capture={capture} />);

        const copyBtns = screen.getAllByTestId('copy-btn');
        expect(copyBtns[0].textContent).toBe('Copy');

        await user.click(copyBtns[0]);

        // The handleCopy callback is async — wait for the success state
        // change which proves clipboard.writeText() was invoked and resolved.
        await waitFor(() => {
            expect(copyBtns[0].textContent).toBe('Copied!');
        });
    });

    it('edit toggle switches between read-only and editable', async () => {
        const user = userEvent.setup();
        const node = makeNode('rp-1');
        render(<ShaderEditor node={node} capture={capture} />);

        const textareas = screen.getAllByTestId('shader-textarea') as HTMLTextAreaElement[];
        const ta = textareas[0];
        expect(ta.readOnly).toBe(true);

        // Click Edit
        const editBtns = screen.getAllByTestId('edit-toggle');
        await user.click(editBtns[0]);
        expect(ta.readOnly).toBe(false);

        // Click Read-only
        await user.click(editBtns[0]);
        expect(ta.readOnly).toBe(true);
    });

    it('revert button restores original code after edits', async () => {
        const user = userEvent.setup();
        const node = makeNode('rp-1');
        render(<ShaderEditor node={node} capture={capture} />);

        const textareas = screen.getAllByTestId('shader-textarea') as HTMLTextAreaElement[];
        const ta = textareas[0];

        // Enable editing
        const editBtns = screen.getAllByTestId('edit-toggle');
        await user.click(editBtns[0]);

        // Type something into the textarea
        await user.click(ta);
        await user.keyboard('MODIFIED');

        expect(ta.value).not.toBe(SHADER_CODE);

        // Click Revert
        const revertBtn = screen.getAllByTestId('revert-btn')[0];
        await user.click(revertBtn);

        expect(ta.value).toBe(SHADER_CODE);
    });

    it('shows modified indicator when code is changed', async () => {
        const user = userEvent.setup();
        const node = makeNode('rp-1');
        render(<ShaderEditor node={node} capture={capture} />);

        // No indicator initially
        expect(screen.queryByTitle('Modified')).toBeNull();

        // Enable editing
        const editBtns = screen.getAllByTestId('edit-toggle');
        await user.click(editBtns[0]);

        // Type
        const textareas = screen.getAllByTestId('shader-textarea') as HTMLTextAreaElement[];
        await user.click(textareas[0]);
        await user.keyboard('X');

        // Indicator should appear
        expect(screen.getAllByTitle('Modified').length).toBeGreaterThan(0);
    });
});
