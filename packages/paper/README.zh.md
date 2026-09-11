---
description: "科研论文写作插件系列：将原始手稿转化为润色后的学术论文，包括结构化章节与参考文献、清晰度优化、GB/T 7714／APA／MLA 格式化与文档导出，附带可追溯的运行记录。"
kind: "package-group"
---

# paper/ — 科研论文写作

[English](README.md) | 中文

一个插件家族，将原始手稿（纯文本或 Markdown）转化为润色后的学术论文：解析为结构化章节与参考文献、优化内容、规范化格式、并整理为 GB/T 7714、APA 或 MLA 格式，并附带可追溯的 run 记录。

| 包 | 角色 | ctx key |
|---|---|---|
| [`paper/`](paper/README.zh.md) | 拥有引擎：论文／章节／参考文献类型、参考文献解析器、引文格式化器（GB/T 7714、APA、MLA）、纯处理器（ingest/revise/format/cite）以及经验证的具名流水线服务 | `ctx.paper` |
| [`tool-paper/`](tool-paper/README.zh.md) | 注册面向模型的 `paper_*` 工具，它们直接调用引擎的纯处理器 | — |

引擎保持框架无关，使面向模型的工具能直接调用其处理器；服务拥有经验证的具名流水线以及端到端 `runPipeline`。子系统参考为 [docs/subsystems/paper.zh.md](../../docs/subsystems/paper.zh.md)。