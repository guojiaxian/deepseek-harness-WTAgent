# 代码分析

[English](code.md) | 中文

代码分析服务（`ctx.code`）对跨 Python、JavaScript 与 Java 的源代码配置并运行静态分析：语言检测、行度量、函数与类、圈复杂度、0–100 质量得分以及静态质量／安全发现。纯函数、框架无关的引擎函数与类型位于 [`@deepseek-ai/dsh-code`](../../packages/code/code/README.zh.md)。静态分析完全在进程内执行；运行、测试与类型检查被修改的程序则委托给模型已有的 shell 工具。

## 服务行为

[`CodeService`](../../packages/code/code/src/service.ts) 是引擎纯 `analyze` 函数之上一个薄的可配置封装。它从经过校验的 `Config` 字段（部署可调项，绝不在分析器中硬编码）解析资源限额（`maxCodeBytes`、`maxFunctions`、`maxFindings`）与默认静态检查开关。`analyze` 端到端运行语言检测、度量、复杂度与检查，允许调用方按次覆盖限额与检查开关。面向模型的 `code_analyze` / `code_check` 工具位于 [`@deepseek-ai/dsh-tool-code`](../../packages/code/tool-code/README.zh.md)，它们直接调用同一组纯函数，因此在 agent preset 中无需引擎服务行。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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