# Compatibility Policy

This policy applies to Spector.GPU 1.x.

## Browser extension

- **Supported:** current stable Chrome and Edge releases with WebGPU enabled on Windows, macOS, and Linux.
- **Best effort:** older Chromium releases back to 113 and Chromium-derived browsers.
- **Unsupported:** Firefox and Safari extension packaging.

Browser support means capture failures reproducible on a supported browser, driver, and WebGPU implementation are treated as compatibility bugs. GPU-driver restrictions and browser WebGPU blocklists remain outside the extension's control.

## Capture format

Serialized captures use an independent integer `formatVersion`. Format 1 remains readable throughout Spector.GPU 1.x. Additive optional fields are allowed; removals or semantic changes require a new format version. See the [capture format specification](spec/capture-format.md).

## MCP tools

The MCP server follows package semver:

- Patch releases may fix behavior without changing documented tool inputs.
- Minor releases may add tools, optional inputs, or output fields.
- Existing tool names and required inputs are not removed or changed within 1.x.
- Deprecations are documented for at least one minor release before removal in the next major release.
- Clients must ignore unknown output fields and should use `isError` rather than matching exact error text.

The seven 1.0 tools are `navigate`, `capture`, `get_commands`, `get_resources`, `get_resource`, `screenshot`, and `close`.

## Texture and buffer inspection

Format 1 guarantees metadata for tracked resources, not readable contents for every resource:

- Readback is supported for eligible 2D, single-sampled, uncompressed color textures.
- Cubemap faces are supported when the underlying texture is otherwise eligible.
- Depth/stencil, compressed BC/ETC/ASTC, multisampled, 1D, and 3D texture contents are not read back in 1.x.
- `MAP_READ` and `MAP_WRITE` buffers cannot receive `COPY_SRC`; their contents may be unavailable.
- Unsupported content is represented by absent preview/data fields while descriptors and usage references remain available.

This boundary is intentional for 1.0 and avoids mutating incompatible resource usage or issuing invalid WebGPU copies.

## Release qualification

Every release must pass unit tests and production builds on Ubuntu, Windows, and macOS, plus the hosted non-WebGPU extension smoke test. Before a major release, a GPU-enabled Windows environment must pass the raw WebGPU fixtures and Babylon.js Playground capture. Additional GPU/OS results should be recorded in release notes without implying untested coverage.
