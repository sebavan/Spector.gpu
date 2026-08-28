# Security Policy

## Supported versions

Security fixes are applied to the latest `0.x` release line.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Use GitHub's **Security** tab and choose **Report a vulnerability** to open a private report. Do not disclose exploitable details in a public issue.

Include:

- Affected Spector.GPU version and browser/MCP environment
- Reproduction steps or a minimal proof of concept
- Expected and observed impact
- Any suggested mitigation

You should receive an acknowledgement within seven days. The maintainer will validate the report, coordinate a fix and disclosure timeline, and credit reporters who want attribution.

For non-sensitive hardening ideas or incorrect permission behavior, use the public security issue form.

## Scope

Relevant reports include extension privilege boundary violations, unsafe page-to-extension messaging, capture data exposure, navigation bypasses in the MCP server, dependency compromise, and unintended code execution. Bugs in inspected websites or browser/WebGPU implementations should be reported to their respective maintainers.
