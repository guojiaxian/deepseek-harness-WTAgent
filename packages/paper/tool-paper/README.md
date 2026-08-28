# @deepseek-ai/dsh-tool-paper

English | [中文](README.zh.md)

The **model-facing paper tools** over the [`@deepseek-ai/dsh-paper`](../paper) engine: six `paper_*` tools that ingest raw manuscripts, run the engine's pure processors, and export polished documents. Every tool validates its arguments through the engine's own config schemas, runs the matching processor, and returns a compact JSON paper plus section/citation counts and provenance notes; `paper_run` returns the full traceability record.

## Behavior

- **Registration** — the plugin (`name: tool-paper`, `inject: ['tools']`) registers all six tools on `ctx.tools`; resource `Limits` come from validated Config fields.
- **`paper_ingest`** — parses raw plain-text or Markdown manuscript text into a structured paper with sections and references.
- **`paper_revise`** — analyzes a paper and returns content-revision suggestions: clarity rewrites, passive-voice detection, and cliché flagging.
- **`paper_format`** — standardizes a paper: numbers headings, normalizes spacing, curves typographic quotes, and completes citation marks.
- **`paper_cite`** — renders every reference in a target style (`gb7714` | `apa` | `mla`), optionally sorting entries.
- **`paper_run`** — validates a named pipeline (first step must be `ingest`) and returns the run's `RunRecord` (`runId`, `pipelineName`, `status`, `steps`, `output`, `outputSummary`). A failing step is recorded, not thrown.
- **`paper_export`** — renders a paper into a `.docx` or `.doc` file with a structured layout config and returns the base64-ed bytes, their sha256 checksum, format, and byte count; an unsupported format or a result that exceeds the deployment's output cap is surfaced as a structured error with recovery guidance.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`paper_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-paper). `format` is an enum (`text`/`markdown`); `style` is an enum (`gb7714`/`apa`/`mla`); `paper` and `pipeline` are JSON objects. Transform tools take and return the paper JSON, so results chain across calls.

#### Token effect

Fixed schema cost on every request where the tools are visible; the `paper`/`config`/`pipeline` JSON parameters carry no per-deployment variation.

#### KV Cache effect

Prefix-stable while the tool set and its descriptions are unchanged; loading or disposing the plugin may invalidate reuse from the changed schema region.

### Pipeline run record

#### What the model sees

`paper_run` returns inline code such as `runId`, `steps`, and `outputSummary` (`sectionCount`, `citationCount`, `characterCount`, `checksum`) so the model can cite the exact traceability record instead of re-rendering the paper.

#### Token effect

The full record is passed through and retained until compaction; `output` can be large for big papers, bounded by the deployment's `Limits`.

#### KV Cache effect

Append-only; newly visible result content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Papers round-trip through tool arguments** — transform tools take and return the full paper JSON, so chained calls duplicate the manuscript between steps; a shared in-session manuscript store is deferred.
- **Input is text only** — ingest reads plain text or Markdown strings; `.docx`/PDF file extraction is not exposed.
- **Exports return base64 in JSON, not a file handle** — `paper_export` returns the document as base64-ed bytes inside the tool result; writing that to disk or streaming a file download happens in the host app, not the tool.
- **Output size is caller-bounded** — the four transform tools return the whole paper as JSON; very large result sets rely on the deployment's `maxSections`/`maxParagraphs`/`maxCitations` limits rather than pagination.