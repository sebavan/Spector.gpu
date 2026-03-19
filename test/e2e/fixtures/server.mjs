/**
 * Minimal static file server for E2E test fixtures.
 *
 * Serves HTML files from this directory on the port specified by
 * the PORT environment variable (default 8765). Exits cleanly on
 * SIGTERM / SIGINT so Playwright's webServer teardown works.
 *
 * Zero external dependencies — uses only Node built-ins.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = parseInt(process.env.PORT || '8765', 10);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
    // Strip query string, default to index.html
    const urlPath = (req.url || '/').split('?')[0];
    const filePath = join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

    // Security: reject path traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const data = await readFile(filePath);
        const ext = extname(filePath);
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    // Playwright's webServer waits for this line (url match on port)
    console.log(`Fixture server listening on http://localhost:${PORT}`);
});

// Graceful shutdown
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        server.close();
        process.exit(0);
    });
}
