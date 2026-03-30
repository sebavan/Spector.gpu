# Spector.GPU MCP Server

MCP server for capturing and inspecting WebGPU frames. Holds a Playwright browser and capture state in memory so AI agents can navigate once, capture once, then query the data across multiple tool calls without re-capturing.

## Prerequisites

- Node.js 18+
- Build the Spector.GPU extension first:
  ```bash
  cd E:\spector-gpu && npm install && npm run build
  ```

## Installation

```bash
cd E:\spector-gpu\mcp
npm install
npm run build
```

## Configuration

Add to your MCP client config (e.g., Claude Desktop, Copilot CLI):

```json
{
  "mcpServers": {
    "spector-gpu": {
      "command": "node",
      "args": ["/path/to/spector-gpu/mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Description | Key Input |
|------|-------------|-----------|
| `navigate` | Open a URL in the browser | `url` (string), `wait` (ms, default 5000) |
| `capture` | Capture one WebGPU frame | `timeout` (ms, default 30000) |
| `get_commands` | Get the command tree | `depth` (int, default 10) |
| `get_resources` | List resources by category | `category` (optional) |
| `get_resource` | Get one resource by ID | `id` (e.g., "buf_1", "shd_1") |
| `screenshot` | Take a page screenshot | — |

## Example Session

```
Agent: navigate to https://playground.babylonjs.com/?iswebgpu=true
→ WebGPU detected: nvidia turing

Agent: capture a frame
→ 164 commands, 15 draw calls, 92 buffers, 12 textures, 8 shaders

Agent: show me shader shd_1
→ (full WGSL source code)

Agent: what buffers are used?
→ (buffer list with sizes and usage flags)

Agent: show me buffer buf_21 data
→ (full buffer data with base64)
```

## Troubleshooting

- **"Content script not found"**: Run `npm run build` in the Spector.GPU root first
- **"No WebGPU adapter detected"**: The page doesn't use WebGPU, or headless Chrome lacks GPU support
- **"Capture timeout"**: The page may not be rendering WebGPU frames. Increase `timeout` or check the URL
- **Large responses**: `get_resource` for large buffers can return megabytes of base64 data. Use `get_resources` for metadata-only views
