/**
 * Build a reproducible Chrome Web Store upload ZIP from the production output.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFile,
    cp,
    mkdir,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(root, 'dist');
const outputDirectory = path.join(root, 'store-package');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(
    await readFile(path.join(distDirectory, 'manifest.json'), 'utf8'),
);

if (manifest.version !== packageJson.version) {
    throw new Error(
        `Version mismatch: package.json=${packageJson.version}, manifest=${manifest.version}`,
    );
}

await mkdir(outputDirectory, { recursive: true });
const archivePath = path.join(
    outputDirectory,
    `spector-gpu-chrome-web-store-v${manifest.version}.zip`,
);
await rm(archivePath, { force: true });

if (process.platform === 'win32') {
    execFileSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            [
                'Add-Type -AssemblyName System.IO.Compression.FileSystem',
                `[IO.Compression.ZipFile]::CreateFromDirectory('${distDirectory}', '${archivePath}', [IO.Compression.CompressionLevel]::Optimal, $false)`,
            ].join('; '),
        ],
        { stdio: 'inherit' },
    );
} else {
    execFileSync('zip', ['-q', '-r', archivePath, '.'], {
        cwd: distDirectory,
        stdio: 'inherit',
    });
}

const digest = createHash('sha256')
    .update(await readFile(archivePath))
    .digest('hex');

await writeFile(
    path.join(outputDirectory, 'SHA256SUMS.txt'),
    `${digest}  ${path.basename(archivePath)}\n`,
);
await cp(
    path.join(root, 'docs', 'chrome-web-store', 'assets'),
    path.join(outputDirectory, 'listing-assets'),
    { recursive: true },
);
await copyFile(
    path.join(root, 'docs', 'chrome-web-store', 'SUBMISSION-CHECKLIST.md'),
    path.join(outputDirectory, 'SUBMISSION-CHECKLIST.md'),
);
await copyFile(
    path.join(root, 'docs', 'chrome-web-store-listing.md'),
    path.join(outputDirectory, 'LISTING-COPY.md'),
);
await copyFile(
    path.join(root, 'PRIVACY.md'),
    path.join(outputDirectory, 'PRIVACY.md'),
);

console.log(`Wrote Chrome Web Store submission bundle to ${path.relative(root, outputDirectory)}`);
