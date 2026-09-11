---
description: "勘探数据处理引擎：面向 CSV、JSON 与 SEG-Y 记录的 ingest、clean、convert、extract、detect 与 profile 处理器，通过可配置、可追溯的流水线运行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-exploration

[English](README.md) | 中文

## 概述

**勘探数据处理引擎**：以 Cordis 服务加纯函数（框架无关）两种形态，对原始勘探记录（地质、地球物理、测井数据）进行专业处理。它解析 CSV、JSON 与 SEG-Y，通过可配置、可追溯的流水线完成数据清洗与转换、统计提取和异常检测。面向模型的 `exploration_*` 工具位于 [`@deepseek-ai/dsh-tool-exploration`](../tool-exploration)。

```ts ignore-check
import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-exploration'

const result = runPipeline(
  { format: 'csv', data: 'depth_m,gamma_api\n0,45\n15,220\n' },
  validatePipeline({
    name: 'quick-qc',
    steps: [
      { id: 'ingest', type: 'ingest' },
      { id: 'detect', type: 'detect', config: { zscore: [{ column: 'gamma_api' }] } },
    ],
  }),
  { maxInputBytes: 8 * 1024 * 1024, maxRows: 50_000, maxColumns: 1024, maxAnomalyRecords: 500 },
  crypto.randomUUID(),
)
```

## 目录

- [概述](#summary)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知局限与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **流水线形态** — 流水线是具名、有序的步骤列表，首步必须为 `ingest`；空流水线、重复步骤 id 与非法步骤配置会在 `validatePipeline` 时快速失败。作为插件（`name: exploration`），`Config.pipelines` 在挂载时通过 `ExplorationService` 注册各流水线。
- **步骤处理器** — 每个处理器暴露 `validate(config)` 与 `run(dataset, input?, limits?)`：
  - `ingest` 解析 CSV（分隔符、表头、类型推断、可选长表格式）或 JSON（记录／列式），以及 SEG-Y（字节序、道头字宽、可选 EBCDIC 头解码）。
  - `clean` 应用缺失值策略、数值范围、去重、列删除／重命名、字符串修剪与类型强制转换。
  - `convert` 通过仿射单位表进行单位换算、深度↔双程时间（`t = 2d/v`）与列选择。
  - `extract` 派生逐列描述性统计、滚动窗口与 RMS 振幅。
  - `detect` 标记 z-score、IQR、硬阈值、短窗尖峰、死道与缺失值异常。
  - `profile` 将二维地震剖面（SEG-Y 长表 `trace`／`sampleIndex`／`value`，或短表 `trace` 加 `sample_*` 列）渲染为颜色映射栅格（seismic／grayscale／jet），并以 PNG 和/或 SVG 嵌入 `meta.profile`。数据集无地震列、无行或无有限振幅时抛出 `INCOMPLETE_DATA`，暂停运行。
- **可追溯性** — `runPipeline` 在 `RunRecord` 上记录逐步骤 `StepRecord`（开始／结束时间戳、耗时、输入哈希、输出摘要、说明）与输入校验和。步骤失败会被记录在 run 记录上而不中断调用方，输出回退到最后一次成功的数据集。
- **单位与校验和** — `convert` 通过基准单位组合仿射变换，因此线性单位与带偏移单位（温度）共用同一条路径；`checksumBytes`／`checksumDataset` 使用稳定的 FNV-1a，保证记录跨运行可复现。
- **资源限制** — `Limits`（`maxInputBytes`、`maxRows`、`maxColumns`、`maxAnomalyRecords`）是经过校验的 Config 字段，在每一步之后强制执行；处理器内部无硬编码。

<a id="model-experience"></a>
## 模型体验

### 工具输出与错误

#### 模型所见

每个 `exploration_*` 工具返回紧凑的 JSON 结果（行内代码 `dataset`、`rowCount`、`columnCount`、`notes`），`exploration_run` 则返回带 `steps` 与 `outputSummary` 的完整可追溯 `RunRecord`。处理器错误以结构化 `ExplorationError` 代码（`VALIDATION_ERROR`、`LIMIT_EXCEEDED`、`INGEST_ERROR` 等）而非散文呈现。

#### Token 影响

调用前引擎不产生任何 token；每个结果行原样传递并在压缩前保留在历史中。

#### KV 缓存影响

引擎不贡献任何提示文本或前缀，因此不会影响 KV 缓存复用；只有工具自身的 schema 与结果渲染参与请求前缀稳定性。

## 已知局限与待办事项

- **仅内存处理** — 数据集整体保存在内存中（由 `Limits` 约束）；面向超大体量地震数据的流式或落盘溢出方案待实现。
- **SEG-Y 仅支持受限子集** — 解析器处理 3200 字节文本头、400 字节二进制头与可配置道头字宽的固定采样间隔地震道，但不支持 rev／扩展头、非标准格式或变长头。
- **统计基于简单分布假设** — z-score 检测假定数据近似正态；重尾或双峰分布的测井数据需要显式阈值规则。
- **单位表固定** — 转换基于静态符号表解析；新增项目专属单位需要修改代码而非配置项。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
