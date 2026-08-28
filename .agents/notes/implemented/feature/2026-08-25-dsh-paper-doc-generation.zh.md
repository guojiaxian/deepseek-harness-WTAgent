# Agent Note：论文文档生成（.doc / .docx）

Status: implemented

[English](2026-08-25-dsh-paper-doc-generation.md) | 中文

## 问题

科研论文写作 agent 可以解析、修订、规范并引用手稿，但无法将最终 `Paper` 变成真正可分发、可存证的文档。模型只能把结构化论文重新序列化为文本，因此"把这篇论文导出为 Word 文件"总是需要宿主侧的非审计步骤，生成的文档大小也没有任何约束。

## 决策

**新增 `renderDocument`，由可移植的结构化配置与两个零依赖渲染器支撑。** `PaperService` 与引擎在 `document/` 下重新导出 `DocumentConfig`、`validateDocumentConfig`、`renderDocument` 以及 `docx`/`doc` 渲染器。一份解析后的 `DocumentConfig` 同时驱动两种格式，使排版保持一致：运行页眉／页脚文本、页码字段（OOXML 的 `PAGE` 字段；RTF 的 `\chpgn`）、正文字体与字号、行距、段距与统一页边距。`validateDocumentConfig` 对未知键、错误类型与越界数值快速失败，而不是悄悄生成排版损坏的文档。

**`.docx` 为真实 OOXML；`.doc` 为经典 RTF。** `docx` 渲染器将 `[Content_Types].xml`、包与实际关系、`word/document.xml`、`word/styles.xml`、`word/header1.xml` 与 `word/footer1.xml` 写入一个最简 store-only ZIP 归档（`document/zip.ts` 生成本地文件头、中央目录与含表驱动 CRC-32 的中央目录结束记录）。`doc` 渲染器生成带 `\header`／`\footer` 与 `\uN?` 非 ASCII 转义的 RTF。两者都保持零依赖，与引擎对精度敏感的处理器保持一致。

**以单个 `paper_export` 工具呈现该能力。** `tool-paper` 注册第 6 个 `paper_*` 工具，携带 `format` 枚举（`doc` | `docx`）与解析后的配置；它以 base64 字节、其 sha256 校验和、格式与字节数返回文档。新的 `Limits.maxOutputBytes`（默认 16 MiB）约束生成的输出大小；结果超限时抛出 `LIMIT_EXCEEDED`，携带实测字节数、上限与恢复建议（"缩小手稿或调高 maxOutputBytes"）。任何渲染运行前，不支持的格式即抛出 `UNSUPPORTED_FORMAT`。

## 备选方案

**移除大小上限与字节元数据。** 拒绝，因为 base64 工具结果默认不受限；校验和与字节数也让宿主在从记录写出下载文件时能够校验并确定大小。

**在工具内将文档落盘。** 拒绝；工具返回 JSON，会话日志是事实来源，因此文档以 base64 记录逐字节复现出模型产出，完全可审计。

## 结果

论文写作 agent 现在以一个完全由结构化配置描述的 `.docx` 或 `.doc` 文件结束运行，两种格式一致应用页眉／页脚、页码、正文字体、行距与页边距。畸形配置在渲染前失败；超限结果带确切字节数、上限与修复办法。单元测试覆盖新增 `document/` 模块与 `paper_export` 工具的全部代码路径（两种格式、页眉／页脚／页码生成、格式化与原始参考文献投影回退、空论文、配置校验区间、不支持格式分支与字节上限分支）。`dsh-paper` 与 `dsh-tool-paper` 的 README 宣介了导出能力及其限制。