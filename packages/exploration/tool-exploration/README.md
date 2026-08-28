---
description: "Model-facing exploration tools over the dsh-exploration engine: seven exploration_* tools that ingest raw exploration records and run the engine's pure processors."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-exploration

English | [中文](README.zh.md)

## Summary

The **model-facing exploration tools** over the [`@deepseek-ai/dsh-exploration`](../exploration) engine: seven `exploration_*` tools that ingest raw exploration records and run the engine's pure processors. Every tool validates its arguments through the engine's own config schemas, runs the matching processor, and returns a compact JSON dataset plus row/column counts and provenance notes; `exploration_run` returns the full traceability record.

## Table of Contents

- [Summary](#summary)
- [Behavior](#behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="behavior"></a>
## Behavior

- **Registration** — the plugin (`name: tool-exploration`, `inject: ['tools']`) registers all seven tools on `ctx.tools`; resource `Limits` come from validated Config fields.
- **`exploration_ingest`** — parses raw CSV/JSON text or base64-encoded SEG-Y into a tabular dataset.
- **`exploration_clean`** — missing-value policy, numeric ranges, dedupe, drops/renames, string trimming, and type coercion.
- **`exploration_convert`** — unit conversions, depth↔two-way-time, and column selection.
- **`exploration_extract`** — descriptive statistics, rolling windows, and RMS amplitude.
- **`exploration_detect`** — z-score, IQR, hard thresholds, spikes, dead traces, and null anomalies.
- **`exploration_profile`** — renders a seismic section (SEG-Y long or short format) to PNG and/or SVG under the `profile` key, for use after parsing and validating a section.
- **`exploration_run`** — validates a named pipeline (first step must be `ingest`) and returns the run's `RunRecord` (`runId`, `pipelineName`, `status`, `steps`, `output`, `outputSummary`). A failing step — including an `INCOMPLETE_DATA` profile step — is recorded as `status: 'failed'` with the error code and step id, not thrown.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`exploration_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-exploration). `format` is an enum (`csv`/`json`/`segy`); `segy` data arrives base64-encoded; `pipeline` is a JSON object whose first step must be `ingest`.

#### Token effect

Fixed schema cost on every request where the tools are visible; the `pipeline`/`config` JSON parameters carry no per-deployment variation.

#### KV Cache effect

Prefix-stable while the tool set and its descriptions are unchanged; loading or disposing the plugin may invalidate reuse from the changed schema region.

### Pipeline run record

#### What the model sees

`exploration_run` returns inline code such as `runId`, `steps`, and `outputSummary` (`rowCount`, `columnCount`, `shape`, `checksum`) so the model can cite the exact traceability record instead of re-rendering data.

#### Token effect

The full record is passed through and retained until compaction; `output` can be large for big datasets, bounded by the deployment's `Limits`.

#### KV Cache effect

Append-only; newly visible result content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Datasets round-trip through tool arguments** — transform tools take and return the full dataset JSON, so chained calls duplicate data between steps; a shared in-session dataset store is deferred.
- **SEG-Y rides as base64** — inputs are text or base64 strings; direct binary file ingestion and on-disk outputs are not exposed.
- **Output size is caller-bounded** — the five transform tools return the whole dataset as JSON; very large result sets rely on the deployment's `maxRows`/`maxColumns` limits rather than pagination.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
