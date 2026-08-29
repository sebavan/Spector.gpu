# Chrome Web Store Listing

This document contains the reviewed repository-side material for the Spector.GPU 1.0 store submission.

## Listing copy

**Name:** Spector.GPU - WebGPU Inspector

**Summary:** Capture and inspect WebGPU commands, shaders, pipelines, buffers, textures, and rendered output.

**Category:** Developer Tools

**Single purpose:** Spector.GPU instruments WebGPU applications at the user's request so developers can capture one rendered frame and inspect its commands and GPU resources locally.

**Description:**

> Spector.GPU is a WebGPU frame debugger for Chrome. Open a WebGPU application, select Capture Frame, and inspect its queue submissions, render and compute passes, draw and dispatch calls, WGSL shaders, pipelines, bind groups, buffers, textures, and visual output.
>
> Captures stay in local extension storage and can be deleted from the result viewer. Spector.GPU contains no telemetry and does not send capture or browsing data to a project-operated service.

## Permission disclosures

| Permission | Store justification |
|---|---|
| `activeTab` | Associates the user-initiated capture with the selected tab |
| `scripting` | Installs WebGPU interception early enough to observe resource creation |
| `storage` | Stores completed captures locally for the result viewer |
| `unlimitedStorage` | WebGPU buffers, textures, shaders, and screenshots can exceed Chrome's normal extension quota |
| HTTP(S) and optional file hosts | Detects and captures WebGPU on development and hosted applications, including frames |

The privacy-practice declaration should state that website content and user activity are processed locally for the tool's single purpose, are not sold, and are not transmitted to the developer. Use the repository's [privacy policy](../PRIVACY.md) as the public policy URL.

## Submission assets

The publisher must supply these store-console assets outside the repository release workflow:

- 128x128 store icon
- At least one 1280x800 or 640x400 screenshot
- 440x280 small promotional tile
- Support and privacy-policy URLs
- Publisher verification and store-account declarations

The final submission must be reviewed in the Chrome Web Store dashboard because publishing credentials and legal attestations cannot be automated from this repository.
