# 科研论文写作

[English](paper.md) | 中文

科研论文写作服务（`ctx.paper`）校验插件配置中声明的具名流水线并注册，随后端到端执行：将原始手稿解析为结构化论文、修改与优化内容、规范化论文格式、将参考文献整理为 GB/T 7714、APA 或 MLA 格式，并返回可追溯的 run 记录。纯函数、框架无关的引擎函数与类型位于 [`@deepseek-ai/dsh-paper`](../../packages/paper/paper/README.zh.md)。

## 服务行为

[`PaperService`](../../packages/paper/paper/src/service.ts) 在挂载时校验每条配置的流水线、按名称注册，并从经过校验的 `Config` 字段解析部署限制。`runPipeline` 在 `RunRecord` 上记录逐步骤 `StepRecord`（时间戳、耗时、输入哈希、输出摘要、说明）与输入校验和；步骤失败会被记录在 run 记录上而不中断调用方，输出回退到最后一次成功的论文。面向模型的 `paper_*` 工具位于 [`@deepseek-ai/dsh-tool-paper`](../../packages/paper/tool-paper/README.zh.md)，它们直接调用引擎的纯处理器。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpaper--paperservice"></a>

### `ctx.paper` — `PaperService`

Registry and runner for academic paper-writing pipelines.

```ts cordis-catalog
/**
 * Register a named pipeline; duplicate names fail loud.
 * @param pipeline - raw pipeline definition to validate and register.
 */
registerPipeline(pipeline: unknown): void

/**
 * List the registered pipelines in registration order.
 * @returns the registered pipelines.
 */
listPipelines(): readonly Pipeline[]

/**
 * Run a registered pipeline by name over raw manuscript input.
 * @param name - registered pipeline name.
 * @param input - raw input handed to the ingest step.
 * @returns the traceability run record.
 */
run(name: string, input: ProcessingInput): RunRecord

/**
 * Run a one-off pipeline definition over raw manuscript input.
 * @param input - raw input handed to the ingest step.
 * @param pipeline - raw pipeline definition, validated before running.
 * @returns the traceability run record.
 */
runPipeline(input: ProcessingInput, pipeline: unknown): RunRecord
```

Source: [`packages/paper/paper/src/service.ts`](../../packages/paper/paper/src/service.ts)
<!-- END GENERATED cordis-surface -->