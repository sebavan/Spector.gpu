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

    // ── Circular reference detection (PR #11 bug) ──────────────────

    it('handles circular references without crashing', () => {
        const obj: any = { a: 1 };
        obj.self = obj; // circular!

        // Must NOT throw or infinite-loop
        expect(() => {
            render(<JsonTree data={obj} />);
        }).not.toThrow();
    });

    it('shows [Circular] marker for circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;

        const { container } = render(<JsonTree data={obj} />);
        expect(container.textContent).toContain('[Circular]');
    });

    it('handles mutual circular references', () => {
        const a: any = { name: 'a' };
        const b: any = { name: 'b' };
        a.ref = b;
        b.ref = a;

        expect(() => {
            render(<JsonTree data={a} />);
        }).not.toThrow();

        const { container } = render(<JsonTree data={a} />);
        expect(container.textContent).toContain('[Circular]');
    });

    it('handles circular reference inside array', () => {
        const arr: any[] = [1, 2];
        arr.push(arr); // array references itself

        expect(() => {
            render(<JsonTree data={arr} />);
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
});
