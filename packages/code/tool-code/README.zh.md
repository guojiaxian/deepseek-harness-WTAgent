---
description: "位于 dsh-code 引擎之上的面向模型代码工具：code_analyze 与 code_check 在源码片段上运行引擎的纯静态分析器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-code

[English](README.md) | 中文

## 概述

位于 [`@deepseek-ai/dsh-code`](../code) 引擎之上的**面向模型的代码工具**：两个 `code_*` 工具在源码片段上运行引擎的纯静态分析器（语言检测、度量、圈复杂度、质量得分以及静态质量／安全发现）。每个工具都通过引擎自身的配置 schema 校验其参数与资源限额，并返回紧凑 JSON；`code_analyze` 返回完整的分析记录，`code_check` 则返回聚焦发现的质量与安全扫描视图。

## 目录

- [概述](#summary)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知局限与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **注册** — 插件（`name: tool-code`，`inject: ['tools']`）在 `ctx.tools` 上注册两个工具；资源限额（`maxCodeBytes`、`maxFunctions`、`maxFindings`）与默认检查开关来自经过校验的 Config 字段。
- **`code_analyze`** — 返回源码片段的 `language`、`qualityScore`、`metrics`、`complexity`、`findings` 与 `notes`；`fileName` 与按次 `checks` 覆盖为可选项。
- **`code_check`** — 返回聚焦发现的 `language`/`findingCount`/`errorCount`/`warningCount`/`infoCount`/`findings` 视图；超过 `maxCodeBytes` 的源码以 `CodeError`（`LIMIT_EXCEEDED`）响亮失败。
- **渲染** — 两个工具均展示仅含参数的通用卡片，并渲染一行摘要（`code_analyze` 为 `Analyzed <language>: N functions, M lines, quality Q/100`；`code_check` 为 `Checked code: N finding(s) — E error(s), W warning(s)`）。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型所见

模型看到生成的 [`code_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-code)。`source` 是必填字符串；`fileName`（已知扩展名优先于内容启发式进行语言检测）与 `checks`（规则开关的 JSON 对象）为可选项。

#### Token 影响

在工具可见的每个请求上都有固定 schema 成本；`source` 与 `checks` JSON 参数不随部署变化。

#### KV 缓存影响

只要工具集与其描述不变，前缀即稳定；加载或卸载插件可能因 schema 区域变化而使复用失效。

### 分析记录

#### 模型所见

两个工具均返回 `language`、`qualityScore` 与 `findings`（每条含 `rule`、`severity`、`message` 与 `location`）等内联代码，使模型可引用精确分析而非重读源码。`code_analyze` 还返回 `metrics` 与 `complexity`，用于规划与报告。

#### Token 影响

完整记录被透传并保留至压缩；`findings` 受部署 `maxFindings` 约束。

#### KV 缓存影响

仅追加；新出现的可见结果内容跟随可复用的请求前缀，不会使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与待办工作

- **源码作为工具参数传递** — 分析内联接收源码文本，因此大文件会整体随请求传输；基于文件路径的分析与跨文件项目分析待办。
- **仅静态输出** — 工具报告复杂度、度量与坏味道，但不会执行或类型检查；运行与测试被修改的代码由模型通过 shell 与 LSP 工具完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>