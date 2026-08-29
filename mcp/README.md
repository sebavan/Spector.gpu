# Spector.GPU MCP Server

MCP server for capturing and inspecting WebGPU frames. Holds a Playwright browser and capture state in memory so AI agents can navigate once, capture once, then query the data across multiple tool calls without re-capturing.

## Prerequisites

- Node.js 22+
- Chrome or Edge with WebGPU support
- Build the Spector.GPU extension first:

  ```bash
  cd /path/to/Spector.gpu
  npm ci
  npm run build
  ```

## Installation

```bash
cd /path/to/Spector.gpu/mcp
npm ci
npm run build
```

Run `npx playwright install chrome` if Playwright cannot find a local Chrome installation.

## Configuration

Add the server to an MCP client configuration:

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
| `close` | Close the browser and clear the in-memory capture | — |

## Example Session

```
Agent: navigate to https://playground.babylonjs.com/?iswebgpu=true
→ WebGPU detected: nvidia turing

Agent: capture a frame
→ 164 commands, 15 draw calls, 92 buffers, 12 textures, 8 shaders

Agent: show me shader shd_1
→ (full WGSL source code)

Agent: show me the largest five buffers
→ get_resources({ category: "buffers", sortBy: "size", limit: 5 })

Agent: show me buffer buf_21 data
→ (full buffer data with base64)
```

## Security and data handling

- `navigate` accepts only fully qualified `http://` and `https://` URLs. `file:`, `data:`, and `javascript:` URLs are rejected.
- The server runs locally, launches a local browser, and does not add telemetry.
- The current capture stays in the MCP process memory until another capture replaces it or `close` is called.
- The server can read page-rendered GPU resources and take screenshots. Only navigate to applications and data you are authorized to inspect.
- MCP clients receive capture details in tool responses. Their own retention and data-handling policies apply after that point.

## Compatibility

The 1.x server keeps existing tool names and required inputs stable. Minor releases may add tools, optional inputs, and output fields; removals or semantic changes require a major release. Deprecations remain documented for at least one minor release. Clients should ignore unknown output fields and branch on `isError` instead of exact error strings. See the repository [compatibility policy](../COMPATIBILITY.md).

## Troubleshooting

- **"Content script not found"**: Run `npm run build` in the Spector.GPU root first
- **Chrome executable missing**: Run `npx playwright install chrome` in `mcp/`
- **"No WebGPU adapter detected"**: The page doesn't use WebGPU, or headless Chrome lacks GPU support
- **"Capture timeout"**: The page may not be rendering WebGPU frames. Increase `timeout` or check the URL
- **Large responses**: `get_resource` for large buffers can return megabytes of base64 data. Use `get_resources` for metadata-only views
