import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ICapture } from '../../src/shared/types';
import { deleteCapture, readCapture } from '../../src/shared/utils/captureStorage';

vi.mock('../../src/shared/utils/captureStorage', () => ({
    deleteCapture: vi.fn(),
    readCapture: vi.fn(),
}));
vi.mock('../../src/extension/resultView/components/CommandDetail', () => ({
    CommandDetail: () => <div />,
}));
vi.mock('../../src/extension/resultView/components/ShaderEditor', () => ({
    ShaderEditor: () => <div />,
}));
vi.mock('../../src/extension/resultView/components/PipelineInspector', () => ({
    PipelineInspector: () => <div />,
}));
vi.mock('../../src/extension/resultView/components/SidebarPanel', () => ({
    SidebarPanel: () => <div />,
}));
vi.mock('../../src/extension/resultView/components/DraggableDivider', () => ({
    DraggableDivider: () => <div />,
}));
vi.mock('../../src/extension/resultView/components/ResourceDetail', () => ({
    ResourceDetail: () => <div />,
}));

import { ResultApp } from '../../src/extension/resultView/components/ResultApp';

const capture = {
    id: 'internal_capture_id',
    formatVersion: 1,
    version: '1.0.0',
    timestamp: 1,
    duration: 1,
    adapterInfo: { vendor: '', architecture: '', device: '', description: '', backend: '' },
    deviceDescriptor: {},
    deviceLimits: {},
    deviceFeatures: [],
    commands: [],
    resources: {
        buffers: {},
        textures: {},
        textureViews: {},
        samplers: {},
        shaderModules: {},
        renderPipelines: {},
        computePipelines: {},
        bindGroups: {},
        bindGroupLayouts: {},
    },
    stats: {
        totalCommands: 0,
        drawCalls: 0,
        dispatchCalls: 0,
        renderPasses: 0,
        computePasses: 0,
        pipelineCount: 0,
        bufferCount: 0,
        textureCount: 0,
        shaderModuleCount: 0,
        bindGroupCount: 0,
    },
} as unknown as ICapture;

describe('ResultApp capture retention', () => {
    beforeEach(() => {
        vi.mocked(readCapture).mockResolvedValue(capture);
        vi.mocked(deleteCapture).mockResolvedValue();
        window.history.replaceState({}, '', '?captureId=storage_capture_id');
    });

    it('deletes the storage key from the result URL', async () => {
        const { findByRole, getByRole } = render(<ResultApp />);

        fireEvent.click(await findByRole('button', { name: 'Delete stored capture' }));
        fireEvent.click(getByRole('button', { name: 'Confirm delete' }));

        await waitFor(() => {
            expect(deleteCapture).toHaveBeenCalledWith('storage_capture_id');
        });
    });
});
