# Spector.GPU — Specifications

Complete specifications for regenerating the entire Spector.GPU codebase from scratch. These documents describe every type, component, algorithm, config, and design decision.

## Documents

| Document | Description |
|----------|-------------|
| [`architecture.md`](architecture.md) | High-level system architecture, directory structure, key concepts, component diagram |
| [`types.md`](types.md) | Complete TypeScript type definitions — ICapture, ICommandNode, all resource types, messages, constants, usage flag bitmasks |
| [`capture-engine.md`](capture-engine.md) | Spy system, method patching, COPY_SRC injection, RecorderManager, capture lifecycle, texture/buffer readback, format conversion |
| [`ui-components.md`](ui-components.md) | React component tree, state management, layout behavior, shader editor, 3D buffer viewer, navigation, WGSL syntax highlighting |
| [`build-config.md`](build-config.md) | Tech stack, webpack config, TypeScript config, manifest, message flow, storage, SCSS design tokens, icons, npm scripts |
| [`planning/`](planning/) | Versioned planning documents for each major iteration |

## How to use these specs

An AI agent or developer can regenerate the full codebase by following these documents in order:

1. **`build-config.md`** — Set up the project: package.json, tsconfig, webpack, manifest
2. **`types.md`** — Implement the complete type system (shared/types/)
3. **`capture-engine.md`** — Build the core capture engine (core/)
4. **`ui-components.md`** — Build the React result viewer (extension/resultView/)
5. **`architecture.md`** — Verify the overall structure matches

Each spec is self-contained with enough detail to produce correct, working code.
