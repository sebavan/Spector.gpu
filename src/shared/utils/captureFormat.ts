import { CAPTURE_FORMAT_VERSION } from '../constants';
import type { ICapture } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize serialized capture data for the current reader.
 *
 * Captures produced before 1.0 did not include `formatVersion`; their
 * top-level shape is compatible with format 1, so they are upgraded in
 * memory. Future format versions fail explicitly rather than rendering
 * potentially misleading data.
 */
export function normalizeCapture(value: unknown): ICapture {
    if (!isRecord(value)) {
        throw new Error('Invalid capture: expected an object');
    }

    let formatVersion = value.formatVersion;
    if (formatVersion === undefined) {
        if (typeof value.version !== 'string' || !value.version.startsWith('0.')) {
            throw new Error('Invalid capture: missing formatVersion');
        }
        formatVersion = CAPTURE_FORMAT_VERSION;
    }

    if (!Number.isInteger(formatVersion) || (formatVersion as number) < 1) {
        throw new Error('Invalid capture: formatVersion must be a positive integer');
    }
    if ((formatVersion as number) > CAPTURE_FORMAT_VERSION) {
        throw new Error(
            `Unsupported capture format ${formatVersion}; ` +
            `this build supports up to ${CAPTURE_FORMAT_VERSION}`,
        );
    }

    const valid =
        typeof value.id === 'string' &&
        typeof value.version === 'string' &&
        typeof value.timestamp === 'number' &&
        Number.isFinite(value.timestamp) &&
        typeof value.duration === 'number' &&
        Number.isFinite(value.duration) &&
        isRecord(value.adapterInfo) &&
        isRecord(value.deviceDescriptor) &&
        isRecord(value.deviceLimits) &&
        Array.isArray(value.deviceFeatures) &&
        Array.isArray(value.commands) &&
        isRecord(value.resources) &&
        isRecord(value.stats);

    if (!valid) {
        throw new Error('Invalid capture: required top-level fields are missing');
    }

    return {
        ...value,
        formatVersion: formatVersion as number,
    } as unknown as ICapture;
}
