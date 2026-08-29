import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

const rootPackage = await readJson('package.json');
const versionSources = new Map([
    ['package.json', rootPackage.version],
    ['plugin.json', (await readJson('plugin.json')).version],
    ['mcp/package.json', (await readJson('mcp/package.json')).version],
    ['src/extension/manifest.json', (await readJson('src/extension/manifest.json')).version],
]);

const constantsSource = await readFile(path.join(root, 'src/shared/constants.ts'), 'utf8');
const constantsMatch = constantsSource.match(/SPECTOR_GPU_VERSION = '([^']+)'/);
versionSources.set('src/shared/constants.ts', constantsMatch?.[1]);

const typesSpec = await readFile(path.join(root, 'spec/types.md'), 'utf8');
const typesSpecMatch = typesSpec.match(/SPECTOR_GPU_VERSION = '([^']+)'/);
versionSources.set('spec/types.md', typesSpecMatch?.[1]);

const captureFormatMatch = constantsSource.match(/CAPTURE_FORMAT_VERSION = (\d+)/);
const captureFormatSpecMatch = typesSpec.match(/CAPTURE_FORMAT_VERSION = (\d+)/);
if (captureFormatMatch?.[1] !== captureFormatSpecMatch?.[1]) {
    console.error(
        'Capture format mismatch between src/shared/constants.ts and spec/types.md.',
    );
    process.exitCode = 1;
}

const serverSource = await readFile(path.join(root, 'mcp/src/index.ts'), 'utf8');
const serverMatch = serverSource.match(/name: 'spector-gpu',\s+version: '([^']+)'/);
versionSources.set('mcp/src/index.ts', serverMatch?.[1]);

const mismatches = [...versionSources].filter(([, version]) => version !== rootPackage.version);
if (mismatches.length > 0) {
    console.error(`Expected every version to equal ${rootPackage.version}:`);
    for (const [source, version] of mismatches) {
        console.error(`- ${source}: ${version ?? 'not found'}`);
    }
    process.exitCode = 1;
} else {
    console.log(`All version sources match ${rootPackage.version}.`);
}

if (process.env.GITHUB_REF_NAME?.startsWith('v')
    && process.env.GITHUB_REF_NAME !== `v${rootPackage.version}`) {
    console.error(
        `Release tag ${process.env.GITHUB_REF_NAME} does not match package version v${rootPackage.version}.`,
    );
    process.exitCode = 1;
}
