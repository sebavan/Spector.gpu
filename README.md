# Spector.GPU

A Chrome extension for capturing and inspecting WebGPU frames. The spiritual successor to [Spector.js](https://github.com/BabylonJS/Spector.js) — built for the WebGPU era.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **One-click frame capture** — captures all WebGPU commands from a single frame
- **Command tree** — hierarchical view of Submit → RenderPass → Draw calls with type-colored badges
- **Texture readback** — real GPU texture previews (21 formats: rgba8, bgra8, float16/32, rgb10a2, etc.)
- **Cubemap support** — all 6 faces displayed in a labeled 3×2 grid
- **Buffer readback** — raw buffer data with hex dump view
- **3D buffer viewer** — vertex buffers rendered as interactive wireframe meshes (Babylon.js)
- **Shader editor** — syntax-highlighted WGSL with line numbers
- **Pipeline inspector** — full GPU pipeline state (vertex, fragment, primitive, depth/stencil)
- **Resource browser** — collapsible groups for all resource types (textures, buffers, shaders, pipelines, bind groups, samplers)
- **Cross-references** — click any resource ID to navigate directly to it
- **Browser history** — back/forward navigation across selections
- **Draggable layout** — resizable sidebar with Commands/Resources toggle
- **Dark angular theme** — near-black background, 2px border-radius, cyan accents

## Quick Start

### Install from source

```bash
git clone https://github.com/sebavan/Spector.gpu.git
cd Spector.gpu
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

### Capture a frame

1. Navigate to any WebGPU page (e.g., [Babylon.js Playground](https://playground.babylonjs.com/?iswebgpu=true))
2. The extension icon shows a blue **GPU** badge when WebGPU is detected
3. Click the extension icon → **Capture Frame**
4. The result viewer opens automatically with the captured data

## Development

```bash
npm run build        # Production build → dist/
npm run build:dev    # Development build with source maps
npm run watch        # Watch mode (rebuilds on change)
npm run test         # Run all unit tests (Vitest)
npm run test:watch   # Watch mode tests
npm run lint         # ESLint
```

## Architecture & Specs

The [`spec/`](spec/) folder contains complete specifications to regenerate the entire codebase:

| Spec | What |
|------|------|
| [`architecture.md`](spec/architecture.md) | System diagram, directory structure, key concepts |
| [`types.md`](spec/types.md) | Complete TypeScript types, usage flag bitmasks |
| [`capture-engine.md`](spec/capture-engine.md) | Spy system, readback pipeline, format conversion |
| [`ui-components.md`](spec/ui-components.md) | React component tree, layout behavior, 3D viewer |
| [`build-config.md`](spec/build-config.md) | Webpack, manifest, SCSS tokens, message flow |

## How It Works

### Capture Engine (`src/core/`)

Spector.GPU intercepts WebGPU API calls by patching prototype methods at `document_start`. Each `create*` call is recorded by the `RecorderManager`. During capture, a `CommandTreeBuilder` constructs a hierarchical tree of GPU commands.

On `queue.submit`, the engine:
1. Takes a canvas screenshot (while the back buffer is valid)
2. Reads back texture data via `copyTextureToBuffer` + `mapAsync`
3. Reads back buffer data via `copyBufferToBuffer` + `mapAsync`
4. Freezes the command tree and resource snapshot
5. Serializes and stores in `chrome.storage.local`

### COPY_SRC Injection

To enable readback, `COPY_SRC` usage is silently added to all textures and non-mappable buffers. The descriptor is **cloned** (not mutated) to avoid breaking engines that inspect descriptors after creation.

### Result Viewer (`src/extension/resultView/`)

A React 19 single-page app with a toggle-mode sidebar:
- **Commands mode** — hierarchical command tree with Details/Shaders/Pipeline tabs
- **Resources mode** — collapsible resource groups with context-sensitive detail panel

## Supported Texture Formats

| Category | Formats |
|----------|---------|
| 8-bit | `r8unorm`, `rg8unorm`, `rgba8unorm`, `bgra8unorm` (+ srgb, snorm, int variants) |
| 16-bit float | `r16float`, `rg16float`, `rgba16float` |
| 32-bit float | `r32float`, `rg32float`, `rgba32float` |
| Packed | `rgb10a2unorm` |

Depth/stencil, compressed (BC/ETC/ASTC), MSAA, and 3D textures are not read back.

## Browser Compatibility

- Chrome 113+ (WebGPU enabled)
- Edge 113+
- Manifest V3

## License

[MIT](LICENSE) — Copyright (c) 2026 Sebastien Vandenberghe
