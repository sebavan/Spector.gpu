/**
 * Unit tests for the UsedBySection component.
 *
 * Verifies that buffer (and other resource) "Used By" entries render
 * correctly with both resource links and command links.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Stub NavigationContext dependencies — we only need the text output.
vi.mock('../../src/extension/resultView/components/ResourceLink', () => ({
    ResourceLink: ({ id }: { id: string }) => <span data-testid={`res-${id}`}>{id}</span>,
    CommandLink: ({ id, label }: { id: string; label: string }) => (
        <span data-testid={`cmd-${id}`}>{label}</span>
    ),
}));

import { UsedBySection } from '../../src/extension/resultView/components/ResourceDetail';
import type { UsageEntry } from '../../src/extension/resultView/usageIndex';

describe('UsedBySection', () => {
    it('renders nothing when no usages exist for the resource', () => {
        const index = new Map<string, UsageEntry[]>();
        const { container } = render(
            <UsedBySection resourceId="buf_0" usageIndex={index} />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders command links for buffer used by commands', () => {
        const index = new Map<string, UsageEntry[]>([
            ['buf_0', [
                { id: 'cmd_1', label: 'draw', type: 'command' },
                { id: 'cmd_2', label: 'queue.writeBuffer', type: 'command' },
            ]],
        ]);
        const { getByTestId, getByText } = render(
            <UsedBySection resourceId="buf_0" usageIndex={index} />,
        );

        expect(getByText('Used By')).toBeTruthy();
        expect(getByTestId('cmd-cmd_1').textContent).toBe('draw');
        expect(getByTestId('cmd-cmd_2').textContent).toBe('queue.writeBuffer');
    });

    it('renders resource links for buffer used by bind groups', () => {
        const index = new Map<string, UsageEntry[]>([
            ['buf_0', [
                { id: 'bg_0', label: 'Bind Group bg_0 [binding 0]', type: 'resource' },
            ]],
        ]);
        const { getByTestId, getByText } = render(
            <UsedBySection resourceId="buf_0" usageIndex={index} />,
        );

        expect(getByText('Used By')).toBeTruthy();
        expect(getByTestId('res-bg_0').textContent).toBe('bg_0');
        expect(getByText('Bind Group bg_0 [binding 0]')).toBeTruthy();
    });

    it('renders both resource and command links together', () => {
        const index = new Map<string, UsageEntry[]>([
            ['buf_1', [
                { id: 'bg_0', label: 'Bind Group bg_0 [binding 0]', type: 'resource' },
                { id: 'cmd_3', label: 'drawIndexed', type: 'command' },
                { id: 'cmd_4', label: 'queue.writeBuffer', type: 'command' },
            ]],
        ]);
        const { container, getByTestId } = render(
            <UsedBySection resourceId="buf_1" usageIndex={index} />,
        );

        // Resources rendered first, then commands
        const items = container.querySelectorAll('.used-by-item');
        expect(items).toHaveLength(3);

        expect(getByTestId('res-bg_0')).toBeTruthy();
        expect(getByTestId('cmd-cmd_3')).toBeTruthy();
        expect(getByTestId('cmd-cmd_4')).toBeTruthy();
    });
});
