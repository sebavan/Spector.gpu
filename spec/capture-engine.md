# Spector.GPU — Capture Engine Specification

Details the capture pipeline from WebGPU API interception to final ICapture output.

## Spy System

### Method Patching (`src/core/proxy/methodPatcher.ts`)

All WebGPU interception uses `patchMethod(target, methodName, options)`:
- Replaces the method on the target instance (NOT Proxy — avoids brand-check failures)
- The original is `.bind(target)` so `this` is always the real GPU object
- `before(methodName, args)` — can return a new args array to modify arguments
- `after(methodName, args, result, target)` — fires after the original call
- `afterResolve(methodName, args, result, target)` — for async methods (Promise resolution)
- `isAsync: true` — wraps Promise-returning methods

### OriginStore (`src/core/proxy/originStore.ts`)

`globalOriginStore.save(target, methodName)` — saves the current method before patching.
`globalOriginStore.getOriginal(target, methodName)` — retrieves the saved original.
`globalOriginStore.has(target, methodName)` — idempotency check.

### Spy Classes

| Spy | Target | Methods Patched |
|-----|--------|----------------|
| `GpuSpy` | `GPU.prototype` | `requestAdapter` (wraps return to spy on device creation) |
| `DeviceSpy` | `GPUDevice` instance | `createBuffer`, `createTexture`, `createSampler`, `createShaderModule`, `createRenderPipeline`, `createRenderPipelineAsync`, `createComputePipeline`, `createComputePipelineAsync`, `createBindGroup`, `createBindGroupLayout`, `createCommandEncoder`, `pushErrorScope`, `popErrorScope`, `destroy` |
| `QueueSpy` | `GPUQueue` instance | `submit`, `writeBuffer`, `writeTexture` |
| `EncoderSpy` | `GPUCommandEncoder` instance | `beginRenderPass`, `beginComputePass`, `finish`, + all transfer/debug methods |
| `RenderPassSpy` | `GPURenderPassEncoder` instance | All render pass methods (draw, setPipeline, setBindGroup, setVertexBuffer, etc.) |
| `ComputePassSpy` | `GPUComputePassEncoder` instance | All compute pass methods |
| `CanvasSpy` | `HTMLCanvasElement.prototype` | `getContext` (detects 'webgpu' type, has reentrancy guard) |

### COPY_SRC Injection

**Textures**: `DeviceSpy.createTexture` `before` hook deep-clones descriptor via `structuredClone()`, adds `| 0x01` to usage.
**Buffers**: `DeviceSpy.createBuffer` `before` hook deep-clones descriptor via `structuredClone()`, adds `| 0x04` to usage. Skips MAP_READ/MAP_WRITE buffers (incompatible).

CRITICAL rules:
1. Descriptors must be **deep-cloned** via `structuredClone()` — NOT shallow spread (`{ ...desc }`). Shallow spread shares nested objects (e.g. `size`, `vertex.buffers`) by reference, which breaks engines that mutate descriptors after creation.
2. Return a new args array from the `before` hook: `return [clonedDesc]`
3. Buffer COPY_SRC = `0x0004` (GPUBufferUsage), Texture COPY_SRC = `0x01` (GPUTextureUsage) — different flag spaces! Using the wrong bit value will corrupt buffer creation.

### Late Device Discovery

Three strategies for finding the GPUDevice when the page creates it before our spy loads:
1. `GPUAdapter.prototype.requestDevice` — prototype-level patch
2. `GPUCanvasContext.prototype.configure` — captures device from config.device
3. `GPUCanvasContext.prototype.getCurrentTexture` — triggers canvas-based device scan
4. `GPUQueue.prototype.submit` — triggers DOM canvas scan for WebGPU contexts

## RecorderManager

Tracks all GPU resource lifecycle via WeakMap (object → ID) and Maps (ID → info).

### Key methods
- `trackObject(obj, prefix)` → assigns monotonic ID (`buf_0`, `tex_1`, etc.), also stores `WeakRef` for reverse lookup
- `recordBufferCreation/recordTextureCreation/etc.` → stores info in typed Maps
- `recordCanvasTexture(texture, format, w, h)` → only keeps the LATEST canvas texture (removes previous)
- `recordTextureDestroy/recordBufferDestroy` → adds ID to destroyed Sets
- `snapshot()` → returns filtered `IResourceMap` (skips destroyed + GC'd resources)
- `setTexturePreview(id, dataUrl)` / `setTextureFacePreviews(id, urls[])` → readback results
- `setBufferData(id, base64)` → readback results
- `getObject(id)` → reverse lookup via `WeakRef.deref()`
- `getTextures()` / `getBuffers()` → ReadonlyMap for readback iteration

## Capture Lifecycle

### 1. Arm (`captureNextFrame()`)
- Creates new `CommandTreeBuilder`
- Sets `_isCapturing = true`
- Starts timeout guard (`CAPTURE_TIMEOUT_MS = 30s`)

### 2. Record (spy events)
- `queue.submit` → `CommandType.Submit` node
- `encoder.beginRenderPass` → pushScope `CommandType.RenderPass`
- `renderPass.draw*` → addCommand `CommandType.Draw` + state snapshot
- `renderPass.end` → popScope
- Same pattern for compute passes

### 3. Finalize (`_finalizeCapture()`, async, triggered from queue.submit microtask)
- Sets `_isCapturing = false` (prevents re-entry)
- `_readbackTextures()`:
  - Filters: skip canvas/destroyed/MSAA/non-2D/depth/compressed, max 16, need COPY_SRC
  - Cubemaps: detected by `depthOrArrayLayers === 6` AND confirmed via `hasTextureCubeView()` — checks if any texture view of this texture has dimension `cube` or `cube-array`. This prevents false positives on 6-layer array textures (e.g. cascaded shadow maps).
  - Per-texture: pushErrorScope → createBuffer(MAP_READ|COPY_DST) → copyTextureToBuffer → submit → popErrorScope
  - Parallel mapAsync with 5s timeout
  - Convert pixels: format-specific → RGBA8 → 128px PNG thumbnail
  - Budget: 4MB total preview data. Uses `budgetExceeded` flag + `continue` (NOT `break`) so every task's `finally` block runs to clean up staging buffers.
- `_readbackBuffers()`:
  - Uses `selectBuffersForReadback()` from `readbackPriority.ts` to choose which buffers to read
  - **Priority order**: buffers referenced by draw/dispatch commands first (vertex, index, writeBuffer targets via deep `__id` scan), then unreferenced buffers
  - **Skips**: buffers that already have `dataBase64` (captured at upload time), destroyed, mapped, oversized, no COPY_SRC
  - Max 128 buffers per capture (raised from 32)
  - Per-buffer: pushErrorScope → createBuffer(MAP_READ|COPY_DST) → copyBufferToBuffer → submit → popErrorScope
  - mapAsync → getMappedRange → base64 encode
  - Budget: 32MB total, 16MB per buffer
- **writeBuffer upload capture** (in `_installSpyListeners`):
  - Subscribes to `queueSpy.onWriteBuffer` to capture buffer data at upload time (zero GPU cost)
  - For full-buffer writes (offset=0, size ≥ buffer.size): encodes data as base64 and stores via `setBufferData()`
  - Partial writes are skipped (handled by GPU readback fallback)
  - This captures vertex/index buffer data uploaded once at init time, before capture is armed
- `_buildCapture()`:
  - Attach canvas screenshot to render pass nodes
  - Freeze command tree
  - Snapshot resources
  - Return ICapture

### 4. Emit
- `onCaptureComplete.trigger(capture)`
- Content script serializes with `captureToJSON()` (converts Maps to Objects)
- Sends via window.postMessage → proxy → chrome.runtime → background
- Background stores in chrome.storage.local (auto-chunked at 4MB)

## Texture Format Conversion

21 formats supported for readback:

| Format | Bytes/pixel | Conversion |
|--------|-------------|------------|
| rgba8unorm, rgba8unorm-srgb | 4 | Direct copy |
| bgra8unorm, bgra8unorm-srgb | 4 | Swap R↔B |
| rgba8snorm, rgba8sint | 4 | Shift +128, alpha=255 |
| r8unorm/rg8unorm | 1-2 | Expand to RGB, alpha=255 |
| rgba16float | 8 | IEEE754 half → clamp [0,1] → ×255 |
| rgba32float | 16 | Clamp [0,1] → ×255 |
| r16float/rg16float | 2-4 | Half decode, expand channels |
| r32float/rg32float | 4-8 | Clamp, expand channels |
| rgb10a2unorm | 4 | Unpack 10-10-10-2 from u32 |

### float16 decoding
```
sign = (h >> 15) & 1
exp = (h >> 10) & 0x1F
mant = h & 0x3FF
if exp === 0: subnormal = (sign ? -1 : 1) * (mant / 1024) * 2^-14
if exp === 0x1F: Inf or NaN
else: (sign ? -1 : 1) * 2^(exp-15) * (1 + mant/1024)
```

## Argument Serialization

`serializeDescriptor(obj, idResolver?)` converts WebGPU call arguments to JSON-safe objects for storage in `ICommandNode.args`.

### IdResolver
An optional callback `(obj: object) => string | undefined` that resolves GPU objects to their tracked resource IDs. Passed from `SpectorGPU._idResolver` which delegates to `RecorderManager.getId()`.

### GPU Object Serialization
When `isGPUObject(obj)` returns true (constructor name starts with "GPU"), the serializer produces:
```json
{ "__type": "GPUTextureView", "label": "myDepthView", "__id": "tv_3" }
```
- `__type`: constructor name (GPUTexture, GPURenderPipeline, GPUBuffer, etc.)
- `label`: the WebGPU debug label if present
- `__id`: the tracking ID from RecorderManager (only present if idResolver is provided and the object is tracked)

Without `__id`, GPU objects in command args render as dead text. With it, they render as clickable ResourceLinks in the UI.

### Where IdResolver is Passed
All command recording paths pass `this._idResolver`:
- `beginRenderPass` descriptor (color/depth attachment views become clickable)
- `beginComputePass` descriptor
- Encoder commands (`copyTextureToBuffer` src/dst → clickable)
- Render pass commands (`setPipeline`, `setBindGroup`, `setVertexBuffer` → clickable)
- Compute pass commands (`setPipeline`, `setBindGroup` → clickable)

### Bulk Field Filtering
The UI strips these fields before passing to JsonTree (they have dedicated viewers):
- `dataBase64` — shown in hex dump
- `code` — shown in shader editor
- `previewDataUrl` — shown as image preview
- `facePreviewUrls` — shown as cube face grid

### JsonTree GPU Object Rendering
When JsonTree encounters an object with `__type` + `__id`, it renders a compact linked summary instead of expanding the full JSON:
```
view: GPUTextureView "myDepthView" [tv_3]  ← clickable link
```

### No Circular Reference Detection in JsonTree
Capture data is serialized JSON — no actual circular references after `captureToJSON()`. The `MAX_DEPTH=10` limit provides sufficient protection against deep nesting. Previous `WeakSet`-based detection caused false positives (sibling objects incorrectly marked as `[Circular]` due to mutable WeakSet shared across React re-renders).

## Canvas Screenshot

Captured during `queue.submit` (back buffer still valid):
1. Use tracked `_webgpuCanvas` (from configure/getContext hooks)
2. Fallback: largest canvas on page (area heuristic)
3. Scale to max 256px wide
4. Validate pixel content (reject blank/expired buffers)
5. Export as PNG data URL
