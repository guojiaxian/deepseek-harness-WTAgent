# Agent Note: 勘探数据处理 Agent

Status: implemented

[English](2026-08-21-exploration-data-processing-agent.md) | 中文

## 问题

Harness 缺少对原始勘探数据进行领域化处理的能力。专业勘探数据 Agent（地质、物探或测井记录）只能在提示词里手写解析器、单位换算、统计与异常检测，既没有共享引擎，也没有经过校验的流水线配置，更无从追溯。首期格式发布必须覆盖 CSV、JSON 与 SEG-Y，且每一步处理都必须保持模型可调用、同时全程可审计。

## 决策

**两个包构成一个能力缝，外加一个可运行示例。** 引擎包 `@deepseek-ai/dsh-exploration` 拥有纯函数、无状态的处理器（ingest、clean、convert、extract、detect）、格式读取器（CSV、JSON、SEG-Y，含 CP037 EBCDIC 文本头解码与 IBM 浮点数）、经过校验的流水线注册表与 `exploration` 服务。模型侧包 `@deepseek-ai/dsh-tool-exploration` 注册六个 `exploration_*` 工具，直接调用引擎的纯处理器。`examples/exploration-agent` 将引擎、工具、DeepSeek 适配器与 Agent 骨架组合成可运行的测井 QC Agent，其 `well-log-qc` 流水线在 `cordis.yml` 中声明。

**Web 端以 agent preset 内建。** `apps/cli/config/agent-presets/exploration/` 在勘探 persona 之下挂载 `@deepseek-ai/dsh-tool-exploration`（外加 shell、文件系统、ask-user、todo 与仅 fetch 的 web 工具）。由于这些工具以内联 pipeline 直接调用引擎的纯处理器，preset 中无需引擎服务行。两个勘探包分别是宿主 `@deepseek-ai/dsh-base` bundle 与 `apps/cli` 应用的 workspace 依赖，使 Loader 能解析裸插件名；只改其一而不改另一会破坏 preset 挂载解析。

**输入与输出均为表格化。** 原始 CSV/JSON 文本或 base64 编码的 SEG-Y 字节被解析为带类型的 `Dataset`；每个处理器都返回全新数据集并附带审计注释，`exploration_run` 返回包含逐步来源信息的完整 `RunRecord`。因此模型可见的输出总能从运行记录中重建。

**配置校验失败即报错。** 每种步骤都有 Schemastery 配置 schema，在流水线注册与工具调用时双重校验；未知选项、未知单位、非数值换算目标都会抛出带类型的 `ExplorationError` 码（`VALIDATION_ERROR`、`INGEST_ERROR`、`LIMIT_EXCEEDED`、`PARSE_ERROR` 等），而不是静默降级。

**可追溯性内建。** 每个步骤追加一行来源信息，每次 `runPipeline` 调用都返回带运行 id、步骤列表、分步注释与输出摘要的 `RunRecord`；会话持久化捕获该轮对话，整个处理过程可从会话日志重放。

## 备选方案

**单一巨型包。** 否决：本仓库的约定是按角色拆分能力缝；引擎/工具拆分让纯逻辑无需 Cordis 上下文即可单测，而工具负责注册与限额。

**一个把所有步骤流式跑完的超级工具。** 否决：分步工具让模型按需挑选阶段并保持参数精简；`exploration_run` 覆盖整条流水线的场景。

**以文本形式传输 SEG-Y。** 否决：SEG-Y 是二进制；base64 传输让线上内容模型可见且无歧义。

## 影响

拥有 `exploration_*` 工具的模型可以接收 CSV、JSON 或 SEG-Y 输入，完成 ingest、clean、convert、extract、detect 与异常检测，并报告可追溯的运行记录。流水线为声明式 `cordis.yml` 配置（示例注册了 `well-log-qc`）；未知步骤、重名与错误配置会在启动或工具调用时响亮失败。引擎纯函数且无状态，因此无需运行时不变量（见 `exploration-invariant`）。单元测试覆盖引擎与工具源码 100%，无密钥的 Loader 冒烟测试重放了一次真实的 `exploration_run` 往返，真实密钥运行示例 Agent 得到了正确的伽马射线 QC 结论（15 m 处 IQR 标记，z-score 处于临界）。后续格式读取器（LAS 等）接入 `format/` 目录，复用同一个 `ingestData` 分发。
