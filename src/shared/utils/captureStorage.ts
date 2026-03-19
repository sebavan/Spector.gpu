/**
 * Chrome extension storage helpers for capture data.
 *
 * Captures are stored as JSON strings in chrome.storage.local.
 * Large captures (> 4 MB) are split into indexed chunks to stay
 * within Chrome's per-item size limit.
 *
 * Layout:
 *   Small capture:  { [captureId]: jsonString }
 *   Large capture:  { [captureId + '_meta']: { chunks, totalSize },
 *                     [captureId + '_chunk_0']: str0,
 *                     [captureId + '_chunk_1']: str1, ... }
 */

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB

/**
 * Read a capture from chrome.storage.local.
 * Handles both direct and chunked storage transparently.
 * Returns the parsed capture object, or null if not found.
 */
export async function readCapture(captureId: string): Promise<unknown | null> {
    // Fast path: try direct (non-chunked) lookup first.
    const direct = await chrome.storage.local.get(captureId);
    if (direct[captureId]) {
        return JSON.parse(direct[captureId] as string);
    }

    // Slow path: chunked storage.
    const metaKey = `${captureId}_meta`;
    const meta = await chrome.storage.local.get(metaKey);
    const metaData = meta[metaKey] as { chunks: number; totalSize: number } | undefined;
    if (!metaData) return null;

    const chunkKeys: string[] = [];
    for (let i = 0; i < metaData.chunks; i++) {
        chunkKeys.push(`${captureId}_chunk_${i}`);
    }

    const chunks = await chrome.storage.local.get(chunkKeys);

    // Pre-allocate array and join once — avoids O(n²) string concat.
    const parts: string[] = [];
    for (let i = 0; i < chunkKeys.length; i++) {
        const chunk = chunks[chunkKeys[i]];
        if (typeof chunk !== 'string') {
            throw new Error(`Missing chunk ${i} for capture ${captureId}`);
        }
        parts.push(chunk);
    }

    return JSON.parse(parts.join(''));
}

/**
 * Write a capture JSON string to chrome.storage.local.
 * Automatically chunks if the string exceeds CHUNK_SIZE.
 */
export async function writeCapture(captureId: string, jsonStr: string): Promise<void> {
    if (jsonStr.length <= CHUNK_SIZE) {
        await chrome.storage.local.set({ [captureId]: jsonStr });
        return;
    }

    // Chunked storage for large captures.
    const totalChunks = Math.ceil(jsonStr.length / CHUNK_SIZE);
    const storageOps: Record<string, unknown> = {
        [`${captureId}_meta`]: { chunks: totalChunks, totalSize: jsonStr.length },
    };
    for (let i = 0; i < totalChunks; i++) {
        storageOps[`${captureId}_chunk_${i}`] = jsonStr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }
    await chrome.storage.local.set(storageOps);
}

/**
 * Delete a capture and all its chunks from storage.
 */
export async function deleteCapture(captureId: string): Promise<void> {
    const metaKey = `${captureId}_meta`;
    const meta = await chrome.storage.local.get(metaKey);
    const metaData = meta[metaKey] as { chunks: number } | undefined;

    const keys = [captureId, metaKey];
    if (metaData) {
        for (let i = 0; i < metaData.chunks; i++) {
            keys.push(`${captureId}_chunk_${i}`);
        }
    }
    await chrome.storage.local.remove(keys);
}
