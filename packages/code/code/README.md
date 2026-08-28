# @deepseek-ai/dsh-code

English | [中文](README.zh.md)

The **code analysis engine**: static analysis of source across Python, JavaScript, and Java as a Cordis service (`ctx.code`) plus pure, framework-free functions. It detects the language, counts line metrics, functions, and classes, computes cyclomatic complexity, runs static quality/security checks, and derives a deterministic 0–100 quality score. Static analysis is pure and in-process; running, testing, and type-checking edited programs is delegated to the shell tool the model already has. The model-facing `code_*` tools live in [`@deepseek-ai/dsh-tool-code`](../tool-code).

```ts
import { analyze } from '@deepseek-ai/dsh-code'

const result = analyze(
  'util.ts',
  'function classify(code: number): string {\n  return code < 0 ? "neg" : code < 100 ? "small" : "large"\n}\n',
)
console.log(result.language, result.qualityScore, result.metrics.functions)
```

## Behavior

- **Input** — `analyze(fileName, source, options?)` runs language detection (a known `fileName` extension wins over content heuristics), then metrics (`lines`, `code`, `comment`, `blank`, `functions`, `classes`), cyclomatic complexity (overall, average, max, per-function), static checks, and the quality score. Throws `CodeError` (`code: 'LIMIT_EXCEEDED'`) when the source exceeds `maxCodeBytes`.
- **Resource limits** — `OperationalLimits` (`maxCodeBytes`, `maxFunctions`, `maxFindings`) are validated Config fields; the analyzers hold no hardcoded caps.
- **Quality score** — a deterministic penalty-accumulation heuristic over findings and complexity (errors −10, warnings −4, infos −1, plus complexity deductions), floored at 0 and rounded, so hosts can rank files without depending on ordering.
- **Language detection** — `detectLanguage(fileName, source)` resolves `.py`/`.js`/`.mjs`/`.java`/`.ts`/`.jsx`/`.tsx` extensions and JSX/arrow-function content heuristics; unknown input routes to a generic analyzer and adds a `notes` entry.
- **Static checks** — `runChecks(language, source, checks?)` scans for dangerous dynamic execution, raw SQL concatenation, hardcoded secrets, TODO markers, debugger residue, and empty/bare exception handlers; rule toggles (`dangerous`, `secrets`, `todos`, `debugResidue`, `emptyCatch`, `broadCatch`) are Config fields.
- **Notes** — `analyze` summarizes non-obvious conditions (undetected language, no functions, capped records/findings, complexity-guideline breaches) so the model can reason about what the analyzers could and could not do.
- **Service** — as a plugin (`name: code`), the engine mounts `CodeService` on `ctx.code`; `code.analyze(...)` applies the service's configured limits and default check toggles unless the caller overrides them per call.

## Model Experience

### Tool outputs and errors

#### What the model sees

Each tool returns a compact JSON record: `language`, `qualityScore`, `metrics`, `complexity`, `findings`, and `notes` for `code_analyze`; a findings-focused `language`/`findingCount`/`errorCount`/`warningCount`/`infoCount`/`findings` view for `code_check`. Analyzer failures surface as structured `CodeError` codes (`LIMIT_EXCEEDED`) rather than prose.

#### Token effect

Zero engine tokens before a call; every finding and metric is passed through unchanged and retained in history until compaction.

#### KV Cache effect

The engine contributes no prompt text and no prefix, so it never affects KV-cache reuse; only the tools' own schemas and result rendering participate in request-prefix stability.

## Known Limitations and Deferred Work

- **Static-only analysis** — the engine reports complexity, metrics, and finds code smells but does not execute or type-check programs; running and testing edited code is the model's job through the shell and LSP tools.
- **Three languages plus generic** — detection and the complexity/metrics analyzers are tuned for Python, JavaScript/TypeScript, and Java; other languages fall back to the generic analyzer with best-effort metrics.
- **Cyclomatic complexity is a structural heuristic** — it counts decision points per function but does not model data-flow or interprocedural paths, so it is a guideline, not a proof of maintainability.
- **Fixed check rule set** — checks are a curated static directory; project-specific lint rules need a code addition or an external linter rather than a Config entry.