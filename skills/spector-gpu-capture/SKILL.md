---
name: spector-gpu-capture
description: |
  Capture and analyze WebGPU frames from any URL. Injects the Spector.GPU
  content script via Playwright, captures one frame of GPU commands, and
  returns structured data: command tree, textures, buffers, shaders, pipelines.
  Use for debugging WebGPU rendering issues, analyzing performance, or
  inspecting GPU resource usage.
  Input: a URL to capture and optionally what to analyze.
allowed-tools: Bash(node:*), Bash(npx:*)
---

# Spector.GPU Capture

Captures a WebGPU frame from any URL and returns structured analysis data.

## Prerequisites

The Spector.GPU extension must be built first:

```bash
cd E:\spector-gpu && npm run build
```

The capture CLI dependencies must be installed:

```bash
cd E:\spector-gpu/skills/spector-gpu-capture && npm install
```

## Usage

### Quick summary of a WebGPU page

```bash
node E:\spector-gpu\skills\spector-gpu-capture\capture-cli.js <URL> --summary
```

### Full capture to file

```bash
node E:\spector-gpu\skills\spector-gpu-capture\capture-cli.js <URL> --output capture.json
```

### With texture previews and buffer data

```bash
node E:\spector-gpu\skills\spector-gpu-capture\capture-cli.js <URL> --summary --textures --buffers
```

### With screenshot

```bash
node E:\spector-gpu\skills\spector-gpu-capture\capture-cli.js <URL> --summary --screenshot page.png
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--output, -o <file>` | Write capture JSON to file | stdout |
| `--screenshot, -s <file>` | Save page screenshot | — |
| `--wait, -w <ms>` | Wait before capture | 5000 |
| `--timeout, -t <ms>` | Capture timeout | 30000 |
| `--summary` | Output summary instead of full JSON | false |
| `--textures` | Include texture preview data URLs | false |
| `--buffers` | Include buffer base64 data | false |
| `--headed` | Show browser window | false |

## Output format (--summary)

The summary JSON contains:
- **adapter**: GPU vendor, architecture
- **stats**: command count, draw calls, dispatches, render/compute passes
- **commandTree**: indented outline of the frame's command hierarchy (up to depth 3)
- **textures**: list with format, size, usage flags, preview availability, cube detection
- **buffers**: list with size, usage flags (VERTEX, INDEX, UNIFORM, etc.), data availability
- **shaderModules**: list with full WGSL source code, line counts, and compilation messages
- **pipelines**: render and compute pipeline IDs

## Example workflow

```
User: "Why is my WebGPU scene rendering slowly on https://myapp.com?"

1. Capture a frame:
   node E:\spector-gpu\skills\spector-gpu-capture\capture-cli.js https://myapp.com --summary

2. Analyze the output:
   - Check draw call count (>500 is high)
   - Check texture sizes (4096×4096 textures consume lots of VRAM)
   - Check buffer sizes (large vertex buffers suggest missing LOD)
   - Check render pass count (redundant passes waste GPU time)
   - Check shader module count and complexity
   - Review WGSL shader source for performance anti-patterns (excessive branching, unrolled loops, unnecessary barriers)
   - Check compilationInfo for warnings that may hint at issues

3. Report findings and suggest optimizations
```

## Troubleshooting

- **"Content script not found"**: Run `npm run build` in the Spector.GPU root first
- **"No WebGPU adapter detected"**: The page doesn't use WebGPU, or headless Chrome lacks GPU. Try `--headed`
- **Capture timeout**: Increase `--wait` if the scene takes longer to load
- **No texture previews**: Add `--textures` flag (excluded by default to reduce output size)
