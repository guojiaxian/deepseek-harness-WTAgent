---
description: "科研论文写作引擎：面向纯文本或 Markdown 手稿的 parse、revise、format、cite 处理器与文档导出，通过可配置、可追溯的流水线运行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-paper

[English](README.md) | 中文

## 概述

**科研论文写作引擎**：以 Cordis 服务加纯函数（框架无关）两种形态进行专业的手稿处理。它将纯文本或 Markdown 手稿解析为结构化论文，优化内容清晰度、规范化格式，并通过可配置、可追溯的流水线将参考文献整理为 GB/T 7714、APA 或 MLA 格式。面向模型的 `paper_*` 工具位于 [`@deepseek-ai/dsh-tool-paper`](../tool-paper)。

```ts ignore-check
import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-paper'

const result = runPipeline(
  { format: 'markdown', data: '# A Study\n\nAbstract…\n\n## Method\n\nWe studied…\n' },
  validatePipeline({
    name: 'polish',
    steps: [
      { id: 'ingest', type: 'ingest' },
      { id: 'revise', type: 'revise' },
      { id: 'cite', type: 'cite', config: { style: 'gb7714' } },
    ],
  }),
  { maxInputBytes: 8 * 1024 * 1024, maxSections: 200, maxParagraphs: 200, maxCitations: 500, maxFindings: 200 },
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

- **流水线形态** — 流水线是具名、有序的步骤列表，首步必须为 `ingest`；空流水线、重复步骤 id 与非法步骤配置会在 `validatePipeline` 时快速失败。作为插件（`name: paper`），`Config.pipelines` 在挂载时通过 `PaperService` 注册各流水线。
- **步骤处理器** — 每个处理器暴露 `validate(config)` 与 `run(paper, input?, limits?)`：
  - `ingest` 将纯文本或 Markdown 手稿解析为 `Paper`：识别标题、将摘要节提取到专有字段、标注标题层级、段落并解析参考文献。
  - `revise` 分析内容并输出建议：清晰度改写、被动语态检测与陈词滥调标记。
  - `format` 规范化论文：为 `level` 标题编号、规范间距与标点、转换排版引号并补齐残留的引用标记。
  - `cite` 通过 GB/T 7714、APA 或 MLA 格式化器渲染每条参考文献，并可按字母排序。
- **可追溯性** — `runPipeline` 在 `RunRecord` 上记录逐步骤 `StepRecord`（开始／结束时间戳、耗时、输入哈希、输出摘要、说明）与输入校验和。步骤失败会被记录在 run 记录上而不中断调用方，输出回退到最后一次成功的论文。
- **校验和** — 输入与每次输出都用稳定的 FNV-1a 校验和做指纹，保证记录跨运行可复现。
- **文档导出** — `renderDocument` 将 `Paper` 与解析后的 `DocumentConfig` 生成为 `.docx`（ZIP 归档中的真实 OOXML）或 `.doc`（经典 RTF）文件，包含运行页眉／页脚、页码字段、正文字体与字号、行距、段距与统一页边距——全部零依赖，由两个渲染器共享的同一份配置驱动。`validateDocumentConfig` 对未知键或越界值快速失败；结果超出大小时抛出 `LIMIT_EXCEEDED`，携带实测字节数、上限与解决建议。
- **资源限制** — `Limits`（`maxInputBytes`、`maxSections`、`maxParagraphs`、`maxCitations`、`maxFindings`、`maxOutputBytes`）是经过校验的 Config 字段，在每一步之后强制执行；处理器内部无硬编码。

<a id="model-experience"></a>
## 模型体验

### 工具输出与错误

#### 模型所见

每个结构化 `paper_*` 工具返回紧凑的 JSON 结果（行内代码 `paper`、`sectionCount`、`citationCount`、`notes`），`paper_run` 则返回带 `steps` 与 `outputSummary` 的完整可追溯 `RunRecord`。处理器错误以结构化 `PaperError` 代码（`VALIDATION_ERROR`、`LIMIT_EXCEEDED`、`UNSUPPORTED_FORMAT` 等）而非散文呈现。

#### Token 影响

调用前引擎不产生任何 token；每个结果论文原样传递并在压缩前保留在历史中。

#### KV 缓存影响

引擎不贡献任何提示文本或前缀，因此不会影响 KV 缓存复用；只有工具自身的 schema 与结果渲染参与请求前缀稳定性。

## 已知局限与待办事项

- **仅内存处理** — 手稿整体保存在内存中（由 `Limits` 约束）；面向超大规模论文的流式或落盘溢出方案待实现。
- **引文解析基于启发式** — 参考文献从带括号标签的条目（`[1] …`、`[Smith, 2020] …`）与标注源标记解析；自由格式或模板损坏的文献列表可能误判，需模型自行修正字段。
- **格式与样式规则固定** — 清晰度检查、排版规则及 GB/T 7714／APA／MLA 渲染器编码了固定样式表；期刊或会议专属定制需要修改代码而非配置项。
- **以英语为先的启发式** — 被动语态、陈词滥调与句级改写启发式假设学术英语；其他语言的质检不在范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>