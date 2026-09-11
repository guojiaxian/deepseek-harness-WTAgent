---
description: "位于 dsh-paper 引擎之上的面向模型论文工具：六个 paper_* 工具解析原始手稿、运行引擎的纯处理器并导出规范化文档。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-paper

[English](README.md) | 中文

## 概述

基于 [`@deepseek-ai/dsh-paper`](../paper) 引擎的**面向模型论文工具**：六个 `paper_*` 工具，用于解析原始手稿、运行引擎的纯处理器并导出规范化文档。每个工具都通过引擎自身的配置 schema 校验参数、运行对应处理器，并返回紧凑的 JSON 论文及章节／引文计数与来源说明；`paper_run` 返回完整的可追溯记录。

## 目录

- [概述](#summary)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知局限与待办事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **注册** — 插件（`name: tool-paper`，`inject: ['tools']`）在 `ctx.tools` 上注册全部六个工具；资源 `Limits` 来自经过校验的 Config 字段。
- **`paper_ingest`** — 将原始纯文本或 Markdown 手稿文本解析为含章节与参考文献的结构化论文。
- **`paper_revise`** — 分析论文并返回内容修订建议：清晰度改写、被动语态检测与陈词滥调标记。
- **`paper_format`** — 规范化论文：为标题编号、规范间距、转换排版引号并补齐引用标记。
- **`paper_cite`** — 以目标样式（`gb7714` | `apa` | `mla`）渲染每条参考文献，可按需排序。
- **`paper_run`** — 校验具名流水线（首步必须为 `ingest`）并返回该次运行的 `RunRecord`（`runId`、`pipelineName`、`status`、`steps`、`output`、`outputSummary`）。步骤失败会记录而非抛出。
- **`paper_export`** — 以结构化布局配置将论文渲染为 `.docx` 或 `.doc` 文件，返回 base64 后的字节、其 sha256 校验和、格式与字节数；不支持的格式或结果超过部署输出上限时，以带恢复建议的结构化错误呈现。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型所见

模型看到生成的 [`paper_*` schemas](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-paper)。`format` 为枚举（`text`／`markdown`）；`style` 为枚举（`gb7714`／`apa`／`mla`）；`paper` 与 `pipeline` 为 JSON 对象。转换工具传入并返回论文 JSON，结果可跨调用链式传递。

#### Token 影响

工具可见的每次请求都有固定的 schema 开销；`paper`／`config`／`pipeline` JSON 参数不随部署变化。

#### KV 缓存影响

在工具集及其描述不变时前缀稳定；加载或销毁插件可能会使已变更 schema 区域的复用失效。

### 流水线运行记录

#### 模型所见

`paper_run` 返回行内代码如 `runId`、`steps` 与 `outputSummary`（`sectionCount`、`citationCount`、`characterCount`、`checksum`），模型可直接引用精确的可追溯记录，无需重渲染论文。

#### Token 影响

完整记录原样传递并在压缩前保留；`output`在大论文下可能较大，受部署 `Limits` 约束。

#### KV 缓存影响

仅追加；新可见的结果内容跟在可复用的请求前缀之后，不会使既有 KV 缓存条目失效。

## 已知局限与待办事项

- **论文经由工具参数往返** — 转换工具传入并返回完整论文 JSON，链式调用会在步骤间复制手稿；共享会话内手稿存储待实现。
- **输入仅限文本** — ingest 仅读取纯文本或 Markdown 字符串；未暴露 `.docx`／PDF 文件提取。
- **导出以 base64 形式返回 JSON，而非文件句柄** — `paper_export` 将文档作为工具结果内的 base64 字节返回；写入磁盘或流式下载由宿主应用完成，而非该工具。
- **输出大小由调用方约束** — 四个转换工具以 JSON 返回完整论文；超大结果集依赖部署的 `maxSections`／`maxParagraphs`／`maxCitations` 限制而非分页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>