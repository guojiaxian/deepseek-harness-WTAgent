---
description: "代码分析引擎：对 Python、JavaScript 与 Java 源码进行语言检测、行度量、圈复杂度、静态质量／安全校验，并推导确定性的质量得分。"
kind: "package-reference"
---

# @deepseek-ai/dsh-code

[English](README.md) | 中文

## 概述

**代码分析引擎**：以 Cordis 服务（`ctx.code`）加纯函数、框架无关函数的形式，对 Python、JavaScript 与 Java 源码进行静态分析。它检测语言、统计行度量、函数与类、计算圈复杂度、运行静态质量／安全检查，并推导出确定性的 0–100 质量得分。静态分析是纯函数且完全在进程内执行；运行、测试与类型检查被修改的程序则委托给模型已有的 shell 工具。面向模型的 `code_*` 工具位于 [`@deepseek-ai/dsh-tool-code`](../tool-code)。

```ts
import { analyze } from '@deepseek-ai/dsh-code'

const result = analyze(
  'util.ts',
  'function classify(code: number): string {\n  return code < 0 ? "neg" : code < 100 ? "small" : "large"\n}\n',
)
console.log(result.language, result.qualityScore, result.metrics.functions)
```

## 目录

- [概述](#summary)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知局限与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="behavior"></a>
## 行为

- **输入** — `analyze(fileName, source, options?)` 依次运行语言检测（已知的 `fileName` 扩展名优先于内容启发式）、度量（`lines`、`code`、`comment`、`blank`、`functions`、`classes`）、圈复杂度（整体、平均、最大、逐函数）、静态检查与质量得分。当源码超过 `maxCodeBytes` 时抛出 `CodeError`（`code: 'LIMIT_EXCEEDED'`）。
- **资源限额** — `OperationalLimits`（`maxCodeBytes`、`maxFunctions`、`maxFindings`）是经过校验的 Config 字段；分析器内部没有硬编码上限。
- **质量得分** — 基于发现与复杂度的确定性惩罚累积启发式（error −10、warning −4、info −1，另加复杂度扣分），下限为 0 并取整，使宿主无需依赖特定顺序即可为文件排序。
- **语言检测** — `detectLanguage(fileName, source)` 解析 `.py`/`.js`/`.mjs`/`.java`/`.ts`/`.jsx`/`.tsx` 扩展名与 JSX／箭头函数内容启发式；未知输入走通用分析器并添加 `notes` 条目。
- **静态检查** — `runChecks(language, source, checks?)` 扫描危险的动态执行、原始 SQL 拼接、硬编码密钥、TODO 标记、debugger 残留以及空／裸异常处理器；规则开关（`dangerous`、`secrets`、`todos`、`debugResidue`、`emptyCatch`、`broadCatch`）是 Config 字段。
- **说明** — `analyze` 汇总不明显的情形（语言未检测到、无函数、记录／发现被截断、违反复杂度准则），使模型能判断分析器哪些做得到、哪些做不到。
- **服务** — 作为插件（`name: code`）时，引擎将 `CodeService` 挂载到 `ctx.code`；`code.analyze(...)` 应用服务配置的限额与默认检查开关，除非调用方按次覆盖。

<a id="model-experience"></a>
## 模型体验

### 工具输出与错误

#### 模型所见

每个工具返回紧凑的 JSON 记录：`code_analyze` 返回 `language`、`qualityScore`、`metrics`、`complexity`、`findings` 与 `notes`；`code_check` 返回聚焦发现的 `language`/`findingCount`/`errorCount`/`warningCount`/`infoCount`/`findings` 视图。分析器失败以结构化 `CodeError` 编码（`LIMIT_EXCEEDED`）而非散文暴露。

#### Token 影响

调用前引擎零 token；每条发现与度量原样透传，并保留在历史中直至压缩。

#### KV 缓存影响

引擎不贡献任何 prompt 文本或前缀，因此绝不会影响 KV 缓存复用；只有工具自身的 schema 与结果渲染参与请求前缀稳定性。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与待办工作

- **仅静态分析** — 引擎报告复杂度、度量并定位代码坏味道，但不会执行或类型检查程序；运行与测试被修改的代码由模型通过 shell 与 LSP 工具完成。
- **三种语言加通用** — 检测与复杂度／度量分析器针对 Python、JavaScript／TypeScript 与 Java 调优；其他语言回退到通用分析器，度量为尽力而为。
- **圈复杂度是结构启发式** — 它按函数统计决策点，但不建模数据流或跨过程路径，因此是准则而非可维护性的证明。
- **固定检查规则集** — 检查是精选的静态目录；项目特有 lint 规则需要增加代码或外部 linter，而非 Config 条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>