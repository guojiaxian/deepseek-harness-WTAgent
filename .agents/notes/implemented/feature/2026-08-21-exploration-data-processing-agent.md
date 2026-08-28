# Agent Note: Exploration data processing agent

Status: implemented

English | [中文](2026-08-21-exploration-data-processing-agent.zh.md)

## Problem

The harness had no capability for domain processing of raw exploration data. A professional exploration-data agent (geology, geophysics, or well-log records) had to hand-roll parsers, unit conversions, statistics, and anomaly detection inside prompt text, with no shared engine, no validated pipeline configuration, and no traceability. The first format release had to cover CSV, JSON, and SEG-Y, and every processing step had to stay model-callable while remaining auditable.

## Decision

**Two packages form one capability seam, plus one runnable example.** The engine package `@deepseek-ai/dsh-exploration` owns pure, stateless processors (ingest, clean, convert, extract, detect), the format readers (CSV, JSON, SEG-Y with CP037 EBCDIC text-header decoding and IBM floating-point), a validated pipeline registry, and an `exploration` service. The model-facing package `@deepseek-ai/dsh-tool-exploration` registers six `exploration_*` tools that call the engine's pure processors directly. `examples/exploration-agent` composes the engine, tools, DeepSeek adapter, and agent spine into a runnable well-log-QC agent whose `well-log-qc` pipeline is declared in `cordis.yml`.

**The web surface ships it as an agent preset.** `apps/cli/config/agent-presets/exploration/` mounts `@deepseek-ai/dsh-tool-exploration` (plus shell, filesystem, ask-user, todo, and fetch-only web tools) behind an exploration persona. Because the tools call the engine's pure processors with an inline pipeline, no engine service row is needed in the preset. Both exploration packages are workspace dependencies of the host `@deepseek-ai/dsh-base` bundle and the `apps/cli` app so the Loader resolves the bare plugin names; changing either without the other breaks preset mount resolution.

**Inputs and outputs are tabular.** Raw CSV/JSON text or base64-encoded SEG-Y bytes becomes a typed `Dataset`; every processor returns a fresh dataset plus audit notes, and `exploration_run` returns the full `RunRecord` with step-level provenance. Model-visible output is therefore always reconstructable from the run record.

**Config validation fails loud.** Each step type has a Schemastery config schema validated at pipeline registration and at tool-call time; unknown options, unknown units, and non-numeric conversion targets throw typed `ExplorationError` codes (`VALIDATION_ERROR`, `INGEST_ERROR`, `LIMIT_EXCEEDED`, `PARSE_ERROR`, …) instead of degrading silently.

**Traceability is built in.** Every step appends a provenance line and each `runPipeline` call returns a `RunRecord` with a run id, step list, per-step notes, and an output summary; session persistence captures the turn, so the whole processing transcript replays from the session log.

## Alternatives considered

**One monolithic package.** Rejected because the harness convention is capability seams split by role; the engine/tool split keeps pure logic unit-testable without a Cordis context while the tools own registration and limits.

**A single mega tool that streams all steps.** Rejected because per-step tools let the model pick the needed stage and keep arguments small; `exploration_run` covers the full-pipeline case.

**Serving SEG-Y as text.** Rejected because SEG-Y is binary; base64 transport keeps the wire model-visible and unambiguous.

## Consequences

A model with the `exploration_*` tools can ingest, clean, convert, extract, and detect anomalies on CSV, JSON, or SEG-Y input and report the traceability run record. Pipelines are declarative `cordis.yml` config (the example registers `well-log-qc`); unknown steps, duplicate names, and bad config fail boot or tool call loud. The engine is pure and stateless, so it needs no runtime invariants (see `exploration-invariant`). Unit tests cover 100% of the engine and tool sources, the keyless loader smoke replays a real `exploration_run` round trip, and a real-key run through the example agent produced a correct gamma-ray QC (IQR flag at 15 m, z-score borderline). Future format readers (LAS, and so on) slot into the `format/` directory behind the same `ingestData` dispatch.
