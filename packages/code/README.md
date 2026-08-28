---
description: "A plugin family that grounds a program-development agent's changes in static analysis of Python, JavaScript, and Java source: language detection, metrics, complexity, quality score, and quality/security findings."
kind: "package-group"
---

# code/ — program development assistance

English | [中文](README.zh.md)

A plugin family that grounds a program-development agent's changes in static analysis of the source it writes, completes, refactors, and optimizes across Python, JavaScript, and Java: language detection, line metrics, functions and classes, cyclomatic complexity, a quality score, and static quality/security findings. Analysis is pure and in-process; running, testing, and type-checking edited programs is delegated to the shell tool the model already has.

| Package | Role | ctx key |
|---|---|---|
| [`code/`](code/README.md) | Owns the engine: language detection, metrics, complexity, static checks, and the validated analysis service | `ctx.code` |
| [`tool-code/`](tool-code/README.md) | Registers the model-facing `code_analyze` / `code_check` tools that call the engine's pure analyzers | — |

The engine stays framework-free so the model-facing tools can call its analyzers directly; the service (`ctx.code`) owns the validated limits and default check toggles and the end-to-end `analyze`. The subsystem reference is [docs/subsystems/code.md](../../docs/subsystems/code.md). The runnable example is [examples/code-agent](../../examples/code-agent).