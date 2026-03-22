# Spector.GPU — UI Components Specification

React 19 result viewer component tree and behavior.

## Layout Structure

```
ResultApp
├── CaptureHeader (stats badges: commands, draws, passes, textures, duration)
├── SidebarPanel (left, width via state, min 200px, max 500px)
│   ├── ModeToggle ("COMMANDS" | "RESOURCES")
│   ├── [Commands mode] CommandTree
│   │   └── TreeNode (recursive, indented, expandable)
│   │       ├── toggle ▼/▶
│   │       ├── TypeBadge (SUB/RP/CP/DRW/DSP/PIP/BND/VTX/IDX/WRT/CPY/CMD)
│   │       ├── node-name (monospace)
│   │       ├── child-count
│   │       └── node-thumbnail (32×24px, if visualOutput)
│   └── [Resources mode] ResourceBrowser
│       └── ResGroup (per category, collapsible)
│           ├── ResGroupHeader (toggle, label, count)
│           └── ResourceItem (id, label, shader stage badges)
├── DraggableDivider (4px, accent on hover/drag)
└── RightPanel
    ├── Breadcrumb ("Commands › queue.submit › drawIndexed" or "Resources › Textures › tex_1")
    ├── [Commands mode] TabBar (Details | Shaders | Pipeline)
    │   ├── CommandDetail (info grid, args JsonTree, GPU state snapshot with ResourceLinks)
    │   ├── ShaderEditor (toolbar + dual-layer editor: transparent textarea over highlighted pre)
    │   └── PipelineInspector (vertex/fragment/compute stages, primitive, depth/stencil, layout)
    └── [Resources mode] ResourceDetail (dispatches by category)
        ├── [buffers] BufferDetail + UsedBySection
        │   ├── buffer-info-grid (ID, label, size, usage flags, state)
        │   ├── BufferMeshViewer (lazy Babylon.js, vertex buffers only)
        │   └── HexDump (address | hex | ascii, max 2KB display)
        ├── [textures] TextureThumbnail + JsonTree + UsedBySection
        │   ├── preview img (previewDataUrl or canvas screenshot for isCanvasTexture)
        │   ├── CubeFaceGrid (3×2 labeled grid for facePreviewUrls)
        │   └── texture-info-grid (format, dimension, size, mips, samples, usage)
        ├── [textureViews] TextureViewDetail + UsedBySection
        ├── [shaderModules] ShaderModuleDetail + UsedBySection
        └── [*] JsonTree + UsedBySection
```

## Component Details

### ResultApp (`ResultApp.tsx`)
State:
- `capture: ICapture | null`
- `selectedNode: ICommandNode | null`
- `activeTab: 'detail' | 'shader' | 'pipeline'`
- `sidebarMode: 'commands' | 'resources'`
- `selectedResourceCategory: ResourceCategory | null`
- `selectedResourceId: string | null`
- `leftPanelWidth: number` (default 320)

History integration: every selection/mode/tab change pushes `NavState` to `history.pushState`. `popstate` restores full UI state. Initial state uses `replaceState`. `restoringRef` prevents push during popstate.

NavigationContext: `navigateToResource(target)` switches sidebar to resources mode and selects the target.

### SidebarPanel (`SidebarPanel.tsx`)
- ModeToggle: segmented control, uppercase, accent underline on active
- ResourceBrowser: all groups collapsed by default. Auto-expands group when item selected via navigation.
- ResourceItem: scrolls into view on selection (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`)

### DraggableDivider (`DraggableDivider.tsx`)
- mousedown → track clientX, add full-viewport overlay (prevents text selection)
- mousemove → compute deltaX, call `onDrag(dx)`
- mouseup → cleanup overlay, remove listeners
- All state in `useRef` (zero allocations per mouse event)
- **Must clean up document listeners on unmount** — if component unmounts mid-drag, `useEffect` cleanup must remove mousemove/mouseup from document

### BufferMeshViewer (`BufferMeshViewer.tsx`)
- **Lazy-loaded** via `React.lazy(() => import('./BufferMeshViewer'))` with error fallback
- Finds vertex layout: DFS search through command tree for draw calls binding this buffer → resolve pipeline → get `vertex.buffers[slot]`
- Parses positions (shaderLocation 0 or first float32x3/x4 attribute) via DataView.getFloat32
- Optionally parses normals (shaderLocation 1)
- Creates Babylon.js Mesh + VertexData + StandardMaterial (accent color #4fc3f7)
- **Wireframe**: Uses `MeshBuilder.CreateLineSystem` (actual GL_LINES) — not `mat.wireframe` which doesn't work with tree-shaking. Creates two meshes: wireMesh (lines) + solidMesh (triangles). Render mode toggle switches visibility.
- **Index buffer**: Resolves `indexBufferId` from the draw call, decodes base64, passes uint16/uint32 data for proper shared-vertex wireframe.
- **Render modes**: wireframe (line mesh visible), solid (triangle mesh, lighting enabled), points (triangle mesh with pointsCloud=true, pointSize=3)
- **Toolbar**: Wireframe / Solid / Points toggle buttons + Reset Camera
- **Stats bar**: vertex count, bounding box min/max
- ArcRotateCamera auto-framed on bounding box
- **Resize handler must guard against disposed engine** — use `disposedRef`
- **CSP**: Manifest V3 does NOT allow `unsafe-eval`. Babylon.js must work without it. If it fails, `React.lazy` error boundary catches gracefully.

### BufferDetail Layout
The buffer detail view uses a specific flex layout to eliminate outer scrolling:

```
buffer-detail (flex column, height:100%)
├── buffer-info-grid (flex-shrink:0)
├── LayoutInfoCard (flex-shrink:0, if vertex buffer with resolved layout)
├── 3D viewer (flex-shrink:0, 300px height)
└── buffer-data-panels (flex:1, flex row, min-height:0)
    ├── buffer-data-left (flex:1, internal scroll)
    │   └── VertexDataTable / Float32Table / HexDump
    └── buffer-data-right (flex:1, internal scroll)
        └── HexDump
```

**Critical CSS rules for no-outer-scroll layout:**
- `tab-content:has(.buffer-detail)` → `overflow-y: hidden` — kills the outer scrollbar
- Both data panels: `flex:1; min-height:0` — fill remaining vertical space
- `hex-dump-section` and `vertex-table-section`: `display:flex; flex-direction:column; flex:1; min-height:0`
- Inner scrollable elements (`.hex-dump`, `.vertex-table-wrap`): `flex:1; overflow:auto; max-height:none`

### Vertex Data Table Colors
```
.attr-pos  → #4ec9b0 (teal — position attributes)
.attr-norm → #c586c0 (purple — normal attributes)
.attr-uv   → #dcdcaa (yellow — UV/texcoord attributes)
.vtx-idx   → $text-muted (row index)
```

### JsonTree (`JsonTree.tsx`)
- Recursive collapsible JSON viewer, max depth 10
- Color-coded: keys (#9cdcfe), strings (#ce9178), numbers (#b5cea8), booleans (#569cd6), null (#808080)
- **Auto-links resource IDs**: `maybeResourceLink(value)` checks if a string matches `^(buf|tex|tv|smp|shd|rp|cp|bg|bgl)_\d+$` — if yes, renders as clickable ResourceLink
- **GPU object compact rendering**: Objects with `__type` + `__id` fields (from serialized GPU objects) render as a one-line linked summary: `GPUTextureView "label" [tv_3]` instead of expanding full JSON
- **No circular reference detection**: Removed WeakSet (caused false positives from React re-renders). MAX_DEPTH=10 is sufficient. See capture-engine.md for rationale.
- **Bulk field filtering**: Applied by ResourceDetail before passing to JsonTree — strips `dataBase64`, `code`, `previewDataUrl`, `facePreviewUrls`

### CommandTreeBuilder (`src/core/capture/commandTree.ts`)
- `popScope()` must validate the scope stack is not empty — log a warning on underflow instead of returning silent `undefined`. Helps debug mismatched begin/end spy events.

### ResourceLink (`ResourceLink.tsx`)
- Clickable resource ID that navigates to the resource via NavigationContext
- Dotted underline, accent color on hover

### CommandLink (`ResourceLink.tsx`)
- Clickable command label that navigates to a command node via CommandNavigationContext
- Switches sidebar to Commands mode, selects the command, and pushes browser history
- Reuses `.resource-link` CSS class for consistent visual styling

### UsedBySection (`ResourceDetail.tsx`)
- Reverse cross-reference list: shows all commands and resources that reference the current resource
- Rendered on **every** resource type: buffers, textures, texture views, shader modules, pipelines, bind groups, etc.
- Resources rendered as `<ResourceLink>` + label; commands rendered as `<CommandLink>`
- Hidden (returns null) when no usages exist
- Data sourced from `buildUsageIndex()` — an O(n) reverse-lookup map built once per capture

### Usage Index (`usageIndex.ts`)
- `buildUsageIndex(capture)` scans the full command tree and resource graph, producing a `Map<string, UsageEntry[]>` — resource-id → list of referrers
- **Command scan** tracks: `pipelineId`, `indexBufferId`, `vertexBuffers[]`, `bindGroups[]`, plus deep `__id` extraction from serialized args (handles `writeBuffer`, `copyBufferToBuffer`, `beginRenderPass` descriptors, etc.)
- **Resource scan** tracks: render/compute pipeline → shader modules, bind group → buffer/texture/sampler entries, texture view → parent texture, pipeline → layout
- Deep `__id` scan: `collectIds()` recursively walks the full args object/array tree to find all serialized GPU object references (`{ __type, __id }`)
- Deduplicates entries: same referrer (id + type) appears at most once per target

### ShaderEditor (`ShaderEditor.tsx`)
- Dual-layer architecture: transparent `<textarea>` over highlighted `<pre>` (pixel-aligned)
- Line-number gutter (48px) with current-line highlight
- Toolbar: Edit toggle, Revert (if modified), Copy
- Tab → 4 spaces, Enter → auto-indent
- WGSL syntax highlighting via regex tokenizer (keywords, types, decorators, builtins, numbers, strings, comments)

## WGSL Syntax Highlighting Classes
```
.wgsl-keyword    → #c586c0 (purple-pink)
.wgsl-type       → #4ec9b0 (teal)
.wgsl-decorator  → #dcdcaa (yellow)
.wgsl-builtin    → #dcdcaa
.wgsl-function   → #dcdcaa
.wgsl-number     → #b5cea8 (green)
.wgsl-string     → #ce9178 (orange)
.wgsl-comment    → #6a9955 (green, italic)
.wgsl-punctuation → #808080
```

## Command Type Badge Colors
```
Submit:      #ff9800 (orange)
RenderPass:  #4caf50 (green)
ComputePass: #9c27b0 (purple)
Draw:        #2196f3 (blue)
Dispatch:    #e91e63 (pink)
State:       #607d8b (gray-blue)
Other:       $text-muted
```

## Navigation Context
```typescript
type ResourceCategory = 'buffers' | 'textures' | 'textureViews' | 'samplers'
    | 'shaderModules' | 'renderPipelines' | 'computePipelines'
    | 'bindGroups' | 'bindGroupLayouts';

interface NavigationTarget {
    readonly category: ResourceCategory;
    readonly id: string;
}
```

ResourceNavigationContext: `navigateToResource(target)` switches sidebar to resources mode and selects the target. Used by `ResourceLink`.

CommandNavigationContext: `navigateToCommand(commandId)` finds the command node by DFS, switches sidebar to commands mode, selects the node, and pushes browser history. Used by `CommandLink`.
