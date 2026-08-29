# Capture Format

Spector.GPU 1.0 defines serialized capture format **1**. Every newly produced `ICapture` includes:

```json
{
  "formatVersion": 1,
  "version": "1.0.0"
}
```

`formatVersion` governs the JSON schema. `version` identifies the Spector.GPU build that produced the capture.

## Compatibility contract

- Readers accept format 1 captures produced by any Spector.GPU 1.x release.
- New optional fields may be added without changing `formatVersion`.
- Required fields are not removed or reinterpreted within format 1.
- A breaking schema change increments `formatVersion`.
- Readers reject future format versions explicitly instead of displaying partial or misleading state.
- Pre-1.0 captures without `formatVersion` are loaded as format 1 when their producer version starts with `0.` because their top-level shape is compatible.

## Required top-level fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Capture identifier |
| `formatVersion` | positive integer | Serialized schema version |
| `version` | string | Producer application semver |
| `timestamp` | number | Unix epoch milliseconds |
| `duration` | number | Capture duration in milliseconds |
| `adapterInfo` | object | Adapter metadata exposed by WebGPU |
| `deviceDescriptor` | object | Requested device descriptor |
| `deviceLimits` | object | Device limits |
| `deviceFeatures` | string[] | Enabled WebGPU features |
| `commands` | array | Root command nodes in submission order |
| `resources` | object | Resource lookup tables |
| `stats` | object | Aggregate capture counts |

Resource maps serialize as objects keyed by resource ID. Commands reference those IDs through state fields such as `pipelineId`, `bindGroups`, and `vertexBuffers`.

## Reader behavior

`normalizeCapture()` validates required top-level fields and performs supported in-memory upgrades. Storage remains unchanged until a new capture is written. Invalid or unsupported data produces an actionable load error.
