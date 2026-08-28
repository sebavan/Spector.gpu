# Changelog

Notable changes are documented here. Release details and downloadable extension archives are available from [GitHub Releases](https://github.com/sebavan/Spector.gpu/releases).

## Unreleased

### Added

- Stateful MCP server for agent-driven WebGPU capture and inspection
- MCP resource sorting, limiting, screenshots, and explicit browser cleanup

### Changed

- MCP responses avoid bulk data unless a specific resource is requested
- Public documentation, privacy disclosures, contribution guidance, and release packaging

### Fixed

- Command-referenced buffer prioritization and upload-time buffer capture
- 3D mesh viewer camera framing

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
