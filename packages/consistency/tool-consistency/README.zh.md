---
description: "位于 dsh-consistency 引擎之上的面向模型一致性测试工具：七个 consistency_* 工具构建密集台阵一致性测试工作流并运行引擎的纯处理器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-consistency

[English](README.md) | 中文

## 概述

基于 [`@deepseek-ai/dsh-consistency`](../consistency) 引擎的**面向模型一致性测试工具**：七个 `consistency_*` 工具，用于构建密集台阵一致性测试工作流并运行引擎的纯处理器。每个工具都通过引擎自身的配置 schema 校验参数、在工作流 JSON 上运行对应处理器，并返回更新后的工作流及台站／seed／到达／绘图批次数与来源说明；`consistency_run` 返回引擎的完整可追溯记录。实际的文件 I/O（重命名目录、运行转换器、obspy 裁波、偏移测量、matplotlib 绘图）交由 preset 的 `tool-bash`／`tool-fs` 工具在引擎输出的指引下执行。

## 目录

- [概述](#summary)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知局限与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **注册** — 插件（`name: tool-consistency`，`inject: ['tools']`）在 `ctx.tools` 上注册全部七个工具；资源 `Limits` 来自经过校验的 Config 字段。
- **`consistency_ingest`** — 从互换 JSON 载荷（工程、带 seed 文件名的台站目录、原始 `datetime.dat` 到达行）构建工作流。
- **`consistency_rename`** — 计算统一的台站目录名（去掉前导 `C`，否则取前 4 个字符）并做冲突守卫。
- **`consistency_convert`** — 校验 `mseed2sac`／`e-mseed2sac` 转换器，并按 `C`／`E` 类别构建 seed 转换规划。
- **`consistency_cut`** — 将原始到达行（北京时间）转为 UTC 到达时间窗与裁波文件名。
- **`consistency_plot`** — 按到达事件将台站划分为绘图批次（数值排序、堆叠偏移、`WT.<sta[:4]>` Y 轴标签），批次高度随实际台站数自适应。
- **`consistency_exclude`** — 绘制完成后，按配置 `threshold` 分析各台站实测数据偏移（用 obspy 测得的 DC 基线偏移／静位移），报告需要剔除的台站并记录 `Exclusion`。它只做分析：不改动绘图批次与数据——实际移除异常设备是人工操作。
- **`consistency_run`** — 校验具名流水线（首步必须为 `ingest`）并返回该次运行的 `RunRecord`（`runId`、`pipelineName`、`status`、`steps`、`output`、`outputSummary`）。步骤失败会记录（`status: 'failed'`，带错误码与步骤 id）而非抛出。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型所见

模型看到生成的 [`consistency_*` schemas](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-consistency)。`data` 为 JSON 文本（需要 `project`、`stations` 与 `arrivalLines`）；`workflow` 为先前 `consistency_*` 工具返回的 JSON 形态；`pipeline` 是 JSON 对象，其首步必须为 `ingest`。

#### Token 影响

工具可见的每次请求都有固定的 schema 开销；`workflow`／`config` JSON 参数不随部署变化。

#### KV 缓存影响

在工具集及其描述不变时前缀稳定；加载或销毁插件可能会使已变更 schema 区域的复用失效。

### 流水线运行记录

#### 模型所见

`consistency_run` 返回行内代码如 `runId`、`steps` 与 `outputSummary`（`stationCount`、`seedFileCount`、`arrivalCount`、`plotBatchCount`、`checksum`），模型可直接引用精确的可追溯记录，无需重新推导决策。

#### Token 影响

完整记录原样传递并在压缩前保留；`output` 在大台阵下可能较大，受部署 `Limits` 约束。

#### KV 缓存影响

仅追加；新可见的结果内容跟在可复用的请求前缀之后，不会使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与待办事项

- **工作流经由工具参数往返** — 转换工具传入并返回完整工作流 JSON，链式调用会在步骤间复制数据；共享会话内工作流存储待实现。
- **引擎只算决策，不算字节** — 工具产生命名／时间窗／批次规划与运行记录；执行重命名、转换器、obspy 裁波与绘图仍需要 preset 的 shell 与文件系统工具。
- **输入是单一互换 JSON** — ingest 步骤接受单个自包含 JSON 载荷；在流水线运行前，将真实目录树扫描进该载荷由 preset 的文件系统工具完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>