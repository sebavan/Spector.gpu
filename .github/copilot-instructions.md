# Communication Style
- Always use a casual yet professional tone in all interactions.

# Project Context
- See [`spec/`](../spec/) for full architecture, API types, UI design, capture engine specs, and component documentation.
- These specs contain enough detail to regenerate the entire codebase from scratch.

# General Coding Principles

## Philosophy
- Be pragmatic — favor working, maintainable solutions over theoretical perfection.
- Minimize garbage collection pressure — prefer object reuse, pooling, and avoiding unnecessary allocations.
- Always consider the performance implications of your code, especially in hot paths or real-time systems.
- Strive for clarity and maintainability — code is read more often than it's written.
- Generated code must always be correct, even if it means being more verbose or less elegant.

## Performance
- Prefer pre-allocated buffers and object pools where applicable.
- Avoid closures and temporary objects in hot paths.
- Be mindful of per-frame or per-tick allocations in real-time code.

## Code Quality
- Write clear, self-documenting code; comment only when intent isn't obvious.
- Keep changes surgical — don't refactor unrelated code.
- Prefer simple solutions over clever ones.
- Always write tsdoc comments for public APIs and complex internal logic.

# Sub-Agent Output Visibility (CRITICAL)
- When calling any sub-agent via the `task` tool, ALWAYS relay the agent's full output to the user in the main chat.
- Do NOT silently consume, summarize, or truncate agent results. The user must see what each agent produced.
- Prefix each relay with a brief status header (e.g., "**Developer output:**", "**Tester output:**", "**PM output:**").
- This applies to ALL agent types: developer, tester, pm, manager, explore, general-purpose, and task agents.
- If an agent produced errors, warnings, or unexpected results, highlight them clearly.

# Project-Specific Guidelines

## Architecture
- See `spec/architecture.md` for the full system architecture, component tree, and capture flow.
- See `spec/planning/` for versioned planning documents.

## WebGPU Interception
- All WebGPU method patches use `patchMethod()` from `src/core/proxy/methodPatcher.ts`.
- NEVER use ES6 Proxy for WebGPU objects — brand-check failures will crash the page.
- Descriptor modifications (COPY_SRC injection) must CLONE the descriptor, never mutate in place.
- Buffer COPY_SRC = `0x0004` (GPUBufferUsage), Texture COPY_SRC = `0x01` (GPUTextureUsage) — different flag spaces.
- Skip MAP_READ/MAP_WRITE buffers when injecting COPY_SRC (incompatible).

## Capture Engine
- The capture flow is: arm → spy events build command tree → queue.submit triggers async finalization.
- `_isCapturing` gates spy event handlers. `_isReadingBack` prevents readback submits from re-triggering capture.
- Readback uses the device directly (not globalOriginStore originals) with per-resource error scopes.
- Canvas textures: only keep the latest one (deduplicate per-frame accumulation).
- Snapshot filters out destroyed resources and GC'd WeakRef objects.

## Result Viewer (React 19)
- Toggle-mode sidebar: Commands / Resources switch at top of left panel.
- Babylon.js for 3D buffer viewer is LAZY-LOADED via `React.lazy()` — never import statically (CSP blocks eval in Manifest V3 extension pages).
- All border-radius: 2px. Dark theme tokens in `src/styles/result.scss`.
- Browser history integration via pushState/popState for back/forward navigation.

## Testing
- Unit tests: Vitest + jsdom. Run with `npx vitest run`.
- WebGPU mocks in `test/mocks/` — full mock GPU/Device/Queue/Encoder/Buffer/Texture.
- Always run build (`npm run build`) AND tests before considering a task done.
- When fixing bugs, verify the fix doesn't break the target page (use Playwright on localhost:5174 or playground.babylonjs.com).

## Coexistence
- The CanvasSpy has a reentrancy guard for `getContext` — required because Babylon.js playground embeds Spector.js which also patches getContext.
- Always test on playground.babylonjs.com to verify coexistence with embedded Spector.js.
