# Spector.GPU Capture CLI

A command-line tool for AI agents to capture and introspect WebGPU frames from any page. Uses Playwright to inject the Spector.GPU content script and capture a frame without requiring the Chrome extension to be installed.

## Prerequisites

1. Build Spector.GPU first:
   ```bash
   cd /path/to/Spector.gpu
   npm install && npm run build
   ```

2. Install the CLI dependencies:
   ```bash
   cd skills/spector-gpu-capture
   npm install
   ```

## Usage

```bash
# Summary of a WebGPU frame
node capture-cli.js https://playground.babylonjs.com/?iswebgpu=true --summary

# Full capture to file
node capture-cli.js https://myapp.com --output capture.json

# Summary + screenshot
node capture-cli.js https://myapp.com --summary --screenshot page.png

# Include texture previews and buffer data
node capture-cli.js https://myapp.com --textures --buffers -o full-capture.json

# Headed mode (see the browser)
node capture-cli.js https://myapp.com --headed --summary
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

## Summary Output

The `--summary` flag produces a structured JSON with:
- **adapter** — GPU vendor, architecture, description
- **stats** — command count, draw calls, dispatches, render/compute passes
- **commandTree** — indented outline of the frame's command hierarchy
- **textures** — list with format, size, usage flags, preview availability
- **buffers** — list with size, usage flags, data availability
- **shaderModules** — list with line counts
- **pipelines** — render and compute pipeline IDs

## AI Agent Integration

This tool is designed to be called by AI agents for automated WebGPU debugging:

```
User: "Why is my WebGPU scene rendering slowly?"

Agent: Let me capture a frame and analyze it.
> spector-gpu-capture https://myapp.com --summary

Agent: I can see 847 commands with 128 draw calls across 6 render passes.
       There are 42 textures (3 are 4096×4096 rgba16float — that's a lot of VRAM).
       The vertex buffer buf_12 has 2.4M vertices — consider LOD or culling.
```

### As a Copilot CLI skill

Register in your `.copilot/skills/` config:
```yaml
name: spector-gpu-capture
description: Capture and analyze WebGPU frames from any URL for debugging
command: node /path/to/Spector.gpu/skills/spector-gpu-capture/capture-cli.js
```
