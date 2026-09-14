# Chrome Web Store Listing

This document contains the reviewed repository-side material for the Spector.GPU 1.0 store submission.

## Listing copy

**Name:** Spector.GPU — WebGPU Inspector

**Summary:** Capture and inspect WebGPU commands, shaders, pipelines, buffers, textures, and rendered output.

**Category:** Developer Tools

**Language:** English

**Single purpose:** Spector.GPU instruments WebGPU applications at the user's request so developers can capture one rendered frame and inspect its commands and GPU resources locally.

**Description:**

> Spector.GPU is a WebGPU frame debugger for Chrome. Open a WebGPU application, select Capture Frame, and inspect its queue submissions, render and compute passes, draw and dispatch calls, WGSL shaders, pipelines, bind groups, buffers, textures, and visual output.
>
> Captures stay in local extension storage and can be deleted from the result viewer. Spector.GPU contains no telemetry and does not send capture or browsing data to a project-operated service.
>
> Highlights:
> - One-click WebGPU frame capture
> - Render-pass, compute-pass, draw, dispatch, and state inspection
> - WGSL shader and pipeline inspection
> - Buffer, texture, sampler, bind-group, and resource cross-references
> - Texture previews, buffer hex views, and interactive 3D mesh inspection
> - Local-only storage with no analytics or telemetry
>
> Current support: Chrome and Chromium-based Edge 113 or newer. Some depth/stencil, compressed, multisampled, and 3D texture formats cannot be read back for previews.

## Permission disclosures

| Permission | Store justification |
|---|---|
| `storage` | Stores completed captures locally for the result viewer |
| `unlimitedStorage` | WebGPU buffers, textures, shaders, and screenshots can exceed Chrome's normal extension quota |
| `http://*/*` and `https://*/*` | Installs the WebGPU capture hooks at document start so resources created during application startup and in nested frames can be captured |
| `file://*/*` | Supports developers debugging local WebGPU applications when they explicitly enable file URL access in Chrome |

The privacy-practice declaration should state that website content is processed locally for the tool's single purpose, is not sold, and is not transmitted to the developer. Use the repository's [privacy policy](../PRIVACY.md) as the public policy URL.

## Privacy practices

**Remote code:** No. All executable extension code is included in the uploaded package. Dynamic imports load only bundled extension chunks.

**Data categories handled:**

- Website content: WebGPU commands, descriptors, shaders, labels, GPU resources, and captured frame images.
- Web browsing activity: the current tab and URL context necessary to provide the user-requested capture feature.

**Data use:** Provide the user-facing WebGPU capture and inspection feature only.

**Data transfer:** No captured website content or browsing activity is transmitted to the developer or third parties.

**Certifications:** Certify all Limited Use statements. The extension does not sell data, use data for advertising, use data for creditworthiness or lending, or permit humans to read captured data.

## URLs

- **Homepage:** https://github.com/sebavan/Spector.gpu
- **Support:** https://github.com/sebavan/Spector.gpu/issues
- **Privacy policy:** https://github.com/sebavan/Spector.gpu/blob/main/PRIVACY.md

## Submission assets

Generate assets with `npm run store:assets`. Upload:

- `docs/chrome-web-store/assets/store-icon-128.png`
- `docs/chrome-web-store/assets/screenshot-result-view-1280x800.png`
- `docs/chrome-web-store/assets/promo-small-440x280.png`
- `docs/chrome-web-store/assets/promo-marquee-1400x560.png` (optional)

The dashboard also accepts an optional YouTube promotional video. It is not required for submission.

## Reviewer test instructions

No credentials or paid account are required.

1. Install the extension and open `https://playground.babylonjs.com/?iswebgpu=true`.
2. Wait for the Spector.GPU toolbar icon to show the blue `GPU` badge.
3. Select the extension icon and click **Capture Frame**.
4. The result viewer opens automatically. Expand a render pass and select a draw command.
5. Verify that the Details, Shaders, and Pipeline tabs display capture information.
6. Switch the left sidebar to Resources and inspect a buffer or texture.
7. Use **Delete stored capture** in the result header to remove the local capture.

If WebGPU is unavailable in the review environment, enable hardware acceleration and use a Chrome version with WebGPU support.

## Distribution

- **Visibility:** Public
- **Regions:** All regions
- **Mature content:** No
- **Pricing:** Free

The final submission must be reviewed in the Chrome Web Store dashboard because publishing credentials, identity verification, and legal attestations cannot be automated from this repository.
