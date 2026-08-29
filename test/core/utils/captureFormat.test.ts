import { describe, expect, it } from 'vitest';
import { CAPTURE_FORMAT_VERSION } from '../../../src/shared/constants';
import { normalizeCapture } from '../../../src/shared/utils/captureFormat';

function capture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'capture_1',
        formatVersion: CAPTURE_FORMAT_VERSION,
        version: '1.0.0',
        timestamp: 1,
        duration: 2,
        adapterInfo: {},
        deviceDescriptor: {},
        deviceLimits: {},
        deviceFeatures: [],
        commands: [],
        resources: {},
        stats: {},
        ...overrides,
    };
}

describe('normalizeCapture', () => {
    it('accepts the current capture format', () => {
        expect(normalizeCapture(capture()).formatVersion).toBe(CAPTURE_FORMAT_VERSION);
    });

    it('upgrades compatible pre-1.0 captures in memory', () => {
        const legacy = capture({ version: '0.5.1', formatVersion: undefined });
        expect(normalizeCapture(legacy).formatVersion).toBe(CAPTURE_FORMAT_VERSION);
    });

    it('rejects future capture formats', () => {
        expect(() => normalizeCapture(capture({ formatVersion: 2 })))
            .toThrow('Unsupported capture format 2');
    });

    it('rejects malformed captures', () => {
        expect(() => normalizeCapture({ formatVersion: 1 }))
            .toThrow('required top-level fields');
    });
});
