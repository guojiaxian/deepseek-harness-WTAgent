# Agent Note: Consistency-test agent

Status: implemented

English | [中文](2026-08-26-consistency-test-agent.zh.md)

## Problem

The harness had no dedicated capability for dense-array device consistency testing
(`conformance_test/workflow.md`). An operator had to hand-assemble the four phases — rename
station directories to a uniform convention, convert mini-SEED seeds to SAC with the
`mseed2sac`/`e-mseed2sac` converters, parse arrival times into cut windows and waveform plots, and
after plotting drop devices whose measured data offset is too large —
inside prompt text, with no shared engine, no validated pipeline config, no traceability, and no
reusable naming/window/batch rules.

## Decision

**Two packages form one capability seam, surfaced as an agent preset.** The engine package
`@deepseek-ai/dsh-consistency` owns pure, stateless processors (`ingest`, `rename`, `convert`,
`cut`, `plot`, `exclude`), the domain types, a validated pipeline registry, and a
`ConsistencyService`. The
model-facing package `@deepseek-ai/dsh-tool-consistency` registers the seven `consistency_*` tools
that call the engine's pure processors directly. The preset mounts the tool package behind the
consistency persona in `apps/cli/config/agent-presets/consistency` (`preset.yml` names it
一致性测试 Agent). The engine computes the error-prone domain decisions and records a traceability
`RunRecord`; the actual file I/O (directory renames, running converters, obspy slicing, matplotlib
rendering) is delegated to the preset's `tool-bash`/`tool-fs` tools guided by the engine's outputs.
Both consistency packages are workspace dependencies of the host `@deepseek-ai/dsh-base` bundle and
the `apps/cli` app so the Loader resolves the bare plugin names; changing either without the other
breaks preset mount resolution.

**The workflow flows as a pipeline through a `Workflow` state.** `ingest` builds the workflow from a
single interchange JSON (`project`, `stations` with seed file names, and raw `arrivalLines`).
`rename` derives each station's `targetName` — a leading `C` is stripped, otherwise the first 4
glyphs — with collision guarding that fails loud on duplicates. `convert` classifies each seed by
its `C`/`E` prefix into `SeedKind`, validates the selected converter command, and builds a
conversion plan; a missing converter raises `INCOMPLETE_DATA`, pausing the run. `cut` shifts the
北京时间 arrivals by the timezone offset (−8 h) to UTC and computes the `[cutBefore, cutAfter]`
windows and the `WT.<sta>_<label>_<b>s_<a>s.<chan>.SAC` file naming. `plot` partitions stations into
batches (default 40) per arrival, assigning stack offsets and `WT.<sta[:4]>` Y labels, with batch
height adapting to the actual station count; the rendered figures are then stitched in
excitation-time order into one adaptive-grid image (columns chosen from count / aspect ratio for a
balanced shape). `exclude`, after plotting, analyzes each station's
measured offset (DC baseline shift / static displacement) against the configured threshold and
reports which stations to exclude, recording an `Exclusion`. It leaves plot batches and data
untouched — removing the abnormal device from the array is a manual operator action.

**Config validation fails loud.** Each step type has a Schemastery config schema validated at
pipeline registration and tool-call time; unknown options and invalid step order throw typed
`ConsistencyError` codes (`VALIDATION_ERROR`, `UNKNOWN_PIPELINE`, `INCOMPLETE_DATA`, …) instead of
degrading silently.

**Traceability is built in.** Every step appends to the workflow's provenance and each `runPipeline`
call returns a `RunRecord` with a run id, step list, per-step notes, and an output summary; session
persistence captures the turn, so the whole workflow replays from the session log.

## Alternatives considered

**One monolithic package.** Rejected because the harness convention splits capability seams by role;
the engine/tool split keeps pure logic unit-testable without a Cordis context while the tools own
registration and limits.

**A single mega tool that streams all steps.** Rejected because per-step tools let the model pick
the needed stage and keep arguments small; `consistency_run` covers the full-pipeline case.

**Executing file I/O inside the engine.** Rejected because the engine stays framework-free and
dependency-free; the preset's shell and filesystem tools already own real I/O, so the engine returns
decisions and records rather than side effects.

## Consequences

A model with the `consistency_*` tools can ingest an interchange JSON, unify station names, plan
mini-SEED → SAC conversions, parse arrivals into UTC cut windows, partition plot batches, analyze
station offsets, and report which stations to exclude (plot batches unchanged),
reporting the traceability run record and letting the preset's shell/filesystem tools execute the
resulting file operations. Pipelines are declarative and inline; unknown steps, duplicate names,
and bad config fail boot or tool call loud. The engine is pure and stateless, so it carries an
empty invariant companion (`consistency-invariant`). Host typecheck (`tsc -b tsconfig.host.json`)
passes and the engine unit tests all pass (13/13), covering naming, collision guards, UTC parsing,
batch layout, offset-based exclusion reporting, and the full `runPipeline` round trip.