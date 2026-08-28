# Spector.GPU — Skills

AI agent skills for WebGPU introspection. These can be registered as tools in AI coding agents (Copilot CLI, Claude, etc.) to enable automated WebGPU debugging.

> The stateful [`mcp/`](../mcp/README.md) server is the recommended integration. The capture skill remains available as a lightweight, one-shot fallback.

## Available Skills

### `spector-gpu-capture`

Captures and analyzes WebGPU frames from any page using Playwright + the Spector.GPU content script.

**Usage:** See [`spector-gpu-capture/`](spector-gpu-capture/) for the skill definition and CLI tool.
