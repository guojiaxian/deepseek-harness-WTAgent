---
description: "位于 dsh-exploration 引擎之上的面向模型勘探工具：六个 exploration_* 工具解析原始勘探记录并运行引擎的纯处理器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-exploration

[English](README.md) | 中文

## 概述

基于 [`@deepseek-ai/dsh-exploration`](../exploration) 引擎的**面向模型勘探工具**：六个 `exploration_*` 工具，用于解析原始勘探记录并运行引擎的纯处理器。每个工具都通过引擎自身的配置 schema 校验参数、运行对应处理器，并返回紧凑的 JSON 数据集及行列计数与来源说明；`exploration_run` 返回完整的可追溯记录。

## 目录

- [概述](#summary)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知局限与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **注册** — 插件（`name: tool-exploration`，`inject: ['tools']`）在 `ctx.tools` 上注册全部六个工具；资源 `Limits` 来自经过校验的 Config 字段。
- **`exploration_ingest`** — 将原始 CSV／JSON 文本或 base64 编码的 SEG-Y 解析为表格数据集。
- **`exploration_clean`** — 缺失值策略、数值范围、去重、删除／重命名、字符串修剪与类型强制转换。
- **`exploration_convert`** — 单位换算、深度↔双程时间与列选择。
- **`exploration_extract`** — 描述性统计、滚动窗口与 RMS 振幅。
- **`exploration_detect`** — z-score、IQR、硬阈值、尖峰、死道与缺失值异常。
- **`exploration_profile`** — 将地震剖面（SEG-Y 长表或短表格式）渲染为 PNG 和/或 SVG，置于 `profile` 键下，供解析并验证剖面之后使用。
- **`exploration_run`** — 校验具名流水线（首步必须为 `ingest`）并返回该次运行的 `RunRecord`（`runId`、`pipelineName`、`status`、`steps`、`output`、`outputSummary`）。步骤失败会记录而非抛出。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型所见

模型看到生成的 [`exploration_*` schemas](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-exploration)。`format` 为枚举（`csv`／`json`／`segy`）；`segy` 数据以 base64 传输；`pipeline` 是 JSON 对象，其首步必须为 `ingest`。

#### Token 影响

工具可见的每次请求都有固定的 schema 开销；`pipeline`／`config` JSON 参数不随部署变化。

#### KV 缓存影响

在工具集及其描述不变时前缀稳定；加载或销毁插件可能会使已变更 schema 区域的复用失效。

### 流水线运行记录

#### 模型所见

`exploration_run` 返回行内代码如 `runId`、`steps` 与 `outputSummary`（`rowCount`、`columnCount`、`shape`、`checksum`），模型可直接引用精确的可追溯记录，无需重渲染数据。

#### Token 影响

完整记录原样传递并在压缩前保留；`output` 在大数据集下可能较大，受部署 `Limits` 约束。

#### KV 缓存影响

仅追加；新可见的结果内容跟在可复用的请求前缀之后，不会使既有 KV 缓存条目失效。

## 已知局限与待办事项

- **数据集经由工具参数往返** — 转换工具传入并返回完整数据集 JSON，链式调用会在步骤间复制数据；共享会话内数据集存储待实现。
- **SEG-Y 以 base64 传输** — 输入为文本或 base64 字符串；未暴露直接二进制文件解析与落盘输出。
- **输出大小由调用方约束** — 五个转换工具以 JSON 返回完整数据集；超大结果集依赖部署的 `maxRows`／`maxColumns` 限制而非分页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
