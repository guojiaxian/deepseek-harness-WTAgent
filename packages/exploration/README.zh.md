---
description: "勘探数据处理插件系列：将原始勘探记录（地质、地球物理或测井数据）转换为已清洗、已转换、含统计信息的数据集，检测异常并生成地震剖面图，附带可追溯的运行记录。"
kind: "package-group"
---

# exploration/：勘探数据处理

[English](README.md) | 中文

一个插件系列，将原始勘探记录（以 CSV、JSON 或 SEG-Y 编码的地质、地球物理或测井数据）转换为已清洗、已转换、含统计信息的数据集，检测异常，并生成可追溯的运行记录。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`exploration/`](exploration/README.zh.md) | 引擎：数据类型、格式解析器、纯处理器（ingest/clean/convert/extract/detect）以及经验证的命名 pipeline 服务 | `ctx.exploration` |
| [`tool-exploration/`](tool-exploration/README.zh.md) | 注册面向模型的 `exploration_*` 工具，调用引擎的纯处理器 | — |

引擎保持无框架依赖，使面向模型的工具可直接调用其处理器；服务则负责经验证的命名 pipeline 与端到端 `runPipeline`。子系统参考见 [docs/subsystems/exploration.zh.md](../../docs/subsystems/exploration.zh.md)。
