import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { CaptureHeader } from '../../src/extension/resultView/components/CaptureHeader';
import type { ICapture } from '../../src/shared/types';

const capture = {
    duration: 12.5,
    adapterInfo: { description: 'Test GPU' },
    stats: {
        totalCommands: 5,
        drawCalls: 1,
        dispatchCalls: 0,
        renderPasses: 1,
        computePasses: 0,
        pipelineCount: 1,
        bufferCount: 2,
        textureCount: 1,
    },
} as ICapture;

describe('CaptureHeader', () => {
    it('requires confirmation before deleting a stored capture', async () => {
        const onDelete = vi.fn().mockResolvedValue(undefined);
        const { getByRole } = render(
            <CaptureHeader capture={capture} deleting={false} onDelete={onDelete} />,
        );

        fireEvent.click(getByRole('button', { name: 'Delete stored capture' }));
        expect(onDelete).not.toHaveBeenCalled();

        fireEvent.click(getByRole('button', { name: 'Confirm delete' }));
        await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    });
});
