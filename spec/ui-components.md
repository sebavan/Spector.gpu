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
        ├── [buffers] BufferDetail
        │   ├── buffer-info-grid (ID, label, size, usage flags, state)
        │   ├── BufferMeshViewer (lazy Babylon.js, vertex buffers only)
        │   └── HexDump (address | hex | ascii, max 2KB display)
        ├── [textures] TextureThumbnail + JsonTree
        │   ├── preview img (previewDataUrl or canvas screenshot for isCanvasTexture)
        │   ├── CubeFaceGrid (3×2 labeled grid for facePreviewUrls)
        │   └── texture-info-grid (format, dimension, size, mips, samples, usage)
        ├── [textureViews] TextureViewDetail (lookup parent texture → TextureThumbnail + view JsonTree)
        ├── [shaderModules] ShaderModuleDetail (header + code container + compilation messages)
        └── [*] JsonTree (collapsible JSON viewer)
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

### BufferMeshViewer (`BufferMeshViewer.tsx`)
- **Lazy-loaded** via `React.lazy(() => import('./BufferMeshViewer'))` with error fallback
- Finds vertex layout: DFS search through command tree for draw calls binding this buffer → resolve pipeline → get `vertex.buffers[slot]`
- Parses positions (shaderLocation 0 or first float32x3/x4 attribute) via DataView.getFloat32
- Optionally parses normals (shaderLocation 1)
- Creates Babylon.js Mesh + VertexData + wireframe StandardMaterial (accent color #4fc3f7)
- ArcRotateCamera auto-framed on bounding box

### JsonTree (`JsonTree.tsx`)
- Recursive collapsible JSON viewer
- Color-coded: keys (#9cdcfe), strings (#ce9178), numbers (#b5cea8), booleans (#569cd6), null (#808080)
- Resource IDs rendered as clickable ResourceLinks

### ResourceLink (`ResourceLink.tsx`)
- Clickable resource ID that navigates to the resource via NavigationContext
- Dotted underline, accent color on hover

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
