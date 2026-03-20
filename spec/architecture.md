# Spector.GPU — Architecture Overview

## What is Spector.GPU?

A Chrome extension for capturing and inspecting WebGPU frames. Think RenderDoc/Spector.js but for WebGPU. Captures a single frame of GPU commands, reads back texture and buffer data, and presents everything in an interactive result viewer.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Target Page (MAIN world)                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ contentScript.ts                                    │  │
│  │  └─ SpectorGPU (facade)                            │  │
│  │      ├─ GpuSpy          → patches navigator.gpu   │  │
│  │      ├─ DeviceSpy       → patches GPUDevice        │  │
│  │      ├─ QueueSpy        → patches GPUQueue         │  │
│  │      ├─ EncoderSpy      → patches GPUCommandEncoder│  │
│  │      ├─ RenderPassSpy   → patches GPURenderPassEnc │  │
│  │      ├─ ComputePassSpy  → patches GPUComputePassEnc│  │
│  │      ├─ CanvasSpy       → patches getContext       │  │
│  │      ├─ RecorderManager → tracks all GPU resources │  │
│  │      └─ CommandTreeBuilder → builds command tree   │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ contentScriptProxy.ts (ISOLATED world)              │  │
│  │  └─ Relays window.postMessage ↔ chrome.runtime     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         ▲ chrome.runtime messages ▼
┌──────────────────────────────────────────────────────────┐
│  background.ts (Service Worker)                          │
│  ├─ Routes messages between content ↔ popup/result       │
│  ├─ Stores captures in chrome.storage.local (chunked)    │
│  ├─ Manages per-tab state (detection, capture status)    │
│  └─ Opens result.html on capture complete                │
└──────────────────────────────────────────────────────────┘
         ▲ chrome.runtime messages ▼
┌──────────────────────────────────────────────────────────┐
│  popup.html / popup.tsx                                  │
│  └─ Shows adapter info, capture button, status           │
├──────────────────────────────────────────────────────────┤
│  result.html / result.tsx                                │
│  └─ ResultApp (React 19)                                 │
│      ├─ CaptureHeader      → stats badges               │
│      ├─ SidebarPanel       → Commands/Resources toggle   │
│      │   ├─ CommandTree    → hierarchical command list    │
│      │   └─ ResourceBrowser→ collapsible resource groups  │
│      ├─ DraggableDivider   → resizable left/right split  │
│      ├─ Breadcrumb         → navigation path             │
│      ├─ CommandDetail      → command args, state snapshot │
│      ├─ ShaderEditor       → editable WGSL with syntax HL│
│      ├─ PipelineInspector  → pipeline state viewer        │
│      ├─ ResourceDetail     → dispatches by resource type  │
│      │   ├─ TextureThumbnail → preview + metadata grid   │
│      │   ├─ CubeFaceGrid    → 3×2 cube face layout      │
│      │   ├─ TextureViewDetail→ parent texture lookup     │
│      │   └─ BufferDetail     → info + hex dump + 3D view │
│      │       └─ BufferMeshViewer (lazy) → Babylon.js     │
│      ├─ JsonTree           → collapsible JSON viewer      │
│      └─ ResourceLink       → clickable cross-references  │
└──────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── core/                      # Framework-agnostic capture engine
│   ├── spectorGpu.ts          # Main facade — orchestrates everything
│   ├── capture/               # Command tree building
│   │   ├── captureSession.ts  # (Legacy) session-based capture
│   │   ├── commandTree.ts     # Tree builder with scope push/pop
│   │   └── commandNode.ts     # Single command node
│   ├── proxy/                 # Method interception utilities
│   │   ├── methodPatcher.ts   # patchMethod() — before/after hooks
│   │   └── originStore.ts     # Saves/restores original methods
│   ├── recorders/             # Resource tracking
│   │   └── recorderManager.ts # WeakMap-based resource registry
│   └── spies/                 # WebGPU API interceptors
│       ├── gpuSpy.ts          # navigator.gpu.requestAdapter
│       ├── deviceSpy.ts       # GPUDevice.create* methods
│       ├── queueSpy.ts        # GPUQueue.submit/writeBuffer
│       ├── encoderSpy.ts      # GPUCommandEncoder methods
│       ├── renderPassSpy.ts   # GPURenderPassEncoder methods
│       ├── computePassSpy.ts  # GPUComputePassEncoder methods
│       └── canvasSpy.ts       # canvas.getContext('webgpu')
├── extension/                 # Chrome extension entry points
│   ├── manifest.json          # Manifest V3
│   ├── background.ts          # Service worker
│   ├── contentScript.ts       # MAIN world — instantiates SpectorGPU
│   ├── contentScriptProxy.ts  # ISOLATED world — message relay
│   ├── popup/                 # Extension popup UI
│   └── resultView/            # Capture result viewer
│       ├── result.tsx         # Entry point
│       ├── resourceMapHelpers.ts
│       └── components/        # React components
├── shared/                    # Shared types and utilities
│   ├── constants.ts
│   ├── types/
│   │   ├── capture.ts         # ICapture, ICommandNode, CommandType
│   │   ├── resources.ts       # IBufferInfo, ITextureInfo, etc.
│   │   └── messages.ts        # Chrome messaging types
│   └── utils/
│       ├── serialization.ts   # Map→Object, descriptor serialization
│       ├── captureStorage.ts  # chrome.storage.local with chunking
│       ├── observable.ts      # Simple event emitter
│       ├── idGenerator.ts     # Monotonic ID generator
│       └── logger.ts          # Prefixed console logger
└── styles/
    ├── popup.scss             # Popup styles
    └── result.scss            # Result viewer styles (dark theme)
```

## Key Concepts

### Spy Pattern
Each WebGPU object type has a dedicated Spy class. Spies intercept method calls via `patchMethod()` which replaces instance methods (not Proxy — avoids brand-check failures). Spies are installed passively on `init()` and fire Observable events regardless of capture state.

### Method Patcher
`patchMethod(target, methodName, { before?, after?, afterResolve?, isAsync? })`:
- `before`: Can modify args by returning a new array (used for COPY_SRC injection)
- `after`: Fires after the original call (used for resource recording)
- The original is `bound` to the target to preserve `this` for WebGPU brand checks

### COPY_SRC Injection
Both `createTexture` and `createBuffer` have `before` hooks that **clone** the descriptor and add `COPY_SRC` usage. Critical: must clone, not mutate — engines inspect descriptors after creation.

For buffers, `COPY_SRC` is skipped for MAP_READ/MAP_WRITE buffers (incompatible). Buffer COPY_SRC = `0x0004`, texture COPY_SRC = `0x01` (different flag spaces).

### Capture Flow
1. `captureNextFrame()` arms capture
2. Spy events build the command tree (pushScope/addCommand/popScope)
3. On `queue.submit` → screenshot canvas, schedule async finalization
4. `_finalizeCapture()`:
   - Sets `_isCapturing = false` (prevents re-entry)
   - Sets `_isReadingBack = true`
   - `_readbackTextures()` — per-texture error scope, parallel mapAsync
   - `_readbackBuffers()` — per-buffer error scope, base64 encoding
   - `_buildCapture()` — freeze tree, snapshot resources, emit

### Resource Snapshot
`RecorderManager.snapshot()` filters:
- Destroyed textures/buffers (tracked via Sets)
- GC'd objects (WeakRef.deref() returns undefined)
- Canvas textures: only the latest is kept (one per frame from getCurrentTexture)

### Texture Readback
- Supports 21 formats (rgba8, bgra8, float16/32, rgb10a2, single-channel, snorm)
- Cubemaps (depthOrArrayLayers === 6): reads all 6 faces, stores as `facePreviewUrls[]`
- Thumbnails: 128px max, PNG encoding
- Budget: 4MB total preview data, 16 textures max

### Buffer Readback
- base64-encoded raw bytes stored in `IBufferInfo.dataBase64`
- Budget: 32MB total, 16MB per buffer, 32 buffers max
- Skips mapped, destroyed, zero-size buffers

### Result Viewer Layout (Toggle-Mode Sidebar)
- Left panel: Commands/Resources mode toggle
  - Commands: hierarchical tree with type badges
  - Resources: collapsible groups with item lists
- Right panel: context-sensitive detail with breadcrumb
  - Commands → Details/Shaders/Pipeline tabs
  - Resources → type-specific detail (texture preview, shader code, buffer hex dump + 3D)
- Draggable vertical divider (200-500px)
- Browser back/forward navigation via History API

### Babylon.js 3D Buffer Viewer
- Lazy-loaded via `React.lazy(() => import('./BufferMeshViewer'))` — won't crash page if CSP blocks eval
- Finds vertex layout by searching command tree for draw calls → pipeline → vertex buffer layout
- Parses positions (float32x3/x4) and normals from raw buffer bytes
- Renders as wireframe mesh with ArcRotateCamera

## Design Tokens (Dark Angular Theme)

```scss
$bg-primary:   #0a0a0f;   // Near-black background
$bg-secondary: #111118;   // Cards, panels
$bg-tertiary:  #1a1a24;   // Code editors, containers
$bg-hover:     #222230;   // Hover states
$bg-selected:  #2a2a3c;   // Selected items
$text-primary: #e0e0e0;
$text-secondary: #9090a0;
$text-muted:   #606070;
$accent:       #4fc3f7;   // Cyan
$accent-dark:  #2196f3;   // Blue
$border:       #1f1f30;
$radius:       2px;       // Angular, minimal rounding
```

## Testing

- **Unit tests**: Vitest + jsdom, 281 tests across 16 files
- **WebGPU mocks**: Full mock GPU/Device/Queue/Encoder/Buffer/Texture in `test/mocks/`
- **E2E tests**: Playwright (not actively used, config present)
- **CanvasSpy reentrancy tests**: Verifies coexistence with Spector.js on Babylon playground

## Known Limitations

- Texture readback skips depth/stencil, compressed, MSAA, and 1D/3D formats
- Buffer readback skips mappable buffers (MAP_READ/MAP_WRITE)
- Captures only the first queue.submit per frame
- No multi-device support (tracks the first discovered device)
- 3D buffer viewer only supports float32 position attributes
