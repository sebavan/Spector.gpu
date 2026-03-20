# SpectorGPU — Implementation Plan

## Problem Statement

**What**: Build a Chrome browser extension for inspecting and debugging WebGPU applications on any website, analogous to what Spector.js does for WebGL.

**Why**: WebGPU is the successor to WebGL, shipping in Chrome/Edge/Firefox. Developers building WebGPU applications need the same caliber of debugging tools that Spector.js provides for WebGL — frame capture, command inspection, shader viewing, resource tracking, and state inspection. No equivalent tool exists today.

**Who**: WebGPU application developers — game devs, 3D visualization engineers, ML/compute developers using WebGPU.

**Success Metric**: A developer can install the extension, navigate to any WebGPU-powered page, capture a frame, and inspect the full command hierarchy (submit → command buffer → render pass → draw calls), view WGSL shaders, and inspect pipeline/resource state.

---

## Proposed Approach

### Architecture Overview

Adapt Spector.js's proven **multi-layer proxy/spy architecture** for WebGPU's async, command-buffer-based model:

```
┌──────────────────────────────────────────────────────────┐
│  PAGE (Main World)                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ GPUSpy       │→│ DeviceSpy    │→│ EncoderSpy     │  │
│  │ (navigator.  │  │ (createBuf,  │  │ (beginRender   │  │
│  │  gpu.request │  │  createTex,  │  │  Pass, draw,   │  │
│  │  Adapter)    │  │  createPipe) │  │  dispatch)     │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│          │                │                │             │
│          ▼                ▼                ▼             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ CommandRecorder (builds command tree per frame)      │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │ postMessage                    │
└─────────────────────────┼────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  ISOLATED WORLD (contentScriptProxy)                     │
│  Bridge: postMessage ↔ chrome.runtime.sendMessage        │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  BACKGROUND SERVICE WORKER                               │
│  Routes messages, stores captures, manages extension state│
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  UI (Popup + Result Tab)                                 │
│  React app: command tree, shader viewer, state inspector │
└──────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Proxy via Prototype Override** (same as Spector.js)
   - Override `navigator.gpu.requestAdapter()` to intercept the adapter
   - Wrap returned `GPUDevice` in a Proxy to intercept all `create*` methods
   - Wrap `GPUCommandEncoder`, `GPURenderPassEncoder`, `GPUComputePassEncoder` to record commands
   - Wrap `GPUQueue` to intercept `submit()` calls (frame boundaries)
   - **Rationale**: Proven pattern from Spector.js; works with any WebGPU app without app cooperation

2. **Command Tree Model** (new for WebGPU)
   - WebGL: flat list of gl.* calls
   - WebGPU: hierarchical tree: `queue.submit()` → `commandBuffer` → `renderPass` → `draw()`
   - Model commands as a tree with parent/child relationships
   - **Rationale**: WebGPU's command buffer architecture is inherently hierarchical

3. **Async-Aware Capture** (new for WebGPU)
   - WebGPU's `requestAdapter()`, `requestDevice()`, `mapAsync()` are all async
   - Proxy must correctly wrap Promises and await results before wrapping returned objects
   - **Rationale**: Unlike WebGL, we can't just synchronously intercept — must handle Promise chains

4. **Texture Readback via copyTextureToBuffer** (new for WebGPU)
   - WebGL: simple `readPixels()`
   - WebGPU: must `copyTextureToBuffer()` → `mapAsync()` → read data → render to canvas
   - Queue readback commands alongside app commands, but keep them invisible to the app
   - **Rationale**: WebGPU has no equivalent to readPixels; explicit copy is the only way

5. **React + TypeScript for UI** (consistent with Spector.js)
   - Leverage React 19 for the result view and popup
   - TypeScript throughout for type safety
   - **Rationale**: Proven stack, good component model for complex inspector UIs

6. **Observable Event System** (from Spector.js)
   - Same typed Observable<T> pattern for decoupled component communication
   - **Rationale**: Battle-tested in Spector.js, keeps components loosely coupled

7. **Webpack 5 Build** (consistent)
   - Multi-entry webpack config: content scripts, background worker, popup, result view
   - **Rationale**: Proven approach, handles multiple entry points and code splitting

---

## Project Structure

```
E:\spector-gpu/
├── src/
│   ├── core/                           # Core capture engine (runs in MAIN world)
│   │   ├── spies/                      # API interception layer
│   │   │   ├── gpuSpy.ts               # Intercepts navigator.gpu.requestAdapter()
│   │   │   ├── adapterSpy.ts           # Wraps GPUAdapter.requestDevice()
│   │   │   ├── deviceSpy.ts            # Wraps GPUDevice create* methods + queue
│   │   │   ├── queueSpy.ts             # Wraps GPUQueue.submit(), writeBuffer(), writeTexture()
│   │   │   ├── encoderSpy.ts           # Wraps GPUCommandEncoder methods
│   │   │   ├── renderPassSpy.ts        # Wraps GPURenderPassEncoder (draw calls)
│   │   │   ├── computePassSpy.ts       # Wraps GPUComputePassEncoder (dispatch calls)
│   │   │   └── canvasSpy.ts            # Wraps GPUCanvasContext (configure, getCurrentTexture)
│   │   ├── recorders/                  # Resource lifecycle tracking
│   │   │   ├── bufferRecorder.ts       # GPUBuffer create/write/destroy tracking
│   │   │   ├── textureRecorder.ts      # GPUTexture create/destroy + readback
│   │   │   ├── samplerRecorder.ts      # GPUSampler tracking
│   │   │   ├── shaderRecorder.ts       # GPUShaderModule tracking (captures WGSL)
│   │   │   ├── pipelineRecorder.ts     # Render/Compute pipeline tracking
│   │   │   ├── bindGroupRecorder.ts    # BindGroup/BindGroupLayout tracking
│   │   │   └── recorderManager.ts      # Orchestrates all recorders
│   │   ├── capture/                    # Capture session management
│   │   │   ├── captureSession.ts       # Manages one capture (start→stop→serialize)
│   │   │   ├── commandNode.ts          # Tree node for command hierarchy
│   │   │   ├── frameDetector.ts        # Detects frame boundaries (rAF + submit)
│   │   │   └── textureReadback.ts      # Async texture content capture
│   │   ├── proxy/                      # Low-level proxy utilities
│   │   │   ├── proxyWrapper.ts         # Generic Proxy factory (wraps any GPU object)
│   │   │   └── originStore.ts          # Stores original methods (like OriginFunctionHelper)
│   │   └── spectorGpu.ts              # Main entry point — orchestrates spies + capture
│   │
│   ├── shared/                         # Shared types and utilities
│   │   ├── types/                      # TypeScript interfaces
│   │   │   ├── capture.ts              # ICapture, ICommandNode, IResourceInfo, etc.
│   │   │   ├── messages.ts             # Message types for extension communication
│   │   │   ├── webgpu.ts               # WebGPU-specific type extensions
│   │   │   └── state.ts                # Pipeline state, bind group state interfaces
│   │   ├── utils/
│   │   │   ├── observable.ts           # Observable<T> event system
│   │   │   ├── logger.ts              # Logging utility (debug/info/warn/error)
│   │   │   ├── idGenerator.ts         # Unique ID generator for tracked objects
│   │   │   └── serialization.ts       # Safe serialization of GPU descriptors
│   │   └── constants.ts               # Message types, version, config keys
│   │
│   ├── extension/                      # Chrome extension infrastructure
│   │   ├── background.ts              # Service worker — message routing, state mgmt
│   │   ├── contentScript.ts           # MAIN world — loads spectorGpu, starts interception
│   │   ├── contentScriptProxy.ts      # ISOLATED world — bridges page ↔ extension
│   │   ├── popup/                     # Popup UI
│   │   │   ├── popup.html             # Popup shell
│   │   │   ├── popup.tsx              # Popup React app
│   │   │   └── components/
│   │   │       ├── PopupApp.tsx        # Main popup component
│   │   │       ├── StatusIndicator.tsx # WebGPU detection indicator
│   │   │       └── CaptureButton.tsx  # Capture trigger button
│   │   ├── resultView/                # Result view (opens in new tab)
│   │   │   ├── result.html            # Result page shell
│   │   │   ├── result.tsx             # Result view React app entry
│   │   │   └── components/
│   │   │       ├── ResultApp.tsx       # Main result app
│   │   │       ├── CommandTree.tsx     # Hierarchical command list
│   │   │       ├── CommandDetail.tsx   # Selected command details (JSON tree)
│   │   │       ├── ShaderViewer.tsx    # WGSL shader display
│   │   │       ├── PipelineInspector.tsx # Pipeline state viewer
│   │   │       ├── ResourceInspector.tsx # Buffer/Texture/Sampler details
│   │   │       ├── BindGroupViewer.tsx # Bind group contents
│   │   │       ├── RenderPassViewer.tsx # Render pass descriptor view
│   │   │       ├── TexturePreview.tsx  # Texture image preview
│   │   │       └── JsonTree.tsx        # Recursive JSON tree renderer
│   │   └── manifest.json             # Manifest v3
│   │
│   └── styles/                        # SCSS styles
│       ├── _variables.scss            # Theme variables (dark theme)
│       ├── _base.scss                 # Base styles
│       ├── popup.scss                 # Popup styles
│       ├── result.scss                # Result view styles
│       ├── commandTree.scss           # Command tree styles
│       └── inspector.scss             # Inspector panel styles
│
├── test/
│   ├── core/
│   │   ├── spies/                     # Unit tests for each spy
│   │   │   ├── gpuSpy.test.ts
│   │   │   ├── deviceSpy.test.ts
│   │   │   ├── encoderSpy.test.ts
│   │   │   ├── renderPassSpy.test.ts
│   │   │   └── computePassSpy.test.ts
│   │   ├── recorders/
│   │   │   ├── bufferRecorder.test.ts
│   │   │   ├── textureRecorder.test.ts
│   │   │   └── shaderRecorder.test.ts
│   │   ├── capture/
│   │   │   ├── captureSession.test.ts
│   │   │   ├── commandNode.test.ts
│   │   │   └── frameDetector.test.ts
│   │   └── proxy/
│   │       ├── proxyWrapper.test.ts
│   │       └── originStore.test.ts
│   ├── integration/
│   │   ├── fullCapture.test.ts        # End-to-end capture flow
│   │   └── proxyTransparency.test.ts  # Verify proxy doesn't break host
│   ├── ui/
│   │   ├── CommandTree.test.tsx
│   │   ├── ShaderViewer.test.tsx
│   │   └── PipelineInspector.test.tsx
│   ├── __mocks__/
│   │   ├── webgpuMock.ts             # Mock WebGPU API for testing
│   │   └── styleMock.js              # SCSS module mock
│   └── fixtures/
│       ├── sampleCapture.ts          # Sample capture data for UI tests
│       └── sampleWgsl.ts             # Sample WGSL shaders
│
├── webpack.config.js                  # Multi-entry webpack config
├── tsconfig.json                      # TypeScript config
├── jest.config.js                     # Jest config
├── package.json                       # Dependencies & scripts
├── .eslintrc.js                       # ESLint config
├── .prettierrc                        # Prettier config
├── README.md                          # Project documentation
└── docs/
    ├── architecture.md               # Architecture overview
    ├── proxy-layer.md                # Proxy pattern documentation
    ├── capture-format.md             # Capture data format spec
    └── contributing.md               # Contributor guide
```

---

## Task Breakdown

Tasks are ordered by dependency. Each task is scoped to 1-3 files and completable in one sitting.

### Phase 0: Project Bootstrap (P0-*)
Foundation — must be done first.

### Phase 1: Core Proxy Layer (P1-*)
The interception engine that wraps WebGPU objects without breaking them.

### Phase 2: Command Recording (P2-*)
Building the command tree and resource tracking.

### Phase 3: Capture Session (P3-*)
Frame detection, capture lifecycle, texture readback.

### Phase 4: Extension Infrastructure (P4-*)
Manifest, content scripts, background worker, messaging.

### Phase 5: UI — Result View (P5-*)
React components for inspecting captured data.

### Phase 6: UI — Popup (P6-*)
Extension popup for controlling capture.

### Phase 7: Testing (P7-*)
Unit, integration, and UI tests.

### Phase 8: Documentation (P8-*)
README, architecture docs, contributor guide.

---

### Phase 0: Project Bootstrap

#### P0-INIT — Initialize project with package.json, tsconfig, webpack
**Description**: Create the project scaffold with TypeScript, Webpack 5, React, Jest configs.
**Files**: `package.json`, `tsconfig.json`, `webpack.config.js`, `jest.config.js`, `.eslintrc.js`, `.prettierrc`
**Acceptance Criteria**:
- `npm install` succeeds with zero errors
- `npm run build` produces output (even if empty entry points)
- `npm test` runs Jest (even with no tests yet)
- TypeScript strict mode enabled
- Webpack configured with 4 entry points: `contentScript`, `contentScriptProxy`, `background`, `popup`, `result`
- Source maps enabled for development

**Dependencies**: None

#### P0-TYPES — Define core TypeScript interfaces
**Description**: Define all shared type interfaces that the rest of the codebase depends on. This is the data contract.
**Files**: `src/shared/types/capture.ts`, `src/shared/types/messages.ts`, `src/shared/types/state.ts`, `src/shared/types/webgpu.ts`
**Acceptance Criteria**:
- `ICapture` interface defined with: device info, commands (tree), resources, timing
- `ICommandNode` interface: id, name, type (submit/encoderOp/renderPass/computePass/draw/dispatch/resource), args, children[], parentId, timing, pipelineState?, boundResources?
- `IResourceInfo` interface: id, type (buffer/texture/sampler/shader/pipeline/bindGroup), descriptor, label?, memorySize?
- `IShaderInfo` interface: id, label, wgslSource, compilationInfo?
- `IPipelineState` interface: vertex, fragment, compute, primitive, depthStencil, multisample, layout
- `IBindGroupInfo` interface: id, layoutId, entries (binding → resource mapping)
- `IRenderPassInfo` interface: colorAttachments[], depthStencilAttachment, occlusionQuerySet
- Message types: `WEBGPU_DETECTED`, `CAPTURE_START`, `CAPTURE_STOP`, `CAPTURE_DATA`, `STATUS_QUERY`
- All interfaces exported, no implementation code
- Compiles with `tsc --noEmit`

**Dependencies**: P0-INIT

#### P0-UTILS — Implement shared utilities
**Description**: Observable event system, logger, ID generator, serialization helper.
**Files**: `src/shared/utils/observable.ts`, `src/shared/utils/logger.ts`, `src/shared/utils/idGenerator.ts`, `src/shared/utils/serialization.ts`, `src/shared/constants.ts`
**Acceptance Criteria**:
- `Observable<T>`: add(callback) → id, remove(id), trigger(value), clear()
- `Logger`: debug/info/warn/error with prefix "[SpectorGPU]", configurable log level
- `IdGenerator`: monotonically increasing IDs, reset capability, prefix support
- `serialization.ts`: safely serialize GPU descriptors (handle ArrayBuffers, TypedArrays, circular refs)
- `constants.ts`: message type strings, version string, storage keys

**Dependencies**: P0-INIT

---

### Phase 1: Core Proxy Layer

#### P1-PROXY — Implement generic proxy wrapper and origin store
**Description**: Build the low-level proxy mechanism that wraps any WebGPU object, intercepts method calls, and stores original references.
**Files**: `src/core/proxy/proxyWrapper.ts`, `src/core/proxy/originStore.ts`
**Acceptance Criteria**:
- `ProxyWrapper.wrap<T>(target, handlers)`: returns ES6 Proxy that intercepts get/apply traps
- Handles property access (getters), method calls, and Promise-returning methods
- `OriginStore.store(obj, methodName)`: saves original method reference keyed by `__spectorGpu_origin_${methodName}`
- `OriginStore.callOriginal(obj, methodName, args)`: invokes stored original
- Proxy is transparent: all operations pass through to original object when not intercepted
- No memory leaks: WeakMap-based storage for proxy → target mapping
- Type-safe: generic wrapper preserves TypeScript types

**Dependencies**: P0-UTILS

#### P1-GPU-SPY — Intercept navigator.gpu.requestAdapter()
**Description**: First spy in the chain. Overrides `navigator.gpu.requestAdapter()` to intercept the returned `GPUAdapter`, then overrides `adapter.requestDevice()` to intercept the returned `GPUDevice`.
**Files**: `src/core/spies/gpuSpy.ts`, `src/core/spies/adapterSpy.ts`
**Acceptance Criteria**:
- Overrides `navigator.gpu.requestAdapter()` to wrap the returned Promise and proxy the adapter
- Overrides `adapter.requestDevice()` to wrap the returned Promise and proxy the device
- Fires `onAdapterCreated` observable when adapter is obtained
- Fires `onDeviceCreated` observable when device is obtained
- Returns valid proxied GPUAdapter/GPUDevice that pass `instanceof` checks (or duck-type correctly)
- Original `requestAdapter()` and `requestDevice()` behavior is unchanged — app still works
- Handles multiple adapter/device creations (multiple contexts on same page)
- Handles `requestAdapter()` returning null (no WebGPU support)
- Handles `requestDevice()` rejection (device creation failure)

**Dependencies**: P1-PROXY, P0-TYPES

#### P1-DEVICE-SPY — Intercept GPUDevice create* methods
**Description**: Wraps all `device.create*()` methods to track resource creation and wraps `device.queue` for submit interception.
**Files**: `src/core/spies/deviceSpy.ts`
**Acceptance Criteria**:
- Intercepts: `createBuffer`, `createTexture`, `createSampler`, `createShaderModule`, `createRenderPipeline`, `createComputePipeline`, `createBindGroup`, `createBindGroupLayout`, `createPipelineLayout`, `createCommandEncoder`, `createRenderBundleEncoder`, `createQuerySet`
- Intercepts async: `createRenderPipelineAsync`, `createComputePipelineAsync`
- Each intercepted call: records the descriptor, assigns a tracking ID, wraps the returned object
- Fires observable per resource type: `onBufferCreated`, `onTextureCreated`, `onShaderCreated`, `onPipelineCreated`, `onBindGroupCreated`
- `device.queue` is wrapped with QueueSpy (see P1-QUEUE-SPY)
- `device.destroy()` is intercepted to clean up tracking state
- All returned objects work correctly in subsequent WebGPU calls (no broken Proxy issues)
- `device.label`, `device.features`, `device.limits`, `device.lost` all pass through correctly

**Dependencies**: P1-GPU-SPY, P1-PROXY

#### P1-QUEUE-SPY — Intercept GPUQueue methods
**Description**: Wraps `device.queue` to intercept `submit()`, `writeBuffer()`, `writeTexture()`, `copyExternalImageToTexture()`, and `onSubmittedWorkDone()`.
**Files**: `src/core/spies/queueSpy.ts`
**Acceptance Criteria**:
- Intercepts `queue.submit(commandBuffers[])` — this is the primary frame-capture trigger
- Records which command buffers were submitted and their contents
- Intercepts `queue.writeBuffer()` — records buffer data uploads
- Intercepts `queue.writeTexture()` — records texture data uploads
- Fires `onSubmit` observable with submitted command buffer data
- Fires `onWriteBuffer` / `onWriteTexture` observables
- All intercepted calls still execute the original operation — app behavior unchanged
- Handles empty submits (`queue.submit([])`)

**Dependencies**: P1-DEVICE-SPY

#### P1-ENCODER-SPY — Intercept GPUCommandEncoder methods
**Description**: Wraps `GPUCommandEncoder` to intercept `beginRenderPass()`, `beginComputePass()`, `copyBufferToBuffer()`, `copyTextureToBuffer()`, etc., and `finish()`.
**Files**: `src/core/spies/encoderSpy.ts`
**Acceptance Criteria**:
- Intercepts: `beginRenderPass`, `beginComputePass`, `finish`, `copyBufferToBuffer`, `copyBufferToTexture`, `copyTextureToBuffer`, `copyTextureToTexture`, `clearBuffer`, `resolveQuerySet`, `writeTimestamp`, `pushDebugGroup`, `popDebugGroup`, `insertDebugMarker`
- `beginRenderPass()` returns a proxied `GPURenderPassEncoder` (see P1-RENDER-SPY)
- `beginComputePass()` returns a proxied `GPUComputePassEncoder` (see P1-COMPUTE-SPY)
- `finish()` returns a proxied `GPUCommandBuffer` and records the complete encoder command list
- Records render pass descriptors (color attachments, depth attachment, load/store ops)
- Fires `onEncoderCreated`, `onRenderPassStarted`, `onComputePassStarted`, `onEncoderFinished`

**Dependencies**: P1-DEVICE-SPY, P1-PROXY

#### P1-RENDER-SPY — Intercept GPURenderPassEncoder methods
**Description**: Wraps `GPURenderPassEncoder` to capture all render commands (the most important spy for MVP).
**Files**: `src/core/spies/renderPassSpy.ts`
**Acceptance Criteria**:
- Intercepts: `setPipeline`, `setBindGroup`, `setVertexBuffer`, `setIndexBuffer`, `draw`, `drawIndexed`, `drawIndirect`, `drawIndexedIndirect`, `setViewport`, `setScissorRect`, `setBlendConstant`, `setStencilReference`, `end`, `executeBundles`, `beginOcclusionQuery`, `endOcclusionQuery`, `pushDebugGroup`, `popDebugGroup`, `insertDebugMarker`
- Each call recorded as a `ICommandNode` child of the render pass node
- `setPipeline` records which pipeline is active → links to pipeline state
- `setBindGroup` records which bind group is active at which index
- `setVertexBuffer` / `setIndexBuffer` records which buffers are bound
- `draw` / `drawIndexed` records vertex count, instance count, offsets
- `end()` finalizes the render pass command list
- All state at each draw call is derivable from the recorded commands

**Dependencies**: P1-ENCODER-SPY

#### P1-COMPUTE-SPY — Intercept GPUComputePassEncoder methods
**Description**: Wraps `GPUComputePassEncoder` to capture compute dispatch commands.
**Files**: `src/core/spies/computePassSpy.ts`
**Acceptance Criteria**:
- Intercepts: `setPipeline`, `setBindGroup`, `dispatchWorkgroups`, `dispatchWorkgroupsIndirect`, `end`, `pushDebugGroup`, `popDebugGroup`, `insertDebugMarker`
- Each call recorded as `ICommandNode` child of the compute pass node
- `dispatchWorkgroups` records workgroup counts (x, y, z)
- `end()` finalizes the compute pass
- Pipeline and bind group state tracked per dispatch

**Dependencies**: P1-ENCODER-SPY

#### P1-CANVAS-SPY — Intercept GPUCanvasContext
**Description**: Wraps `canvas.getContext("webgpu")` to intercept the `GPUCanvasContext` for `configure()` and `getCurrentTexture()`.
**Files**: `src/core/spies/canvasSpy.ts`
**Acceptance Criteria**:
- Overrides `HTMLCanvasElement.prototype.getContext` to detect `"webgpu"` context requests
- Fires `onWebGPUContextCreated` observable when WebGPU context is created
- Intercepts `context.configure(config)` — records device, format, usage, alphaMode
- Intercepts `context.getCurrentTexture()` — records swapchain texture acquisitions
- Works with both `HTMLCanvasElement` and `OffscreenCanvas`
- Does NOT interfere with non-WebGPU getContext calls (WebGL, 2D, etc.)

**Dependencies**: P1-PROXY, P0-TYPES

---

### Phase 2: Command Recording

#### P2-CMD-NODE — Implement command tree data structure
**Description**: Build the tree data structure that models WebGPU's hierarchical command model.
**Files**: `src/core/capture/commandNode.ts`
**Acceptance Criteria**:
- `CommandNode` class with: id, name, type, args, children, parent, timing (startTime, endTime)
- Tree operations: `addChild(node)`, `getChildren()`, `getParent()`, `findById(id)`, `flatten()` (DFS list)
- Node types enum: `Submit`, `CommandEncoder`, `RenderPass`, `ComputePass`, `Draw`, `DrawIndexed`, `Dispatch`, `SetPipeline`, `SetBindGroup`, `SetVertexBuffer`, `SetIndexBuffer`, `Copy`, `Other`
- Serializable to plain JSON (for transfer across extension boundaries)
- `flatten()` produces a flat list with depth info (for rendering in CommandTree UI)

**Dependencies**: P0-TYPES

#### P2-RECORDERS — Implement resource recorders
**Description**: Track resource creation, metadata, and lifecycle for all WebGPU resource types.
**Files**: `src/core/recorders/bufferRecorder.ts`, `src/core/recorders/textureRecorder.ts`, `src/core/recorders/samplerRecorder.ts`, `src/core/recorders/shaderRecorder.ts`, `src/core/recorders/pipelineRecorder.ts`, `src/core/recorders/bindGroupRecorder.ts`, `src/core/recorders/recorderManager.ts`
**Acceptance Criteria**:
- `BufferRecorder`: tracks GPUBuffer creation with size, usage, mappedAtCreation; tracks destroy
- `TextureRecorder`: tracks GPUTexture creation with size, format, dimension, usage, mipLevelCount, sampleCount; tracks destroy
- `SamplerRecorder`: tracks GPUSampler creation with filter/address modes
- `ShaderRecorder`: tracks GPUShaderModule creation, **captures WGSL source code** from descriptor.code, stores compilation messages
- `PipelineRecorder`: tracks GPURenderPipeline and GPUComputePipeline, captures full pipeline descriptor (vertex/fragment/compute stages, primitive state, depth/stencil, multisample, layout references)
- `BindGroupRecorder`: tracks GPUBindGroup creation, maps binding index → resource (buffer/texture/sampler) with offset/size
- `RecorderManager`: registers all recorders, provides `getResource(id)` → `IResourceInfo`, `getAllResources()` → `Map<id, IResourceInfo>`, `getShaderSource(id)` → WGSL string
- Each recorder assigns a unique tracking ID to its resources (via IdGenerator)
- Resources are stored in a Map keyed by tracking ID
- All metadata serializable to JSON

**Dependencies**: P0-TYPES, P0-UTILS

#### P2-RECORDER-INTEGRATION — Connect recorders to device spy
**Description**: Wire up DeviceSpy's observables to the appropriate recorders so resources are automatically tracked on creation.
**Files**: Updates to `src/core/spies/deviceSpy.ts`, `src/core/recorders/recorderManager.ts`
**Acceptance Criteria**:
- When `device.createBuffer(desc)` is called → `BufferRecorder.onCreated(id, desc, wrappedBuffer)` fires
- When `device.createShaderModule(desc)` is called → `ShaderRecorder.onCreated(id, desc, module)` fires and WGSL source is stored
- Similarly for all resource types
- `RecorderManager.getResourcesSnapshot()` returns a complete map at time of capture
- Resources created before capture starts are still tracked (always-on tracking)
- Resources destroyed before capture starts are removed from the active map

**Dependencies**: P2-RECORDERS, P1-DEVICE-SPY

---

### Phase 3: Capture Session

#### P3-FRAME-DETECT — Implement frame boundary detection
**Description**: Detect frame boundaries using requestAnimationFrame hooks AND queue.submit() calls.
**Files**: `src/core/capture/frameDetector.ts`
**Acceptance Criteria**:
- Hooks `requestAnimationFrame` (all vendor prefixes) to detect frame start/end
- Also uses `queue.submit()` as an alternative frame boundary (some apps don't use rAF)
- Fires `onFrameStart` and `onFrameEnd` observables
- Handles apps that call `submit()` multiple times per frame (aggregates into single frame)
- Handles apps that use `setTimeout`/`setInterval` instead of rAF
- Configurable: use rAF-based detection (default) or submit-based detection

**Dependencies**: P0-UTILS

#### P3-CAPTURE — Implement capture session lifecycle
**Description**: Manages a single capture session: start → record commands → stop → package result.
**Files**: `src/core/capture/captureSession.ts`
**Acceptance Criteria**:
- `startCapture()`: begins recording (waits for next frame boundary), resets command tree
- `stopCapture()`: ends recording at frame boundary, packages ICapture
- During capture: all spy callbacks feed into command tree building
- Each `queue.submit()` becomes a root-level `Submit` node in the command tree
- Each command encoder's commands become children of the submit
- Each render/compute pass's commands become children of the encoder
- After stop: `getCapture()` returns `ICapture` with: commandTree, resources, shaders, timing, device info
- Handles capture of exactly 1 frame (MVP) — the frame after startCapture() is called
- Produces serializable JSON output (no circular references, no GPU object references)

**Dependencies**: P3-FRAME-DETECT, P2-CMD-NODE, P2-RECORDER-INTEGRATION

#### P3-READBACK — Implement texture readback
**Description**: Capture texture contents as image data for the texture preview feature.
**Files**: `src/core/capture/textureReadback.ts`
**Acceptance Criteria**:
- `readbackTexture(device, texture, format)` → returns `Promise<ImageData>` or `Promise<ArrayBuffer>`
- Uses `copyTextureToBuffer` → staging buffer → `mapAsync` → read data
- Converts common formats (rgba8unorm, bgra8unorm, rgba16float) to displayable pixel data
- Handles 2D textures (MVP); 3D/cube/array textures deferred
- Does NOT modify the source texture
- Creates and destroys staging resources (no leaks)
- Returns null/error for unsupported formats (depth, compressed, etc.)
- Readback operations are queued to avoid stalling the GPU during capture

**Dependencies**: P1-QUEUE-SPY, P0-TYPES

#### P3-ORCHESTRATOR — Main SpectorGPU orchestrator
**Description**: The top-level class that wires everything together: spies → recorders → capture session.
**Files**: `src/core/spectorGpu.ts`
**Acceptance Criteria**:
- `SpectorGPU.init()`: installs all spies (gpuSpy → adapterSpy → deviceSpy → queueSpy → encoderSpy → renderPassSpy → computePassSpy → canvasSpy)
- `SpectorGPU.startCapture()`: begins frame capture on the active device
- `SpectorGPU.stopCapture()`: ends capture, returns `ICapture`
- `SpectorGPU.isWebGPUActive()`: returns true if any GPUDevice has been created
- `SpectorGPU.getDevices()`: returns list of tracked devices
- Observable: `onWebGPUDetected`, `onCaptureComplete(ICapture)`, `onError(string)`
- Wires all spy observables to recorder manager and capture session
- Handles cleanup: `SpectorGPU.dispose()` removes all proxies, restores originals

**Dependencies**: P3-CAPTURE, P3-READBACK, P1-GPU-SPY, P1-CANVAS-SPY

---

### Phase 4: Extension Infrastructure

#### P4-MANIFEST — Create Chrome extension manifest and HTML shells
**Description**: Manifest v3, popup.html, result.html, extension icons.
**Files**: `src/extension/manifest.json`, `src/extension/popup/popup.html`, `src/extension/resultView/result.html`, icon files
**Acceptance Criteria**:
- Manifest v3 with: `host_permissions: ["<all_urls>"]`, `permissions: ["storage", "activeTab"]`
- Content scripts: MAIN world (spectorGpu bundle + contentScript.js) at `document_start`, ISOLATED world (contentScriptProxy.js) at `document_start`
- Background service worker registered
- Popup specified via `default_popup`
- Web-accessible resources for result view
- Extension loads in Chrome without errors
- Icons at 16, 48, 128px sizes (placeholder/generated)

**Dependencies**: P0-INIT

#### P4-CONTENT-MAIN — Implement MAIN world content script
**Description**: Content script that runs in the page's JavaScript context, initializes SpectorGPU, and communicates capture status/data outward.
**Files**: `src/extension/contentScript.ts`
**Acceptance Criteria**:
- Instantiates `SpectorGPU.init()` at document_start (before page scripts run)
- Listens for `CAPTURE_START` message from isolated world → calls `spectorGpu.startCapture()`
- On capture complete → serializes ICapture and posts via `window.postMessage` to isolated world
- Posts `WEBGPU_DETECTED` message when first GPUDevice is created
- Does NOT inject any visible UI into the page
- Handles errors gracefully (logs but doesn't crash the page)

**Dependencies**: P3-ORCHESTRATOR

#### P4-CONTENT-ISOLATED — Implement ISOLATED world content script
**Description**: Content script that bridges between MAIN world (page) and the extension's background service worker.
**Files**: `src/extension/contentScriptProxy.ts`
**Acceptance Criteria**:
- Listens for `window.postMessage` from MAIN world → forwards via `chrome.runtime.sendMessage` to background
- Listens for `chrome.runtime.onMessage` from background → forwards via `window.postMessage` to MAIN world
- Message filtering: only processes messages with `source: "spector-gpu"` prefix
- Handles large capture data transfer (may need chunking for captures > 64MB)

**Dependencies**: P4-MANIFEST

#### P4-BACKGROUND — Implement background service worker
**Description**: Routes messages between content scripts, popup, and result view. Manages extension state.
**Files**: `src/extension/background.ts`
**Acceptance Criteria**:
- Receives `WEBGPU_DETECTED` → updates extension icon (lights up badge) for that tab
- Receives `CAPTURE_START` from popup → forwards to content script for active tab
- Receives `CAPTURE_DATA` from content script → stores in `chrome.storage.local`, notifies result view
- Manages per-tab state: `{tabId: { hasWebGPU: bool, isCapturing: bool, lastCapture: string }}`
- Opens result view in new tab when capture is complete
- Handles tab close/navigate: cleans up state for that tab
- `chrome.action.onClicked` or popup interaction triggers capture

**Dependencies**: P4-CONTENT-ISOLATED

---

### Phase 5: UI — Result View

#### P5-RESULT-SHELL — Create result view app shell with React
**Description**: Set up the React application for the result view with layout, routing between panels, and dark theme.
**Files**: `src/extension/resultView/result.tsx`, `src/extension/resultView/components/ResultApp.tsx`, `src/styles/_variables.scss`, `src/styles/_base.scss`, `src/styles/result.scss`
**Acceptance Criteria**:
- React 19 app renders in result.html
- Dark theme with CSS variables (--bg-primary, --bg-secondary, --text-primary, --text-secondary, --accent, --border)
- Layout: left panel (command tree, ~30% width), right panel (detail view, ~70% width)
- Panel resize via drag handle
- Receives capture data from background worker via `chrome.runtime.onMessage`
- Loading state while waiting for capture data
- Responsive layout (min-width: 800px)

**Dependencies**: P0-INIT, P4-BACKGROUND

#### P5-CMD-TREE — Implement command tree component
**Description**: Hierarchical, collapsible tree view showing all commands in the captured frame.
**Files**: `src/extension/resultView/components/CommandTree.tsx`, `src/styles/commandTree.scss`
**Acceptance Criteria**:
- Renders ICommandNode tree with proper indentation and collapse/expand
- Node types visually distinguished: Submit (blue), RenderPass (green), ComputePass (orange), Draw/Dispatch (white), SetPipeline/SetBindGroup (gray)
- Click a node → selects it → fires onCommandSelected callback
- Expand/collapse all button
- Shows command count per node (e.g., "Render Pass (12 commands)")
- Shows draw/dispatch call counts in pass headers
- Keyboard navigable: arrow keys to navigate, Enter to select, Space to toggle expand
- Search/filter: text input filters commands by name
- Performance: virtualized list for captures with 1000+ commands (react-window or similar)

**Dependencies**: P5-RESULT-SHELL, P2-CMD-NODE

#### P5-CMD-DETAIL — Implement command detail panel
**Description**: Shows detailed info for the selected command — arguments as JSON tree, associated pipeline state, bound resources.
**Files**: `src/extension/resultView/components/CommandDetail.tsx`, `src/extension/resultView/components/JsonTree.tsx`, `src/styles/inspector.scss`
**Acceptance Criteria**:
- Shows command name, type, timing (duration in µs)
- Shows command arguments as expandable JSON tree
- For draw/dispatch commands: shows active pipeline ID, bound bind groups, bound buffers
- JSON tree component: recursive, collapsible, syntax-colored (strings=green, numbers=blue, booleans=red, null=gray)
- Copy-to-clipboard button for any value
- Links to related resources (clicking a pipeline ID scrolls to PipelineInspector)

**Dependencies**: P5-RESULT-SHELL

#### P5-SHADER — Implement shader viewer
**Description**: Display WGSL shader source code with line numbers.
**Files**: `src/extension/resultView/components/ShaderViewer.tsx`
**Acceptance Criteria**:
- Displays WGSL source code with line numbers
- Monospace font, dark theme, readable
- Shows shader label (if provided by app)
- Shows which pipeline(s) use this shader
- Shows shader stage (vertex/fragment/compute) and entry point
- Copy-to-clipboard for entire shader source
- Scrollable for long shaders
- (Nice-to-have deferred): syntax highlighting

**Dependencies**: P5-RESULT-SHELL

#### P5-PIPELINE — Implement pipeline state inspector
**Description**: Show the full configuration of a render or compute pipeline.
**Files**: `src/extension/resultView/components/PipelineInspector.tsx`
**Acceptance Criteria**:
- For render pipelines: shows vertex stage (module, entryPoint, buffers layout), fragment stage (module, entryPoint, targets), primitive state (topology, strip index format, front face, cull mode), depth/stencil state, multisample state
- For compute pipelines: shows compute stage (module, entryPoint), pipeline layout
- Each section collapsible
- Links to shader viewer for vertex/fragment/compute modules
- Shows pipeline label if provided
- Vertex buffer layouts displayed as table (attributes, format, offset, shaderLocation)

**Dependencies**: P5-RESULT-SHELL, P5-SHADER

#### P5-RESOURCE — Implement resource inspector
**Description**: Show metadata for buffers, textures, and samplers.
**Files**: `src/extension/resultView/components/ResourceInspector.tsx`
**Acceptance Criteria**:
- Buffer details: size (human-readable, e.g., "4.0 KB"), usage flags (as human-readable strings: VERTEX, INDEX, UNIFORM, STORAGE, etc.), mappedAtCreation, label
- Texture details: size (width × height × depthOrArrayLayers), format, dimension, usage flags, mipLevelCount, sampleCount, label
- Sampler details: addressModeU/V/W, magFilter, minFilter, mipmapFilter, lodMinClamp, lodMaxClamp, compare, maxAnisotropy, label
- Displayed as key-value table with headers per resource type
- Shows total resource count and memory usage summary at top

**Dependencies**: P5-RESULT-SHELL

#### P5-BINDGROUP — Implement bind group viewer
**Description**: Show which resources are bound in a bind group at each draw/dispatch call.
**Files**: `src/extension/resultView/components/BindGroupViewer.tsx`
**Acceptance Criteria**:
- Shows bind group layout: binding index → resource type (buffer, sampler, texture, storageTexture, externalTexture)
- For buffer bindings: shows which buffer, offset, size
- For texture bindings: shows which texture view
- For sampler bindings: shows which sampler
- Clickable resource references → navigates to resource inspector
- Shows all bind groups active at selected draw/dispatch (group 0, 1, 2, 3)

**Dependencies**: P5-RESULT-SHELL, P5-RESOURCE

#### P5-RENDERPASS — Implement render pass descriptor viewer
**Description**: Show render pass configuration: color attachments, depth/stencil attachment, load/store ops.
**Files**: `src/extension/resultView/components/RenderPassViewer.tsx`
**Acceptance Criteria**:
- Shows each color attachment: view (texture), resolveTarget, loadOp, storeOp, clearValue (as RGBA)
- Shows depth/stencil attachment: view, depthLoadOp, depthStoreOp, depthClearValue, depthReadOnly, stencilLoadOp, stencilStoreOp, stencilClearValue, stencilReadOnly
- Color clear values shown as both RGBA values and color swatch
- Load/store ops highlighted: "load" (neutral), "clear" (blue), "store" (green), "discard" (red/warning)
- Shows render pass label and timestamp/occlusion query sets if present

**Dependencies**: P5-RESULT-SHELL

#### P5-TEXTURE-PREVIEW — Implement texture preview component
**Description**: Display captured texture contents as visual images.
**Files**: `src/extension/resultView/components/TexturePreview.tsx`
**Acceptance Criteria**:
- Renders texture data as an image in an HTML canvas or img element
- Supports rgba8unorm and bgra8unorm formats
- Shows texture dimensions and format below preview
- Zoom controls (fit, 1:1, zoom in/out)
- Checkerboard background for transparent textures
- Shows "No preview available" for unsupported formats
- Shows mip level selector if texture has multiple mip levels
- Click to expand to full-screen overlay

**Dependencies**: P5-RESULT-SHELL, P3-READBACK

---

### Phase 6: UI — Popup

#### P6-POPUP — Implement extension popup UI
**Description**: Small popup that shows WebGPU detection status and capture button.
**Files**: `src/extension/popup/popup.tsx`, `src/extension/popup/components/PopupApp.tsx`, `src/extension/popup/components/StatusIndicator.tsx`, `src/extension/popup/components/CaptureButton.tsx`, `src/styles/popup.scss`
**Acceptance Criteria**:
- Shows "WebGPU Detected" (green) or "No WebGPU" (gray) indicator
- "Capture Frame" button: enabled only when WebGPU is detected, disabled during capture
- Shows capture progress: "Capturing..." spinner during capture
- After capture: shows "View Capture" link that opens result tab
- Shows device info summary: adapter name, device limits
- Dark theme consistent with result view
- Compact layout (~300×200px)

**Dependencies**: P5-RESULT-SHELL, P4-BACKGROUND

---

### Phase 7: Testing

#### P7-TEST-MOCK — Create WebGPU API mock for testing
**Description**: Comprehensive mock of the WebGPU API that simulates real behavior for unit testing.
**Files**: `test/__mocks__/webgpuMock.ts`, `test/fixtures/sampleCapture.ts`, `test/fixtures/sampleWgsl.ts`
**Acceptance Criteria**:
- Mock `navigator.gpu` with `requestAdapter()` → mock `GPUAdapter`
- Mock `GPUAdapter.requestDevice()` → mock `GPUDevice`
- Mock `GPUDevice.create*()` methods → return mock objects with correct shapes
- Mock `GPUCommandEncoder.beginRenderPass()` → mock `GPURenderPassEncoder`
- Mock `GPUQueue.submit()` → no-op
- All mocks have configurable return values
- `sampleCapture.ts`: pre-built ICapture with realistic command tree for UI testing
- `sampleWgsl.ts`: sample vertex/fragment/compute WGSL shaders

**Dependencies**: P0-TYPES

#### P7-TEST-PROXY — Tests for proxy wrapper and origin store
**Description**: Unit tests for the core proxy mechanism.
**Files**: `test/core/proxy/proxyWrapper.test.ts`, `test/core/proxy/originStore.test.ts`
**Acceptance Criteria**:
- Tests: proxy intercepts method calls
- Tests: proxy passes through unintercepted properties
- Tests: proxy handles async methods (returns Promise)
- Tests: origin store saves and restores original methods
- Tests: origin store callOriginal invokes the real method
- Tests: WeakMap cleanup when proxy targets are GC'd
- Tests: proxy works with prototype-based objects

**Dependencies**: P1-PROXY, P7-TEST-MOCK

#### P7-TEST-SPIES — Tests for spy layer
**Description**: Unit tests for gpuSpy, deviceSpy, encoderSpy, renderPassSpy, computePassSpy.
**Files**: `test/core/spies/gpuSpy.test.ts`, `test/core/spies/deviceSpy.test.ts`, `test/core/spies/encoderSpy.test.ts`, `test/core/spies/renderPassSpy.test.ts`, `test/core/spies/computePassSpy.test.ts`
**Acceptance Criteria**:
- gpuSpy: tests adapter/device interception with mocks
- deviceSpy: tests all create* method interception, verifies observables fire
- encoderSpy: tests beginRenderPass/beginComputePass/finish interception
- renderPassSpy: tests draw/drawIndexed/setPipeline/setBindGroup recording
- computePassSpy: tests dispatchWorkgroups/setPipeline recording
- Tests verify original API behavior is preserved (return values, side effects)
- Tests verify observables fire with correct data
- Tests verify error handling (device lost, invalid descriptors)

**Dependencies**: P1-RENDER-SPY, P1-COMPUTE-SPY, P7-TEST-MOCK

#### P7-TEST-CAPTURE — Tests for capture session and command tree
**Description**: Unit tests for capture session lifecycle and command tree structure.
**Files**: `test/core/capture/captureSession.test.ts`, `test/core/capture/commandNode.test.ts`, `test/core/capture/frameDetector.test.ts`
**Acceptance Criteria**:
- commandNode: tests tree construction, addChild, flatten, serialization, findById
- frameDetector: tests rAF-based frame detection, submit-based detection
- captureSession: tests start→record→stop lifecycle
- captureSession: tests command tree is correctly hierarchical (submit→encoder→pass→draw)
- captureSession: tests ICapture output contains all expected fields
- captureSession: tests capture of exactly 1 frame
- Tests handle edge cases: empty frames, multiple submits per frame

**Dependencies**: P3-CAPTURE, P7-TEST-MOCK

#### P7-TEST-RECORDERS — Tests for resource recorders
**Description**: Unit tests for all resource recorders.
**Files**: `test/core/recorders/bufferRecorder.test.ts`, `test/core/recorders/textureRecorder.test.ts`, `test/core/recorders/shaderRecorder.test.ts`
**Acceptance Criteria**:
- bufferRecorder: tests creation tracking, size tracking, destroy cleanup
- textureRecorder: tests creation with format/size/usage, destroy cleanup
- shaderRecorder: tests WGSL source capture, compilation info storage
- All recorders: tests resource ID assignment and lookup
- All recorders: tests serialization output

**Dependencies**: P2-RECORDERS, P7-TEST-MOCK

#### P7-TEST-INTEGRATION — Integration test for full capture flow
**Description**: End-to-end test that simulates a WebGPU application, performs a capture, and verifies the output.
**Files**: `test/integration/fullCapture.test.ts`, `test/integration/proxyTransparency.test.ts`
**Acceptance Criteria**:
- fullCapture: creates mock WebGPU app (requestAdapter → requestDevice → create resources → encode commands → submit), triggers capture, verifies ICapture has correct tree structure with all resources
- proxyTransparency: verifies that all proxied operations return the same types/values as the originals
- proxyTransparency: verifies that the mock app runs identically with and without SpectorGPU installed
- Tests run without a real GPU (all mocked)

**Dependencies**: P3-ORCHESTRATOR, P7-TEST-MOCK

#### P7-TEST-UI — Tests for React UI components
**Description**: Component tests for key result view components.
**Files**: `test/ui/CommandTree.test.tsx`, `test/ui/ShaderViewer.test.tsx`, `test/ui/PipelineInspector.test.tsx`
**Acceptance Criteria**:
- CommandTree: renders sample capture, expand/collapse works, selection callback fires
- ShaderViewer: renders WGSL source, shows line numbers, copy button works
- PipelineInspector: renders pipeline descriptor, sections are collapsible
- Uses React Testing Library + jsdom
- Uses sample fixture data (sampleCapture.ts)

**Dependencies**: P5-CMD-TREE, P5-SHADER, P5-PIPELINE, P7-TEST-MOCK

---

### Phase 8: Documentation

#### P8-README — Write project README
**Description**: Comprehensive README with project overview, installation, usage, development setup.
**Files**: `README.md`
**Acceptance Criteria**:
- Project description and motivation
- Screenshot/mockup of the extension in action (placeholder until real screenshots available)
- Installation instructions (from Chrome Web Store + manual load unpacked)
- Usage guide: how to detect WebGPU, capture a frame, navigate the result view
- Development setup: clone, install, build, load extension, run tests
- Architecture overview with diagram (reference docs/architecture.md for details)
- Contributing section (reference docs/contributing.md)
- License section

**Dependencies**: P6-POPUP (all features complete)

#### P8-ARCHITECTURE — Write architecture documentation
**Description**: Detailed architecture document explaining the proxy layer, capture pipeline, extension communication, and UI data flow.
**Files**: `docs/architecture.md`
**Acceptance Criteria**:
- System diagram showing all components and their relationships
- Proxy layer explanation: how each spy works, what it intercepts, how proxies chain
- Capture pipeline: frame detection → command recording → resource snapshot → serialization
- Extension communication: MAIN world ↔ ISOLATED world ↔ background ↔ UI with message types
- Data flow: how ICapture travels from page context to result view
- Design decisions and rationale (reference plan.md decisions)
- Comparison with Spector.js approach (what changed and why)

**Dependencies**: P4-BACKGROUND

#### P8-CAPTURE-FORMAT — Document the capture data format
**Description**: Specification of the ICapture JSON format for interoperability and future export features.
**Files**: `docs/capture-format.md`
**Acceptance Criteria**:
- Complete JSON schema for ICapture
- Description of each field with types and example values
- Command node type hierarchy with examples
- Resource info format per type (buffer, texture, sampler, shader, pipeline, bindGroup)
- Example complete capture JSON (abbreviated but realistic)
- Versioning strategy for the format

**Dependencies**: P3-CAPTURE

#### P8-CONTRIBUTING — Write contributor guide
**Description**: Guide for new contributors: development workflow, coding standards, PR process.
**Files**: `docs/contributing.md`
**Acceptance Criteria**:
- Development environment setup (Node.js version, Chrome version)
- Build and test commands
- Code style guide (reference .eslintrc.js and .prettierrc)
- How to add a new spy (step-by-step)
- How to add a new UI panel (step-by-step)
- PR guidelines: what to include, how to test
- Issue templates reference

**Dependencies**: P0-INIT

---

## Dependencies Graph

```
P0-INIT
  ├→ P0-TYPES
  │    ├→ P1-PROXY
  │    │    ├→ P1-GPU-SPY
  │    │    │    ├→ P1-DEVICE-SPY
  │    │    │    │    ├→ P1-QUEUE-SPY
  │    │    │    │    ├→ P1-ENCODER-SPY
  │    │    │    │    │    ├→ P1-RENDER-SPY
  │    │    │    │    │    └→ P1-COMPUTE-SPY
  │    │    │    │    └→ P2-RECORDER-INTEGRATION
  │    │    │    │         └→ P3-CAPTURE
  │    │    │    │              └→ P3-ORCHESTRATOR
  │    │    │    │                   ├→ P4-CONTENT-MAIN
  │    │    │    │                   │    └→ (P4-CONTENT-ISOLATED → P4-BACKGROUND)
  │    │    │    │                   └→ P7-TEST-INTEGRATION
  │    │    └→ P1-CANVAS-SPY
  │    ├→ P2-CMD-NODE
  │    │    └→ P3-CAPTURE
  │    ├→ P2-RECORDERS
  │    │    └→ P2-RECORDER-INTEGRATION
  │    ├→ P7-TEST-MOCK
  │    │    ├→ P7-TEST-PROXY
  │    │    ├→ P7-TEST-SPIES
  │    │    ├→ P7-TEST-CAPTURE
  │    │    ├→ P7-TEST-RECORDERS
  │    │    ├→ P7-TEST-INTEGRATION
  │    │    └→ P7-TEST-UI
  │    └→ P3-READBACK
  │         └→ P5-TEXTURE-PREVIEW
  ├→ P0-UTILS
  │    ├→ P1-PROXY
  │    ├→ P2-RECORDERS
  │    └→ P3-FRAME-DETECT
  │         └→ P3-CAPTURE
  ├→ P4-MANIFEST
  │    └→ P4-CONTENT-ISOLATED
  │         └→ P4-BACKGROUND
  │              ├→ P5-RESULT-SHELL
  │              │    ├→ P5-CMD-TREE → P7-TEST-UI
  │              │    ├→ P5-CMD-DETAIL
  │              │    ├→ P5-SHADER → P5-PIPELINE
  │              │    ├→ P5-RESOURCE → P5-BINDGROUP
  │              │    ├→ P5-RENDERPASS
  │              │    └→ P5-TEXTURE-PREVIEW
  │              ├→ P6-POPUP → P8-README
  │              └→ P8-ARCHITECTURE
  └→ P8-CONTRIBUTING
```

### Parallelization Opportunities

These task groups can be done **in parallel** by different developers:

1. **Proxy/Spy layer** (P1-*): Sequential within itself, but independent of UI work
2. **UI components** (P5-CMD-TREE through P5-TEXTURE-PREVIEW): All parallel once P5-RESULT-SHELL is done
3. **Testing** (P7-*): Can start P7-TEST-MOCK in parallel with Phase 1, tests follow their subjects
4. **Documentation** (P8-*): P8-CONTRIBUTING and P8-CAPTURE-FORMAT can start early

---

## Risk Assessment

### High Risk

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Proxy breaks WebGPU apps** | Critical — extension is useless if it crashes pages | Medium | Extensive proxy transparency testing (P7-TEST-INTEGRATION). Use ES6 Proxy with careful trap implementation. Test against real WebGPU apps (Babylon.js, Three.js, wgpu samples). Fail-safe: if proxy errors, disable and reload. |
| **Async interception complexity** | High — incorrect async handling could lose commands or deadlock | High | Design async-aware proxy from day 1. Every Promise-returning method must be handled. Write specific async edge case tests. Consider using AsyncLocalStorage-like patterns for context tracking. |
| **Large capture data transfer** | High — captures with many textures could exceed message size limits | Medium | Chunk large captures before transfer. Use `chrome.storage.local` (unlimited) as intermediary. Defer texture readback to on-demand (only read textures user clicks on). |

### Medium Risk

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **WebGPU API changes** | Medium — spec is still evolving in some areas | Low (spec is stable as of 2024) | Pin to current Chrome stable API. Abstract WebGPU types behind our own interfaces. Monitor spec changes. |
| **Performance overhead during capture** | Medium — texture readback and command recording could cause jank | Medium | Readback is async (non-blocking). Command recording is lightweight (just store descriptors). Profile with real apps. Add "lightweight capture" mode that skips texture readback. |
| **Manifest v3 service worker limitations** | Medium — service workers can be terminated by Chrome | Low | Keep service worker stateless. Use `chrome.storage.local` for persistent state. Handle service worker restart gracefully. |
| **Texture format support** | Medium — many WebGPU texture formats exist | Low for MVP | MVP supports rgba8unorm and bgra8unorm only. Show "unsupported format" for others. Add formats incrementally. |

### Low Risk

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **React/Webpack version conflicts** | Low | Low | Pin all dependency versions. Use lock file. |
| **Cross-browser compatibility** | Low for MVP (Chrome only) | N/A | Explicitly out of scope for MVP. Firefox WebGPU is behind a flag. |

---

## Open Questions

1. **Should we support OffscreenCanvas WebGPU contexts?** Some apps use workers + OffscreenCanvas for WebGPU. This adds complexity (worker content script injection). **Recommendation**: Defer to post-MVP.

2. **Should texture readback be eager or lazy?** Eager = capture all texture data during frame capture (large data, slow). Lazy = only readback when user clicks a texture in the UI (requires keeping page alive). **Recommendation**: Lazy for MVP — capture metadata only, readback on demand if page is still alive. Fall back to "no preview" if page navigated away.

3. **How to handle multiple GPUDevices on one page?** Some apps create multiple devices (e.g., separate compute device). **Recommendation**: Track all devices, but capture one at a time. Popup shows device selector if multiple detected.

4. **Should we capture command buffer reuse?** WebGPU allows reusing command buffers across frames. Do we track this? **Recommendation**: For MVP, capture what's submitted each frame regardless of reuse. Don't try to deduplicate.

5. **How to handle WebGPU in iframes?** Content scripts with `all_frames: true` handle this, but each frame gets its own SpectorGPU instance. **Recommendation**: Support it via `all_frames: true` in manifest, but MVP focuses on main frame.

6. **WGSL syntax highlighting approach?** Options: (a) use a lightweight WGSL tokenizer, (b) use Monaco editor, (c) use CodeMirror, (d) plain text with line numbers. **Recommendation**: Plain text for MVP (P5-SHADER), add syntax highlighting post-MVP with a lightweight tokenizer.

---

## Out of Scope (MVP)

- ❌ Firefox/Safari support
- ❌ Compute pipeline debugging (basic recording yes, but no dispatch result inspection)
- ❌ Buffer content hex viewer
- ❌ Performance timing/profiling per command
- ❌ State diff view (before/after each command)
- ❌ Export capture as JSON file
- ❌ WGSL shader syntax highlighting
- ❌ Shader editing/hot-reload
- ❌ WebGPU in Web Workers / OffscreenCanvas
- ❌ Render bundle recording details
- ❌ Timestamp query readback
- ❌ Multi-frame capture (only single frame for MVP)
- ❌ Capture comparison (diff two captures)
- ❌ Network distribution of SpectorGPU (npm package / CDN) — extension only for MVP

---

## Estimated Effort

| Phase | Tasks | Est. Effort | Can Parallelize? |
|-------|-------|-------------|-----------------|
| P0: Bootstrap | 3 tasks | 1 day | No (foundational) |
| P1: Proxy Layer | 8 tasks | 4-5 days | Sequential (each spy depends on previous) |
| P2: Recording | 3 tasks | 2-3 days | Partially (P2-CMD-NODE parallel with P2-RECORDERS) |
| P3: Capture | 4 tasks | 3-4 days | Partially (P3-READBACK parallel with P3-FRAME-DETECT) |
| P4: Extension | 4 tasks | 2-3 days | Sequential |
| P5: Result View | 9 tasks | 5-6 days | Highly parallel (all panels after shell) |
| P6: Popup | 1 task | 1 day | After P5-RESULT-SHELL |
| P7: Testing | 7 tasks | 4-5 days | Highly parallel |
| P8: Documentation | 4 tasks | 2-3 days | Mostly parallel |
| **Total** | **43 tasks** | **~24-30 days** (1 developer) / **~12-15 days** (2 developers) |

---

## Implementation Order (Recommended)

**Week 1**: P0-INIT → P0-TYPES → P0-UTILS → P1-PROXY → P1-GPU-SPY → P1-DEVICE-SPY
**Week 2**: P1-QUEUE-SPY → P1-ENCODER-SPY → P1-RENDER-SPY → P1-COMPUTE-SPY → P1-CANVAS-SPY
**Week 3**: P2-CMD-NODE → P2-RECORDERS → P2-RECORDER-INTEGRATION → P3-FRAME-DETECT → P3-CAPTURE → P3-READBACK → P3-ORCHESTRATOR
**Week 4**: P4-MANIFEST → P4-CONTENT-MAIN → P4-CONTENT-ISOLATED → P4-BACKGROUND → P5-RESULT-SHELL
**Week 5**: P5-CMD-TREE → P5-CMD-DETAIL → P5-SHADER → P5-PIPELINE → P5-RESOURCE → P5-BINDGROUP → P5-RENDERPASS → P5-TEXTURE-PREVIEW → P6-POPUP
**Week 6**: P7-TEST-MOCK → P7-TEST-PROXY → P7-TEST-SPIES → P7-TEST-CAPTURE → P7-TEST-RECORDERS → P7-TEST-INTEGRATION → P7-TEST-UI → P8-* docs
