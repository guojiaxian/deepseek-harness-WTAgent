# Agent Note: Academic paper-writing agent

Status: implemented

English | [中文](2026-08-23-academic-paper-writing-agent.zh.md)

## Problem

The harness had no capability for professional academic manuscript processing. An academic-writing agent had to hand-roll content revision, format normalization, and reference formatting inside prompt text, with no shared engine, no validated pipeline configuration, and no citation-style support. The first release had to cover content revision, paper-format standardization, and reference organization into the mainstream citation styles GB/T 7714, APA, and MLA, every step staying model-callable while remaining auditable.

## Decision

**Two packages form one capability seam, plus one runnable example.** The engine package `@deepseek-ai/dsh-paper` owns pure, stateless processors (ingest, revise, format, cite), a reference parser with GB/T 7714, APA, and MLA formatters, a validated pipeline registry, and a `paper` service. The model-facing package `@deepseek-ai/dsh-tool-paper` registers five `paper_*` tools (ingest/revise/format/cite/run) that call the engine's pure processors directly. `examples/paper-agent` composes the engine, tools, DeepSeek adapter, and agent spine into a runnable polishing agent whose `academic-polish` pipeline is declared in `cordis.yml`.

**The web surface ships it as an agent preset.** `apps/cli/config/agent-presets/paper/` mounts `@deepseek-ai/dsh-tool-paper` (plus shell, filesystem, ask-user, todo, and fetch-only web tools) behind a paper-writing persona. Because the tools call the engine's pure processors with an inline pipeline, no engine service row is needed in the preset. Both paper packages are workspace dependencies of the host `@deepseek-ai/dsh-base` bundle and the `apps/cli` app so the Loader resolves the bare plugin names; changing either without the other breaks preset mount resolution.

**A manuscript is a structured paper.** Raw plain-text or Markdown becomes a typed `Paper` of ordered sections and parsed citations; every processor returns a fresh paper plus audit notes, and `paper_run` returns the full `RunRecord` with step-level provenance. Model-visible output is therefore always reconstructable from the run record.

**Config validation fails loud.** Each step type has a Schemastery config schema validated at pipeline registration and at tool-call time; unknown options, unknown citation styles, and over-limit inputs throw typed `PaperError` codes (`VALIDATION_ERROR`, `INVALID_STYLE`, `LIMIT_EXCEEDED`, …) instead of degrading silently.

**Traceability is built in.** Every step appends a provenance line and each `runPipeline` call returns a `RunRecord` with a run id, step list, per-step notes, and an output summary; session persistence captures the turn, so the whole editing transcript replays from the session log.

## Alternatives considered

**One monolithic package.** Rejected because the harness convention is capability seams split by role; the engine/tool split keeps pure logic unit-testable without a Cordis context while the tools own registration and limits.

**A single mega tool that streams all steps.** Rejected because per-step tools let the model pick the needed stage and keep arguments small; `paper_run` covers the full-pipeline case.

**Serving pre-rendered references only.** Rejected because the model needs stage control over content, format, and citations independently; citation style and sort options are per-call config, so one manuscript can target different styles.

## Consequences

A model with the `paper_*` tools can ingest a manuscript, revise its content, standardize its format, and organize its references into GB/T 7714, APA, or MLA and report the traceability run record. Pipelines are declarative `cordis.yml` config (the example registers `academic-polish`); unknown steps, duplicate names, and bad config fail boot or tool call loud. The engine is pure and stateless, so it needs no runtime invariants. Unit tests cover 100% of the engine and tool sources, and the keyless loader smoke replays a real `paper_run` round trip. Future citation styles slot into the `citation/` directory behind the same `formatCitation` dispatch.