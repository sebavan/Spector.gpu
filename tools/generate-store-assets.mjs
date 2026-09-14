/**
 * Generate the Chrome Web Store image assets from repository sources.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'docs', 'chrome-web-store', 'assets');
const screenshotSource = path.join(root, 'docs', 'images', 'result-view.png');
const iconSource = path.join(root, 'src', 'extension', 'icons', 'icon128.png');

const palette = {
    background: '#0a0a0f',
    surface: '#111118',
    surfaceRaised: '#1a1a24',
    border: '#28283a',
    accent: '#4fc3f7',
    accentDark: '#2196f3',
    green: '#4caf50',
    orange: '#ff9800',
    purple: '#9c27b0',
};

function promoBackground(width, height, variant) {
    const columns = variant === 'small' ? 11 : 28;
    const rows = variant === 'small' ? 7 : 11;
    const grid = [];
    for (let column = 0; column <= columns; column++) {
        const x = Math.round((column / columns) * width);
        grid.push(`<path d="M${x} 0V${height}" />`);
    }
    for (let row = 0; row <= rows; row++) {
        const y = Math.round((row / rows) * height);
        grid.push(`<path d="M0 ${y}H${width}" />`);
    }

    return Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <radialGradient id="glow" cx="28%" cy="45%" r="75%">
                    <stop offset="0%" stop-color="${palette.accentDark}" stop-opacity=".38"/>
                    <stop offset="45%" stop-color="${palette.purple}" stop-opacity=".12"/>
                    <stop offset="100%" stop-color="${palette.background}" stop-opacity="0"/>
                </radialGradient>
                <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="${palette.accent}" stop-opacity=".9"/>
                    <stop offset="100%" stop-color="${palette.purple}" stop-opacity=".55"/>
                </linearGradient>
                <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="${variant === 'small' ? 9 : 18}"/>
                </filter>
            </defs>
            <rect width="100%" height="100%" fill="${palette.background}"/>
            <g stroke="${palette.border}" stroke-width="1" opacity=".36">${grid.join('')}</g>
            <rect width="100%" height="100%" fill="url(#glow)"/>
            <path d="M0 ${height * .82} L${width * .38} ${height * .42} L${width * .68} ${height * .7} L${width} ${height * .28}"
                  fill="none" stroke="url(#edge)" stroke-width="${variant === 'small' ? 2 : 4}" opacity=".62"/>
            <circle cx="${width * .23}" cy="${height * .48}" r="${variant === 'small' ? 74 : 150}"
                    fill="${palette.accentDark}" opacity=".18" filter="url(#softGlow)"/>
        </svg>
    `);
}

function smallInterfaceOverlay() {
    return Buffer.from(`
        <svg width="214" height="220" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="212" height="218" rx="2"
                  fill="${palette.surface}" stroke="${palette.border}" stroke-width="2"/>
            <rect x="14" y="16" width="78" height="7" rx="2" fill="${palette.accent}"/>
            <rect x="14" y="36" width="184" height="1" fill="${palette.border}"/>
            <rect x="14" y="52" width="72" height="154" rx="2" fill="${palette.surfaceRaised}"/>
            <rect x="26" y="66" width="46" height="6" rx="2" fill="${palette.green}"/>
            <rect x="34" y="85" width="34" height="5" rx="2" fill="${palette.accentDark}"/>
            <rect x="34" y="103" width="40" height="5" rx="2" fill="${palette.orange}"/>
            <rect x="98" y="52" width="100" height="88" rx="2" fill="${palette.surfaceRaised}"/>
            <path d="M120 122 L148 69 L176 122 Z" fill="${palette.accentDark}"/>
            <rect x="98" y="154" width="72" height="5" rx="2" fill="${palette.accent}"/>
            <rect x="98" y="170" width="100" height="4" rx="2" fill="${palette.border}"/>
            <rect x="98" y="184" width="82" height="4" rx="2" fill="${palette.border}"/>
            <rect x="98" y="198" width="91" height="4" rx="2" fill="${palette.border}"/>
        </svg>
    `);
}

await mkdir(outputDirectory, { recursive: true });

await sharp(iconSource)
    .resize(128, 128, { fit: 'contain' })
    .png()
    .toFile(path.join(outputDirectory, 'store-icon-128.png'));

await sharp(screenshotSource)
    .resize(1280, 800, { fit: 'fill' })
    .flatten({ background: palette.background })
    .png()
    .toFile(path.join(outputDirectory, 'screenshot-result-view-1280x800.png'));

await sharp(promoBackground(440, 280, 'small'))
    .composite([
        {
            input: await sharp(iconSource).resize(154, 154).png().toBuffer(),
            left: 30,
            top: 63,
        },
        {
            input: smallInterfaceOverlay(),
            left: 210,
            top: 30,
        },
    ])
    .png()
    .toFile(path.join(outputDirectory, 'promo-small-440x280.png'));

const screenshot = await readFile(screenshotSource);
await sharp(promoBackground(1400, 560, 'marquee'))
    .composite([
        {
            input: await sharp(iconSource).resize(280, 280).png().toBuffer(),
            left: 96,
            top: 140,
        },
        {
            input: await sharp(screenshot)
                .resize(880, 550, { fit: 'cover', position: 'left' })
                .modulate({ brightness: 1.03, saturation: 1.08 })
                .png()
                .toBuffer(),
            left: 500,
            top: 5,
        },
    ])
    .png()
    .toFile(path.join(outputDirectory, 'promo-marquee-1400x560.png'));

console.log(`Wrote Chrome Web Store assets to ${path.relative(root, outputDirectory)}`);
