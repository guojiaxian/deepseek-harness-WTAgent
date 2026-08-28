# @deepseek-ai/dsh-tool-consistency

English | [中文](README.zh.md)

The **model-facing consistency tools** over the [`@deepseek-ai/dsh-consistency`](../consistency)
engine: seven `consistency_*` tools that build the dense-array consistency-test workflow and run
the engine's pure processors. Every tool validates its arguments through the engine's own config
schemas, runs the matching processor over the workflow JSON, and returns the updated workflow
plus station/seed/arrival/plot-batch counts and provenance notes; `consistency_run` returns the
engine's full traceability record. Actual file I/O (renaming directories, running converters,
obspy slicing, offset measurement, matplotlib rendering) is left to the preset's `tool-bash`/
`tool-fs` tools guided by the engine's outputs.

## Behavior

- **Registration** — the plugin (`name: tool-consistency`, `inject: ['tools']`) registers all seven
  tools on `ctx.tools`; resource `Limits` come from validated Config fields.
- **`consistency_ingest`** — builds the workflow from an interchange JSON payload (project,
  station directories with seed file names, and raw `datetime.dat` arrival lines).
- **`consistency_rename`** — computes uniform station directory names (`C`-prefix stripped, else
  the first 4 glyphs) with collision guarding.
- **`consistency_convert`** — validates the `mseed2sac`/`e-mseed2sac` converters and builds the
  seed conversion plan by `C`/`E` kind.
- **`consistency_cut`** — turns the raw arrival lines (北京时间) into UTC arrival windows and cut
  file naming.
- **`consistency_plot`** — partitions stations into plot batches per arrival (numeric
  sort, stack offsets, `WT.<sta[:4]>` Y labels); batch height adapts to the station count.
- **`consistency_exclude`** — after plotting, analyzes the measured per-station data offset (DC
  baseline shift / static displacement measured with obspy) against the configured `threshold` and
  reports which stations need to be excluded, recording an `Exclusion`. It is analysis-only: plot
  batches and data are left unchanged — removing the abnormal device is a manual operator action.
- **`consistency_run`** — validates a named pipeline (first step must be `ingest`) and returns the
  run's `RunRecord` (`runId`, `pipelineName`, `status`, `steps`, `output`, `outputSummary`). A
  failing step — including an `INCOMPLETE_DATA` convert step — is recorded as `status: 'failed'`
  with the error code and step id, not thrown.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`consistency_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-consistency). `data` is JSON text (requires `project`, `stations`, and
`arrivalLines`); `workflow` is the JSON shape returned by a prior `consistency_*` tool; `pipeline`
is a JSON object whose first step must be `ingest`.

#### Token effect

Fixed schema cost on every request where the tools are visible; the `workflow`/`config` JSON
parameters carry no per-deployment variation.

#### KV Cache effect

Prefix-stable while the tool set and its descriptions are unchanged; loading or disposing the
plugin may invalidate reuse from the changed schema region.

### Pipeline run record

#### What the model sees

`consistency_run` returns inline code such as `runId`, `steps`, and `outputSummary`
(`stationCount`, `seedFileCount`, `arrivalCount`, `plotBatchCount`, `checksum`) so the model can
cite the exact traceability record instead of re-deriving decisions.

#### Token effect

The full record is passed through and retained until compaction; `output` can be large for big
arrays, bounded by the deployment's `Limits`.

#### KV Cache effect

Append-only; newly visible result content follows the reusable request prefix and does not
invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Workflows round-trip through tool arguments** — transform tools take and return the full
  workflow JSON, so chained calls duplicate data between steps; a shared in-session workflow store
  is deferred.
- **The engine computes decisions, not bytes** — the tools produce naming/window/batch plans and
  the run record; executing the renames, converters, obspy slicing, and plotting still requires the
  preset's shell and filesystem tools.
- **Input is one interchange JSON** — the ingest step takes a single self-contained JSON payload;
  scanning a real directory tree into that payload is done by the preset's filesystem tools before
  the pipeline runs.