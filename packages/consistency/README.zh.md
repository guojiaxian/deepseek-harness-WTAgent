# consistency/：密集台阵一致性测试

[English](README.md) | 中文

一个插件系列，用于自动化密集台阵设备一致性测试（`conformance_test/workflow.md`）：它将密集台阵设备清单（存放 mini-SEED 台站目录）与 `datetime.dat` 中的激发时刻（北京时间）转成可执行的工作流，涵盖统一台站命名、mini-SEED → SAC 转换规划、UTC 裁波时间窗与批次波形绘图布局，并附带可追溯的运行记录。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`consistency/`](consistency/README.zh.md) | 引擎：领域类型、步骤处理器（ingest/rename/convert/cut/plot）以及经验证的命名 pipeline 服务 | `ctx.consistency` |
| [`tool-consistency/`](tool-consistency/README.zh.md) | 注册面向模型的 `consistency_*` 工具，调用引擎的纯处理器 | — |

引擎保持无框架依赖，使面向模型的工具可直接调用其处理器；服务则负责经验证的命名 pipeline 与端到端 `runPipeline`。子系统参考见 [docs/subsystems/consistency.zh.md](../../docs/subsystems/consistency.zh.md)。