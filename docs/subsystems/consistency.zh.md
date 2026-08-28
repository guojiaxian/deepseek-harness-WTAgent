# 密集台阵一致性测试

[English](consistency.md) | 中文

密集台阵一致性测试服务（`ctx.consistency`）校验插件配置中声明的具名流水线并注册，随后端到端执行：统一台站目录名、按 `C`／`E` 类别规划 mini-SEED → SAC 转换、将 `datetime.dat` 到达时刻（北京时间 → UTC）解析为裁波时间窗、把台站划分为波形绘图批次，并在绘制完成后按配置阈值分析各台站实测数据偏移、报告需要剔除的台站（异常设备由人工移除），返回可追溯的 run 记录。通用的流水线形态与探索、论文服务一致，均为 `ingest → …` 流程。纯函数、框架无关的引擎函数与类型位于 [`@deepseek-ai/dsh-consistency`](../../packages/consistency/consistency/README.zh.md)。

## 服务行为

[`ConsistencyService`](../../packages/consistency/consistency/src/service.ts) 在挂载时校验每条配置的流水线、按名称注册，并从经过校验的 `Config` 字段解析部署限制。`runPipeline` 在 `RunRecord` 上记录逐步骤 `StepRecord`（时间戳、耗时、输入哈希、输出摘要、说明）与输入校验和；步骤失败——包括缺少转换器时的 `INCOMPLETE_DATA` convert 步骤——会被记录在 run 记录上而不中断调用方，输出回退到最后一次成功的工作流。面向模型的 `consistency_*` 工具位于 [`@deepseek-ai/dsh-tool-consistency`](../../packages/consistency/tool-consistency/README.zh.md)，它们直接调用引擎的纯处理器。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxconsistency--consistencyservice"></a>

### `ctx.consistency` — `ConsistencyService`

Registry and runner for consistency-test engineering pipelines.

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

Source: [`packages/consistency/consistency/src/service.ts`](../../packages/consistency/consistency/src/service.ts)
<!-- END GENERATED cordis-surface -->