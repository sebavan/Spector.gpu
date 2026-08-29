# Contributing to Spector.GPU

Thanks for helping improve WebGPU debugging. Contributions can include capture-engine fixes, result-viewer improvements, GPU/driver compatibility reports, tests, and documentation.

## Before starting

- Search existing issues and pull requests.
- Use a focused issue for substantial behavior or API changes before investing in an implementation.
- Never include proprietary shaders, captures, screenshots, credentials, or URLs in an issue unless you are authorized to share them.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report vulnerabilities through [SECURITY.md](SECURITY.md).

## Development setup

Spector.GPU uses Node.js 22, TypeScript, React 19, Webpack, Vitest, and Playwright.

```bash
git clone https://github.com/sebavan/Spector.gpu.git
cd Spector.gpu
npm ci
npm run build
npm test
```

Load `dist/` from `chrome://extensions/` with Developer mode enabled. For the MCP server:

```bash
cd mcp
npm ci
npm test
npm run build
```

## Making changes

1. Create a branch from `main`.
2. Keep the change focused and update directly related specs or public documentation.
3. Add regression tests for fixes and behavior tests for features.
4. Preserve WebGPU object identity: use `patchMethod()` rather than ES6 `Proxy`.
5. Clone resource descriptors before injecting `COPY_SRC`; never mutate caller-owned descriptors.
6. Avoid allocations in per-frame interception paths unless the clarity or correctness benefit is justified.

Public APIs and complex internal logic require TSDoc. Prefer clear code over explanatory comments for straightforward behavior.

## Validation

Run the smallest relevant checks while developing, then run the complete local baseline before opening a pull request:

```bash
npm run check:versions
npm run lint
npm test
npm run build
npm run bench:capture
cd mcp
npm test
npm run build
```

WebGPU end-to-end tests require headed Chrome and a usable GPU:

```bash
npm run test:e2e
```

Standard hosted CI runners do not provide a reliable WebGPU adapter, including through SwiftShader. CI therefore runs the non-WebGPU extension smoke suite; run the complete WebGPU suite locally or on a GPU-enabled runner.

Real-site tests also require network access. If a GPU, driver, or site limitation prevents an E2E test, describe the environment and exact result in the pull request rather than weakening the test.

The command-tree benchmark is a release-qualification check rather than a shared-runner gate. Compare its result with the budgets in [`spec/performance.md`](spec/performance.md) and record the qualifying hardware.

## Pull requests

- Explain the user-visible problem and the chosen solution.
- Link the issue when one exists.
- Include screenshots or recordings for result-viewer changes.
- Call out capture-format, permission, privacy, or performance impact.
- Keep generated `dist/`, test reports, and dependencies out of commits.
- Update `CHANGELOG.md` under **Unreleased** for notable user-facing changes.

All changes go through a pull request. The protected `main` branch requires CI, review, and resolved conversations.
