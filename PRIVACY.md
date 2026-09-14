# Privacy Policy

Last updated: August 28, 2026

Spector.GPU is a developer tool for capturing and inspecting WebGPU frames. This policy covers the browser extension and the optional local MCP server in this repository.

## Data the extension processes

When you request a capture, Spector.GPU can process:

- WebGPU commands, descriptors, labels, shaders, pipelines, bind groups, buffers, and textures
- WebGPU adapter information exposed by the browser
- Screenshots or texture previews generated from the captured frame
- The URL and tab context needed to coordinate the extension UI

This data can contain proprietary application code or rendered content. Only capture applications and data you are authorized to inspect.

## Storage and transmission

The browser extension:

- Stores completed captures in `chrome.storage.local` on your device
- Does not send captures, browsing activity, analytics, or telemetry to the project maintainer or any project-operated service
- Does not sell, share, or use captured data for advertising
- Retains captures until the user deletes them from the result viewer, clears extension storage, or removes the extension

Chrome synchronization is not used. Browser, operating-system, backup, and enterprise-management behavior remains governed by those providers and your local configuration.

## Chrome Web Store Limited Use disclosure

Spector.GPU's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension handles website content only to provide the user-requested WebGPU frame capture and inspection feature. It does not transfer that data to the developer or third parties, use it for advertising, sell it, use it for creditworthiness or lending, or allow humans to read it.

The extension does not download or execute remote extension code. All executable extension code is included in the installed package.

## Why permissions are required

| Permission | Purpose |
|---|---|
| `storage` and `unlimitedStorage` | Store captures that can exceed normal extension quotas |
| `http://*/*`, `https://*/*`, `file://*/*` | Detect WebGPU and capture frames across development sites, hosted applications, iframes, and user-enabled local files |

The extension's content scripts run at `document_start` so WebGPU objects created during application startup can be observed. File URL access must also be enabled by the user in the browser's extension settings.

## MCP server

The optional MCP server runs locally. It:

- Navigates only to user-supplied HTTP(S) URLs
- Holds the current capture in process memory
- Can return GPU resource data and screenshots to the connected MCP client
- Clears its in-memory capture when `close` is called or the process exits
- Does not add project telemetry

After tool output reaches an MCP client or model provider, that service's privacy and retention policy applies. Review the client's policy before inspecting sensitive applications.

## Your controls

You can delete the current capture from its result viewer, clear all extension storage from the browser's extension settings, disable access for specific sites, disable file URL access, or uninstall the extension. The project maintainer cannot retrieve or delete data stored only on your device.

## Changes and contact

Material policy changes will be recorded in this repository. Questions can be opened as a GitHub issue when they do not contain sensitive information; use the private process in [SECURITY.md](SECURITY.md) for security-sensitive concerns.
