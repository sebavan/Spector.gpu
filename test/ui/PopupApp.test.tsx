import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupApp } from '@extension/popup/components/PopupApp';
import { MessageType } from '@shared/types/messages';

describe('PopupApp', () => {
    const sendMessage = vi.fn();

    beforeEach(() => {
        sendMessage.mockReset();
        Object.defineProperty(globalThis, 'chrome', {
            configurable: true,
            value: {
                tabs: {
                    query: vi.fn((_query, callback) => callback([{ id: 42 }])),
                },
                runtime: {
                    sendMessage,
                },
            },
        });
        sendMessage.mockImplementation((message, callback) => {
            if (message.type === MessageType.STATUS_QUERY) {
                callback({
                    webgpuDetected: true,
                    adapterInfo: {
                        vendor: 'nvidia',
                        architecture: 'turing',
                        device: '',
                        description: 'WebGPU Adapter',
                        backend: 'd3d12',
                    },
                    isCapturing: false,
                });
            }
        });
    });

    it('discloses local capture data before capture starts', async () => {
        render(<PopupApp />);

        await screen.findByRole('button', { name: 'Capture Frame' });
        expect(
            screen.getByText(/stores WebGPU commands, shaders, GPU resource contents/i),
        ).toBeVisible();
        expect(screen.getByRole('link', { name: 'Privacy details' })).toHaveAttribute(
            'href',
            'https://github.com/sebavan/Spector.gpu/blob/main/PRIVACY.md',
        );
    });

    it('sends a capture request for the active tab', async () => {
        render(<PopupApp />);

        fireEvent.click(await screen.findByRole('button', { name: 'Capture Frame' }));

        await waitFor(() => {
            expect(sendMessage).toHaveBeenCalledWith({
                type: MessageType.CAPTURE_REQUEST,
                tabId: 42,
                payload: { quickCapture: false },
            });
        });
    });
});
