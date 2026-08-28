# Code Analysis

English | [中文](code.zh.md)

The code analysis service (`ctx.code`) configures and runs static analysis over source code across Python, JavaScript, and Java: language detection, line metrics, functions and classes, cyclomatic complexity, a 0–100 quality score, and static quality/security findings. The pure, framework-free engine functions and types live in [`@deepseek-ai/dsh-code`](../../packages/code/code/README.md). Static analysis runs entirely in-process; running, testing, and type-checking edited programs is delegated to the shell tool the model already has.

## Service behavior

[`CodeService`](../../packages/code/code/src/service.ts) is a thin, configurable wrapper over the engine's pure `analyze` function. It resolves the resource limits (`maxCodeBytes`, `maxFunctions`, `maxFindings`) and default static-check toggles from validated `Config` fields (deployment tunables, never hardcoded inside the analyzers). `analyze` runs language detection, metrics, complexity, and checks end to end, letting the caller override the limits and check toggles per call. The model-facing `code_analyze` / `code_check` tools in [`@deepseek-ai/dsh-tool-code`](../../packages/code/tool-code/README.md) call the same pure functions directly, so they need no engine service row in an agent preset.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcode--codeservice"></a>

### `ctx.code` — `CodeService`

Service exposing the engine's analysis behind `ctx.code`.

```ts cordis-catalog
/**
 * Analyze a source file end to end, using the service's configured limits and
 * default check toggles unless the caller overrides them.
 * @param fileName - optional file name used for language detection.
 * @param source - source text to analyze.
 * @param options - optional per-call overrides for limits and check toggles.
 * @returns the full analysis record.
 */
analyze( fileName: string | undefined, source: string, options?: { readonly limits?: OperationalLimits; readonly checks?: StaticCheckConfig }, ): CodeAnalysis
```

Source: [`packages/code/code/src/service.ts`](../../packages/code/code/src/service.ts)
<!-- END GENERATED cordis-surface -->