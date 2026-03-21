/**
 * Unit tests for the JsonTree component.
 *
 * Covers:
 * - Primitive rendering (null, undefined, boolean, number, string)
 * - Object/array rendering
 * - Circular reference detection (PR #11 fix)
 * - Deep nesting truncation at MAX_DEPTH
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Mock ResourceLink to avoid NavigationContext dependency.
// maybeResourceLink returns null for non-resource-ID strings,
// so this is a faithful mock for our test inputs.
vi.mock('../../src/extension/resultView/components/ResourceLink', () => ({
    maybeResourceLink: () => null,
}));

import { JsonTree } from '../../src/extension/resultView/components/JsonTree';

describe('JsonTree', () => {
    it('renders primitive number values', () => {
        const { container } = render(<JsonTree data={42} />);
        expect(container.textContent).toContain('42');
    });

    it('renders null', () => {
        const { container } = render(<JsonTree data={null} />);
        expect(container.textContent).toContain('null');
    });

    it('renders undefined', () => {
        const { container } = render(<JsonTree data={undefined} />);
        expect(container.textContent).toContain('undefined');
    });

    it('renders boolean values', () => {
        const { container: cTrue } = render(<JsonTree data={true} />);
        expect(cTrue.textContent).toContain('true');

        const { container: cFalse } = render(<JsonTree data={false} />);
        expect(cFalse.textContent).toContain('false');
    });

    it('renders string values with quotes', () => {
        const { container } = render(<JsonTree data="hello" />);
        expect(container.textContent).toContain('"hello"');
    });

    it('renders objects with keys', () => {
        const { container } = render(<JsonTree data={{ a: 1, b: 'two' }} />);
        expect(container.textContent).toContain('a');
        expect(container.textContent).toContain('1');
    });

    it('renders arrays with element count', () => {
        const { container } = render(<JsonTree data={[1, 2, 3]} />);
        expect(container.textContent).toContain('Array[3]');
        expect(container.textContent).toContain('1');
        expect(container.textContent).toContain('3');
    });

    it('renders empty array as []', () => {
        const { container } = render(<JsonTree data={[]} />);
        expect(container.textContent).toContain('[]');
    });

    it('renders empty object as {}', () => {
        const { container } = render(<JsonTree data={{}} />);
        expect(container.textContent).toContain('{}');
    });

    // ── No false [Circular] markers ───────────────────────────────────
    // Capture data is serialized JSON — no actual circular refs.
    // The same-shaped objects at different tree positions must NOT
    // be marked as circular.

    it('does not show [Circular] for sibling objects with same shape', () => {
        const data = {
            a: { x: 1, y: 2 },
            b: { x: 1, y: 2 },
            c: { x: 1, y: 2 },
        };

        const { container } = render(<JsonTree data={data} />);
        expect(container.textContent).not.toContain('[Circular]');
        // All three objects should render their values
        expect(container.textContent).toContain('a');
        expect(container.textContent).toContain('b');
        expect(container.textContent).toContain('c');
    });

    it('does not show [Circular] for shared object references', () => {
        // Even if the SAME object appears in multiple places
        // (which can happen with in-memory capture data before serialization),
        // we should render it, relying on MAX_DEPTH for protection.
        const shared = { val: 42 };
        const data = { first: shared, second: shared, third: shared };

        const { container } = render(<JsonTree data={data} />);
        expect(container.textContent).not.toContain('[Circular]');
    });

    it('does not crash on deeply nested objects (MAX_DEPTH protection)', () => {
        // Build actual circular reference — should not infinite-loop
        // because MAX_DEPTH (10) limits recursion regardless
        const obj: any = { a: 1 };
        obj.self = obj;

        expect(() => {
            render(<JsonTree data={obj} />);
        }).not.toThrow();
    });

    // ── Depth truncation ────────────────────────────────────────────

    it('handles deeply nested objects up to MAX_DEPTH (10)', () => {
        let data: any = { value: 'leaf' };
        for (let i = 0; i < 15; i++) {
            data = { nested: data };
        }
        // Should render without crashing — truncates at depth 10
        expect(() => {
            render(<JsonTree data={data} />);
        }).not.toThrow();
    });

    it('shows truncation marker "…" beyond MAX_DEPTH', () => {
        // Render directly at depth > MAX_DEPTH (10) via the depth prop
        // to verify the component returns the truncation marker.
        const { container } = render(<JsonTree data={{ deep: true }} depth={11} />);
        expect(container.textContent).toContain('…');
    });

    // ── Resource ID auto-linking ────────────────────────────────────

    it('renders object keys with resource ID values (maybeResourceLink mock returns null)', () => {
        // With our mock, maybeResourceLink returns null so IDs render as strings.
        // This test verifies the ID values are still present in the output.
        const data = {
            pipelineId: 'rp_3',
            moduleId: 'shd_0',
            textureId: 'tex_1',
            plain: 'hello',
        };
        const { container } = render(<JsonTree data={data} />);
        expect(container.textContent).toContain('pipelineId');
        expect(container.textContent).toContain('rp_3');
        expect(container.textContent).toContain('moduleId');
        expect(container.textContent).toContain('shd_0');
        expect(container.textContent).toContain('textureId');
        expect(container.textContent).toContain('tex_1');
    });
});
