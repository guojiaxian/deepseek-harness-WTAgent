---
description: "程序开发辅助插件系列：以 Python、JavaScript 与 Java 源码静态分析为程序开发 agent 的改动提供依据，覆盖语言检测、度量、复杂度、质量得分与质量／安全发现。"
kind: "package-group"
---

# code/：程序开发辅助

[English](README.md) | 中文

一个插件系列，用程序开发 agent 所编写、补全、重构与优化的源代码的静态分析为其改动提供依据，覆盖 Python、JavaScript 与 Java：语言检测、行度量、函数与类、圈复杂度、质量得分以及静态质量／安全发现。分析是纯函数且完全在进程内执行；运行、测试与类型检查被修改的程序则委托给模型已有的 shell 工具。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`code/`](code/README.zh.md) | 引擎：语言检测、度量、复杂度、静态检查以及经过验证的分析服务 | `ctx.code` |
| [`tool-code/`](tool-code/README.zh.md) | 注册面向模型的 `code_analyze` / `code_check` 工具，调用引擎的纯分析器 | — |

引擎保持无框架依赖，使面向模型的工具可直接调用其分析器；服务（`ctx.code`）负责经过验证的限额与默认检查开关以及端到端的 `analyze`。子系统参考见 [docs/subsystems/code.zh.md](../../docs/subsystems/code.zh.md)。可运行示例见 [examples/code-agent](../../examples/code-agent)。