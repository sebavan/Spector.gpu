# Roadmap

Spector.GPU 1.x is stable. Priorities are driven by real WebGPU debugging workflows, capture correctness, browser compatibility, and low overhead on inspected applications.

## Distribution

- Submit the prepared Chrome Web Store listing and reviewed privacy disclosures
- Add short capture and MCP walkthrough videos
- Expand tested GPU, operating-system, and framework coverage

## Completed for 1.0

- Versioned serialized capture format with legacy 0.x loading
- Compatibility guarantees for MCP tools and capture queries
- Capture deletion from the result viewer
- Explicit safe-readback support boundary
- Performance budgets and a repeatable command-recording benchmark
- Cross-platform build/test CI and release artifact provenance attestations

## Post-1.0

- Add capture history and configurable automatic retention
- Broaden safe texture and resource inspection
- Expand GPU-enabled release qualification coverage

## Longer-term exploration

- Additional Chromium-based browser packaging
- Capture export/import for offline collaboration
- More advanced render-pass, compute, memory, and performance analysis
- Framework-specific debugging guides and examples

The roadmap is directional rather than a commitment to dates. Use a feature-request issue to propose a use case or help prioritize an item.
