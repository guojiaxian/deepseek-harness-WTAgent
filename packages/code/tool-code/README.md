---
description: "Model-facing code tools over the dsh-code engine: code_analyze and code_check run the engine's pure static analyzers on a source snippet."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-code

English | [中文](README.zh.md)

## Summary

The **model-facing code tools** over the [`@deepseek-ai/dsh-code`](../code) engine: two `code_*` tools that run the engine's pure static analyzers (language detection, metrics, cyclomatic complexity, quality score, and static quality/security findings) on a source snippet. Every tool validates its arguments and resource limits through the engine's own config schema and returns compact JSON; `code_analyze` returns the full analysis record, while `code_check` returns a findings-focused view for quality and security scanning.

## Table of Contents

- [Summary](#summary)
- [Behavior](#behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="behavior"></a>
## Behavior

- **Registration** — the plugin (`name: tool-code`, `inject: ['tools']`) registers both tools on `ctx.tools`; resource limits (`maxCodeBytes`, `maxFunctions`, `maxFindings`) and default check toggles come from validated Config fields.
- **`code_analyze`** — returns `language`, `qualityScore`, `metrics`, `complexity`, `findings`, and `notes` for a source snippet; `fileName` and per-call `checks` overrides are optional.
- **`code_check`** — returns a findings-focused `language`/`findingCount`/`errorCount`/`warningCount`/`infoCount`/`findings` view; a source that exceeds `maxCodeBytes` fails loud with `CodeError` (`LIMIT_EXCEEDED`).
- **Rendering** — both tools present a generic, args-only card and render a one-line summary (`Analyzed <language>: N functions, M lines, quality Q/100` for `code_analyze`; `Checked code: N finding(s) — E error(s), W warning(s)` for `code_check`).

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`code_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-code). `source` is a required string; `fileName` (a known extension wins over content heuristics for language detection) and `checks` (a JSON object of rule toggles) are optional.

#### Token effect

Fixed schema cost on every request where the tools are visible; `source` and `checks` JSON parameters carry no per-deployment variation.

#### KV Cache effect

Prefix-stable while the tool set and its descriptions are unchanged; loading or disposing the plugin may invalidate reuse from the changed schema region.

### Analysis record

#### What the model sees

Both tools return inline code such as `language`, `qualityScore`, and `findings` (each with `rule`, `severity`, `message`, and `location`), so the model can cite the exact analysis instead of re-reading source. `code_analyze` also returns `metrics` and `complexity` for planning and reporting.

#### Token effect

The full record is passed through and retained until compaction; `findings` is bounded by the deployment's `maxFindings`.

#### KV Cache effect

Append-only; newly visible result content follows the reusable request prefix and does not invalidate existing KV-cache entries.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Source rides as a tool argument** — analysis takes the source text inline, so large files travel whole through the request; file-path-based analysis and cross-file project analysis are deferred.
- **Static-only output** — the tools report complexity, metrics, and smells but do not execute or type-check; running and testing edited code is the model's job through the shell and LSP tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>