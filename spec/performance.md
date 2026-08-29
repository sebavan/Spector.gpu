# Performance Budgets

Spector.GPU prioritizes low overhead while capture is idle and bounded work during an armed frame.

## 1.x budgets

| Area | Budget | Measurement |
|---|---:|---|
| Idle interception | Less than 1% median frame-time regression | Compare an unarmed WebGPU fixture with and without the extension over at least 1,000 frames |
| Command recording | At most 10 microseconds median per command | `npm run bench:capture`, divided by 10,000 commands |
| CPU finalization | At most 50 ms for 10,000 commands | `npm run bench:capture`; excludes GPU readback, mapping, PNG encoding, and browser presentation |
| Command count | 50,000 commands maximum | Enforced by `MAX_COMMAND_COUNT` |
| Texture previews | 4 MB and 16 textures maximum | Enforced during asynchronous readback |
| Capture timeout | 30 seconds | Enforced by `CAPTURE_TIMEOUT_MS` |

Timing budgets are release-qualification targets rather than hosted CI assertions because shared runners are too variable. Record the CPU, browser, operating system, Node version, median, and variance when qualifying a release.

## Benchmark

```bash
npm run bench:capture
```

The benchmark records and freezes a representative 10,000-command tree. GPU readback must be profiled separately in a headed browser because adapter and driver behavior dominate that phase.
