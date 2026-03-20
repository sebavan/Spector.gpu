// Generate solid-color PNG icons for the Spector.GPU Chrome extension.
// Usage: node tools/generate-icons.js
//
// Produces valid PNG files using only Node.js builtins (no dependencies).
// Color: #2196F3 (Material Blue 500) — the Spector.GPU brand blue.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── CRC-32 (ISO 3309 / PNG spec) ──────────────────────────────────────────────
// Pre-compute the lookup table once; reuse for every chunk.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[n] = c;
}

/** @param {Buffer} buf */
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk builder ──────────────────────────────────────────────────────────
/** @param {string} type  4-char ASCII chunk type
 *  @param {Buffer} data  chunk payload */
function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);

    return Buffer.concat([len, typeAndData, crcBuf]);
}

// ── Solid-color PNG generator ──────────────────────────────────────────────────
/**
 * Create a minimal, spec-compliant RGB PNG of a solid color.
 * @param {number} size  Width & height in pixels.
 * @param {number} r     Red   (0-255).
 * @param {number} g     Green (0-255).
 * @param {number} b     Blue  (0-255).
 * @returns {Buffer}
 */
function createSolidPNG(size, r, g, b) {
    // PNG signature (8 bytes, immutable).
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR: width(4) + height(4) + bitDepth(1) + colorType(1) +
    //       compression(1) + filter(1) + interlace(1) = 13 bytes.
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);  // width
    ihdr.writeUInt32BE(size, 4);  // height
    ihdr[8]  = 8;                 // 8 bits per channel
    ihdr[9]  = 2;                 // RGB truecolor
    ihdr[10] = 0;                 // deflate
    ihdr[11] = 0;                 // adaptive filtering
    ihdr[12] = 0;                 // no interlace

    // Raw image data: filter_byte(1) + R,G,B * width  per row.
    const rowBytes = 1 + size * 3;
    const raw = Buffer.alloc(rowBytes * size);
    for (let y = 0; y < size; y++) {
        const rowOff = y * rowBytes;
        raw[rowOff] = 0; // filter: None
        for (let x = 0; x < size; x++) {
            const px = rowOff + 1 + x * 3;
            raw[px]     = r;
            raw[px + 1] = g;
            raw[px + 2] = b;
        }
    }

    const compressed = zlib.deflateSync(raw, { level: 9 });

    return Buffer.concat([
        signature,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', compressed),
        makeChunk('IEND', Buffer.alloc(0)),
    ]);
}

// ── Main ───────────────────────────────────────────────────────────────────────
const iconsDir = path.resolve(__dirname, '..', 'src', 'extension', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const SIZES = [16, 48, 128];
const R = 0x21, G = 0x96, B = 0xF3; // #2196F3

for (const size of SIZES) {
    const png = createSolidPNG(size, R, G, B);
    const outPath = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`  icon${size}.png  ${png.length} bytes`);
}

console.log('Done.');
