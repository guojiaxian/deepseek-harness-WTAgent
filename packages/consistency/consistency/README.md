---
description: "The engine of the dense-array consistency-test Agent: pure TypeScript processors for ingest, rename, convert, cut, plot, and exclude, plus a validated named-pipeline service."
kind: "package-reference"
---

# @deepseek-ai/dsh-consistency

English | [中文](README.zh.md)

## Summary

The engine of the dense-array **consistency-test Agent** (密集台阵设备一致性测试). It is a
dependency-free pure-TypeScript package that turns a dense-array device inventory and its
`datetime.dat` excitation times into an executable workflow covering the four phases of
`conformance_test/workflow.md`:

1. **rename** — unify station directory names (`C0756_260818` → `0756_260818`, else the
   first 4 glyphs), with collision guarding.
2. **convert** — classify each seed by its `C`/`E` prefix and plan the
   `mseed2sac`/`e-mseed2sac` conversion to `站台编号/*.SAC`.
3. **cut + plot** — parse 北京时间 arrivals, shift to UTC (−8 h), compute the
   `[cutBefore, cutAfter]` windows and the `WT.<sta>_<label>_<b>s_<a>s.<chan>.SAC` naming, then
   partition stations into plot batches (`wave_z_batchN.png`) whose height matches the batch's
   actual station count; after all figures are rendered they are stitched in excitation-time order
   into one adaptive-grid image (`combined_wave_all_z.png`), with column count chosen from the
   image count and aspect ratio to keep the combined width/height balanced.
4. **exclude** — after plotting, analyze each station's data offset (DC baseline shift / static
   displacement measured with obspy) and report which station(s) reach the configured threshold; the
   operator removes the abnormal device manually. This step is analysis-only and never mutates plots.

The engine only computes the error-prone *domain* decisions and a traceability
[`RunRecord`](src/types.ts). Actual file I/O (renaming directories, running converters, obspy
slicing, offset measurement, matplotlib rendering) is executed by the agent preset's
`tool-bash`/`tool-fs`/`tool-web` guided by the engine's outputs — mirroring the exploration Agent
architecture.

## Table of Contents

- [Summary](#summary)
- [Steps](#steps)
- [Usage](#usage)
- [Dev Note](#dev-note)

-----

<a id="steps"></a>
## Steps

| Step | Processor | Output |
|---|---|---|
| `ingest` | [`src/processors/ingest.ts`](src/processors/ingest.ts) | builds the [`Workflow`](src/types.ts) from a JSON interchange payload |
| `rename` | [`src/processors/rename.ts`](src/processors/rename.ts) | computes collided-safe uniform station names |
| `convert` | [`src/processors/convert.ts`](src/processors/convert.ts) | validates converters and builds the conversion plan |
| `cut` | [`src/processors/cut.ts`](src/processors/cut.ts) | parses arrivals to UTC + window and file naming |
| `plot` | [`src/processors/plot.ts`](src/processors/plot.ts) | station→batch grouping, Y labels and stack offsets |
| `exclude` | [`src/processors/exclude.ts`](src/processors/exclude.ts) | reports which stations to exclude + records `Exclusion` (no plot mutation) |

<a id="usage"></a>
## Usage

```ts
import { validatePipeline, runPipeline } from '@deepseek-ai/dsh-consistency'

const pipeline = validatePipeline({
  name: 'consistency',
  steps: [
    { id: 'ingest', type: 'ingest', config: { baseDir: '/data', converterC: 'mseed2sac', converterE: 'e-mseed2sac' } },
    { id: 'rename', type: 'rename', config: {} },
    { id: 'convert', type: 'convert', config: {} },
    { id: 'cut', type: 'cut', config: {} },
    { id: 'plot', type: 'plot', config: {} },
  ],
})
const run = runPipeline({ format: 'json', data: JSON.stringify({ project: '0756_260818', stations: [{ name: 'C0756_260818' }], arrivalLines: ['2026-08-25 12:00:00'] }) }, pipeline, { maxInputBytes: 8e6, maxStations: 1e4, maxSeedFiles: 1e5, maxArrivals: 1e4 }, 'run-1')
console.log(run.output) // { project, stations (renamed), arrivals (UTC), plotBatches }
```

The model-facing tools live in [`../tool-consistency`](../tool-consistency), and the agent preset
in `apps/cli/config/agent-presets/consistency`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>