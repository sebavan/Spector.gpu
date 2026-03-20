# Spector.GPU — Build & Config Specification

Everything needed to set up the project from scratch.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | ^5.4 |
| UI Framework | React | ^19.0 |
| 3D Engine | @babylonjs/core | ^8.56 (lazy-loaded) |
| Build | Webpack 5 | ^5.90 |
| CSS | SASS/SCSS | ^1.71 |
| Testing | Vitest + jsdom | ^1.3 |
| E2E | Playwright | ^1.58 |
| Linting | ESLint + TS-ESLint | ^8.56 / ^7.0 |
| Extension | Chrome Manifest V3 | — |
| Types | @webgpu/types | ^0.1.69 |

## TypeScript Config

- Target: `ES2022`
- Module: `ES2022` with `bundler` resolution
- JSX: `react-jsx`
- Strict mode enabled
- Path aliases: `@core/*`, `@shared/*`, `@extension/*`

## Webpack Entry Points

| Entry | File | Output |
|-------|------|--------|
| contentScript | `src/extension/contentScript.ts` | `contentScript.js` (self-contained, no code splitting) |
| contentScriptProxy | `src/extension/contentScriptProxy.ts` | `contentScriptProxy.js` (self-contained) |
| background | `src/extension/background.ts` | `background.js` (self-contained) |
| popup | `src/extension/popup/popup.tsx` | `popup.js` + `popup.css` (code splitting allowed) |
| result | `src/extension/resultView/result.tsx` | `result.js` + `result.css` (code splitting allowed) |

**Critical**: Content scripts and background MUST be self-contained (no chunk splitting). Only popup and result entries may use `splitChunks`.

## Webpack Plugins

1. `MiniCssExtractPlugin` — extracts SCSS to separate CSS files
2. `HtmlWebpackPlugin` × 2 — generates `popup.html` and `result.html` from templates
3. `CopyWebpackPlugin` — copies `manifest.json` and `icons/` directory to dist

## Chrome Extension Manifest V3

```json
{
    "manifest_version": 3,
    "permissions": ["activeTab", "storage", "unlimitedStorage", "scripting"],
    "host_permissions": ["http://*/*", "https://*/*", "file://*/*"],
    "content_scripts": [
        { "js": ["contentScriptProxy.js"], "run_at": "document_start", "world": "ISOLATED" },
        { "js": ["contentScript.js"], "run_at": "document_start", "world": "MAIN" }
    ],
    "background": { "service_worker": "background.js", "type": "module" }
}
```

Key: Two content scripts — ISOLATED world relay proxy + MAIN world for WebGPU access.

## Message Flow

```
Page (MAIN world)                    Extension
┌───────────────┐                   ┌──────────────┐
│ contentScript │ ─window.postMsg─→ │ proxy (ISOL) │ ─chrome.runtime─→ ┌────────────┐
│               │ ←window.postMsg── │              │ ←chrome.runtime── │ background │
└───────────────┘                   └──────────────┘                   └────────────┘
                                                                            │
                                                               chrome.runtime messages
                                                                            │
                                                                    ┌───────┴───────┐
                                                                    │  popup.tsx    │
                                                                    │  result.tsx   │
                                                                    └───────────────┘
```

All messages are prefixed with `SPECTOR_GPU_` for namespacing on window.postMessage.

## Storage

Captures stored in `chrome.storage.local`:
- Small captures (< 4MB): single key `{ [captureId]: jsonString }`
- Large captures: chunked — meta key + chunk keys
  ```
  { [captureId + '_meta']: { chunks: N, totalSize: S } }
  { [captureId + '_chunk_0']: str0, ... }
  ```
- `unlimitedStorage` permission removes the 10MB quota

## Testing Config

- Vitest with jsdom environment
- Setup file: `test/setup.ts`
- Coverage thresholds: 60% (branches, functions, lines, statements)
- WebGPU mocks in `test/mocks/` — createMockWebGPU(), resetMockIds()
- Same path aliases as main tsconfig

## SCSS Build

- SCSS compiled by `sass-loader` → `css-loader` → `MiniCssExtractPlugin`
- Two SCSS files: `popup.scss` (extension popup) and `result.scss` (result viewer)
- No Tailwind — pure SCSS with design token variables

## Design Tokens

```scss
// Backgrounds (near-black → dark gray gradient)
$bg-primary:   #0a0a0f;
$bg-secondary: #111118;
$bg-tertiary:  #1a1a24;
$bg-hover:     #222230;
$bg-selected:  #2a2a3c;

// Text (high → low contrast)
$text-primary:   #e0e0e0;
$text-secondary: #9090a0;
$text-muted:     #606070;

// Accents
$accent:      #4fc3f7;  // Cyan (primary)
$accent-dark: #2196f3;  // Blue (buttons, badges)
$border:      #1f1f30;  // Subtle borders

// All border-radius: 2px (angular, technical feel)
// Font: 'Segoe UI', -apple-system, sans-serif
// Monospace: 'Cascadia Code', 'Fira Code', 'Consolas', monospace
// Base font size: 13px, line-height: 1.5
```

## Icons

Generated from Spector.js hexagonal logo SVG, blue-tinted:
- `icon16.png`, `icon48.png`, `icon128.png` — default state
- `icon48-active.png`, `icon128-active.png` — with "GPU" badge overlay
- Active icons shown when WebGPU detected, plus native Chrome badge text "GPU" (#2196f3)

## npm Scripts

```
build        → webpack --mode production
build:dev    → webpack --mode development (with source maps)
watch        → webpack --mode development --watch
test         → vitest run
test:watch   → vitest
test:coverage→ vitest run --coverage
lint         → eslint src/ test/
clean        → rimraf dist
test:e2e     → playwright test
```
