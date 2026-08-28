---
description: "The exploration data processing engine: ingest, clean, convert, extract, detect, and profile processors for CSV, JSON, and SEG-Y records through a configurable, traceable pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-exploration

English | [中文](README.zh.md)

## Summary

The **exploration data processing engine**: professional processing of raw exploration records (geology, geophysics, and well-log data) as a Cordis service plus pure, framework-free functions. It ingests CSV, JSON, and SEG-Y, cleans and converts the dataset, extracts statistics, detects anomalies, and renders seismic section profiles (PNG/SVG) through a configurable, traceable pipeline. The model-facing `exploration_*` tools live in [`@deepseek-ai/dsh-tool-exploration`](../tool-exploration).

```ts ignore-check
import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-exploration'

const result = runPipeline(
  { format: 'csv', data: 'depth_m,gamma_api\n0,45\n15,220\n' },
  validatePipeline({
    name: 'quick-qc',
    steps: [
      { id: 'ingest', type: 'ingest' },
      { id: 'detect', type: 'detect', config: { zscore: [{ column: 'gamma_api' }] } },
    ],
  }),
  { maxInputBytes: 8 * 1024 * 1024, maxRows: 50_000, maxColumns: 1024, maxAnomalyRecords: 500 },
  crypto.randomUUID(),
)
```

## Table of Contents

- [Summary](#summary)
- [Behavior](#behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="behavior"></a>
## Behavior

- **Pipeline shape** — a pipeline is a named, ordered list of steps whose first step must be `ingest`; empty pipelines, duplicate step ids, and invalid step configs fail loud during `validatePipeline`. As a plugin (`name: exploration`), `Config.pipelines` registers each pipeline on mount through `ExplorationService`.
- **Step processors** — each processor exposes `validate(config)` and `run(dataset, input?, limits?)`:
  - `ingest` parses CSV (delimiter, header, type inference, optional long format) or JSON (records/columns), and SEG-Y (byte-order, trace header word sizes, and optional EBCDIC header decode).
  - `clean` applies missing-value policy, numeric ranges, dedupe, column drops/renames, string trimming, and type coercion.
  - `convert` applies unit conversions through an affine unit table, depth↔two-way-time (`t = 2d/v`), and column selection.
  - `extract` derives per-column descriptive statistics, rolling windows, and RMS amplitude.
  - `detect` flags z-score, IQR, hard-threshold, short-window spike, dead-trace, and null anomalies.
  - `profile` renders a 2-D seismic section (SEG-Y long `trace`/`sampleIndex`/`value` or short `trace` + `sample_*` columns) to a color-mapped raster (seismic/grayscale/jet) and embeds it as PNG and/or SVG under `meta.profile`. A dataset with no seismic columns, rows, or finite amplitudes raises `INCOMPLETE_DATA`, pausing the run.
- **Traceability** — `runPipeline` records per-step `StepRecord`s (start/finish timestamps, duration, input hash, output summary, notes) on a `RunRecord` with an input checksum. A failing step is captured on the record without aborting the caller, and the output falls back to the last completed dataset.
- **Units and checksums** — `convert` composes affine transforms through the base unit, so linear and offset units (temperature) share one path; `checksumBytes`/`checksumDataset` use a stable FNV-1a so records replay identically across runs.
- **Resource limits** — `Limits` (`maxInputBytes`, `maxRows`, `maxColumns`, `maxAnomalyRecords`) are validated Config fields enforced after every step; nothing is hardcoded inside the processors.

<a id="model-experience"></a>
## Model Experience

### Tool outputs and errors

#### What the model sees

Each `exploration_*` tool returns a compact JSON result with inline code (`dataset`, `rowCount`, `columnCount`, `notes`) or, for `exploration_run`, the full traceability `RunRecord` with `steps` and `outputSummary`. Processor errors surface as structured `ExplorationError` codes (`VALIDATION_ERROR`, `LIMIT_EXCEEDED`, `INGEST_ERROR`, …) rather than prose.

#### Token effect

Zero engine tokens before a call; every result row is passed through unchanged and retained in history until compaction.

#### KV Cache effect

The engine contributes no prompt text and no prefix, so it never affects KV-cache reuse; only the tools' own schema and result rendering participate in request prefix stability.

## Known Limitations and Deferred Work

- **In-memory processing only** — datasets are held whole in memory (bounded by `Limits`); streaming or on-disk spill for very large seismic volumes is deferred.
- **SEG-Y is a limited subset** — the parser handles the 3200-byte text header, 400-byte binary header, and fixed sample-interval traces with configurable trace-header word sizes, but not rev/extension headers, non-standard formats, or variable-length headers.
- **Statistics assume simple distributions** — z-score detection assumes roughly normal data; heavy-tailed or multimodal well-log distributions need explicit threshold rules instead.
- **Unit table is fixed** — conversions resolve against a static symbol table; adding a project-specific unit requires a code change rather than a Config entry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
