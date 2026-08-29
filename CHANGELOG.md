# Changelog

Notable changes are documented here. Release details and downloadable extension archives are available from [GitHub Releases](https://github.com/sebavan/Spector.gpu/releases).

## Unreleased

## 1.0.0 - 2026-08-29

### Added

- Stateful MCP server for agent-driven WebGPU capture and inspection
- MCP resource sorting, limiting, screenshots, and explicit browser cleanup
- Versioned capture format with compatible loading of pre-1.0 captures
- Capture deletion from the result viewer
- Browser, capture-format, MCP, and resource-readback compatibility guarantees
- Capture performance budgets and a repeatable command-tree benchmark
- Cross-platform build and test coverage on Ubuntu, Windows, and macOS
- Build provenance attestations for release artifacts

### Changed

- MCP responses avoid bulk data unless a specific resource is requested
- Public documentation, privacy disclosures, contribution guidance, and release packaging
- Updated root, MCP, build, test, and GitHub Actions dependencies
- Migrated linting to ESLint flat configuration

### Fixed

- Command-referenced buffer prioritization and upload-time buffer capture
- 3D mesh viewer camera framing
- Popup version now follows the shared release version

## 0.5.1 - 2026-03-24

- Included shader source and requested buffer data in summary workflows

## 0.5.0 - 2026-03-22

- Added the enhanced buffer viewer with layout, vertex-table, and toolbar support
- Improved resource navigation and removed bulk data from general JSON views
- Standardized CI on Node.js 22

## 0.2.0 - 2026-03-20

- Hardened texture staging-buffer cleanup, cubemap detection, descriptor cloning, command-tree validation, and viewer lifecycle handling

## 0.1.0 - 2026-03-20

- Initial public extension release
