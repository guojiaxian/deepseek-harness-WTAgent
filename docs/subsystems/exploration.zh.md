# 勘探数据处理

[English](exploration.md) | 中文

勘探数据处理服务（`ctx.exploration`）校验插件配置中声明的具名流水线并注册，随后端到端执行：接收原始勘探记录（地质、地球物理或测井数据）、清洗数据集、单位或深度／时间转换、统计提取与异常检测，并返回可追溯的 run 记录。纯函数、框架无关的引擎函数与类型位于 [`@deepseek-ai/dsh-exploration`](../../packages/exploration/exploration/README.zh.md)。

## 服务行为

[`ExplorationService`](../../packages/exploration/exploration/src/service.ts) 在挂载时校验每条配置的流水线、按名称注册，并从经过校验的 `Config` 字段解析部署限制。`runPipeline` 在 `RunRecord` 上记录逐步骤 `StepRecord`（时间戳、耗时、输入哈希、输出摘要、说明）与输入校验和；步骤失败会被记录在 run 记录上而不中断调用方，输出回退到最后一次成功的数据集。面向模型的 `exploration_*` 工具位于 [`@deepseek-ai/dsh-tool-exploration`](../../packages/exploration/tool-exploration/README.zh.md)，它们直接调用引擎的纯处理器。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxexploration--explorationservice"></a>

### `ctx.exploration` — `ExplorationService`

Registry and runner for exploration data processing pipelines.

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
 * Run a registered pipeline by name over raw input.
 * @param name - registered pipeline name.
 * @param input - raw input handed to the ingest step.
 * @returns the traceability run record.
 */
run(name: string, input: ProcessingInput): RunRecord

/**
 * Run a one-off pipeline definition over raw input.
 * @param input - raw input handed to the ingest step.
 * @param pipeline - raw pipeline definition, validated before running.
 * @returns the traceability run record.
 */
runPipeline(input: ProcessingInput, pipeline: unknown): RunRecord
```

Source: [`packages/exploration/exploration/src/service.ts`](../../packages/exploration/exploration/src/service.ts)
<!-- END GENERATED cordis-surface -->
