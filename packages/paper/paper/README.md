---
description: "The academic paper-writing engine: parse, revise, format, and cite processors plus document export for plain-text or Markdown manuscripts through a configurable, traceable pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-paper

English | [中文](README.zh.md)

## Summary

The **academic paper-writing engine**: professional manuscript processing as a Cordis service plus pure, framework-free functions. It parses plain-text or Markdown manuscripts into structured papers, revises content for clarity, standardizes format, and formats references into GB/T 7714, APA, or MLA through a configurable, traceable pipeline. The model-facing `paper_*` tools live in [`@deepseek-ai/dsh-tool-paper`](../tool-paper).

```ts ignore-check
import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-paper'

const result = runPipeline(
  { format: 'markdown', data: '# A Study\n\nAbstract…\n\n## Method\n\nWe studied…\n' },
  validatePipeline({
    name: 'polish',
    steps: [
      { id: 'ingest', type: 'ingest' },
      { id: 'revise', type: 'revise' },
      { id: 'cite', type: 'cite', config: { style: 'gb7714' } },
    ],
  }),
  { maxInputBytes: 8 * 1024 * 1024, maxSections: 200, maxParagraphs: 200, maxCitations: 500, maxFindings: 200 },
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

- **Pipeline shape** — a pipeline is a named, ordered list of steps whose first step must be `ingest`; empty pipelines, duplicate step ids, and invalid step configs fail loud during `validatePipeline`. As a plugin (`name: paper`), `Config.pipelines` registers each pipeline on mount through `PaperService`.
- **Step processors** — each processor exposes `validate(config)` and `run(paper, input?, limits?)`:
  - `ingest` parses plain-text or Markdown manuscripts into a `Paper` with a detected title, an abstract section lifted into a dedicated field, heading levels, paragraphs, and parsed references.
  - `revise` analyzes content and emits suggestions: clarity rewrites, passive-voice detection, and cliché flagging.
  - `format` standardizes a paper: numbers `level` headings, normalizes spacing/punctuation, curves typographic quotes, and completes dangling citation marks.
  - `cite` renders every reference through the GB/T 7714, APA, or MLA formatter, with optional alphabetical sorting.
- **Traceability** — `runPipeline` records per-step `StepRecord`s (start/finish timestamps, duration, input hash, output summary, notes) on a `RunRecord` with an input checksum. A failing step is captured on the record without aborting the caller, and the output falls back to the last completed paper.
- **Checksums** — the input and each output are fingerprinted with a stable FNV-1a checksum so records replay identically across runs.
- **Document export** — `renderDocument` turns a `Paper` plus a resolved `DocumentConfig` into a `.docx` (real OOXML in a ZIP archive) or `.doc` (classic RTF) file with running headers/footers, a page-number field, a body font family and size, line spacing, paragraph spacing, and uniform margins — all dependency-free, driven by one config shared across both renderers. `validateDocumentConfig` fails loudly on unknown keys or out-of-range values, and an over-sized result raises `LIMIT_EXCEEDED` carrying the measured bytes, the cap, and how to resolve it.
- **Resource limits** — `Limits` (`maxInputBytes`, `maxSections`, `maxParagraphs`, `maxCitations`, `maxFindings`, `maxOutputBytes`) are validated Config fields enforced after every step; nothing is hardcoded inside the processors.

<a id="model-experience"></a>
## Model Experience

### Tool outputs and errors

#### What the model sees

Each structural `paper_*` tool returns a compact JSON result with inline code (`paper`, `sectionCount`, `citationCount`, `notes`) or, for `paper_run`, the full traceability `RunRecord` with `steps` and `outputSummary`. Processor errors surface as structured `PaperError` codes (`VALIDATION_ERROR`, `LIMIT_EXCEEDED`, `UNSUPPORTED_FORMAT`, …) rather than prose.

#### Token effect

Zero engine tokens before a call; every result paper is passed through unchanged and retained in history until compaction.

#### KV Cache effect

The engine contributes no prompt text and no prefix, so it never affects KV-cache reuse; only the tools' own schema and result rendering participate in request prefix stability.

## Known Limitations and Deferred Work

- **In-memory processing only** — manuscripts are held whole in memory (bounded by `Limits`); streaming or on-disk spill for very large papers is deferred.
- **Citation parsing is heuristic** — references are parsed from bracket-labelled entries (`[1] …`, `[Smith, 2020] …`) and annotated source markers; free-form or template-mangled reference lists may misclassify, requiring the model to adjust fields.
- **Format and style rules are fixed** — clarity checks, typographic rules, and the GB/T 7714/APA/MLA renderers encode a fixed style table; journal- or venue-specific tweaks need a code change rather than a Config entry.
- **English-centric heuristics** — passive-voice, cliché, and sentence-scale rewrite heuristics assume academic English; other-language quality gates are out of scope.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>