---
description: "A plugin family that turns raw manuscripts into polished academic papers: structured sections and references, clarity revision, GB/T 7714/APA/MLA formatting, and document export with a traceability run record."
kind: "package-group"
---

# paper/ — academic paper writing

English | [中文](README.zh.md)

A plugin family that turns raw manuscripts (plain text or Markdown) into polished academic papers: parsed into structured sections and references, revised for clarity, standardized in format, and reformatted into GB/T 7714, APA, or MLA, with a traceability run record.

| Package | Role | ctx key |
|---|---|---|
| [`paper/`](paper/README.md) | Owns the engine: paper/section/citation types, the reference parser, citation formatters (GB/T 7714, APA, MLA), pure processors (ingest/revise/format/cite), and the validated named-pipeline service | `ctx.paper` |
| [`tool-paper/`](tool-paper/README.md) | Registers the model-facing `paper_*` tools that call the engine's pure processors | — |

The engine stays framework-free so the model-facing tools can call its processors directly; the service owns the validated named pipelines and the end-to-end `runPipeline`. The subsystem reference is [docs/subsystems/paper.md](../../docs/subsystems/paper.md).