# Agent Note：科研论文写作 agent

Status: implemented

[English](2026-08-23-academic-paper-writing-agent.md) | 中文

## 问题

框架缺少对学术论文处理的专业化能力。论文写作 agent 必须在前端提示文本中手写内容修改、格式规范与参考文献格式化，没有共享引擎、没有经过验证的流水线配置、也没有引文风格支持。首个版本须覆盖内容修改、论文格式规范化以及将参考文献整理为主流引文风格（GB/T 7714、APA、MLA），每一步都应保持可被模型调用且可审计。

## 决策

**两个包形成一条能力 seam，外加一个可运行示例。** 引擎包 `@deepseek-ai/dsh-paper` 拥有纯函数、无状态处理器（ingest、revise、format、cite）、带 GB/T 7714、APA、MLA 格式化器的参考文献解析器、经过验证的流水线注册表与 `paper` 服务。面向模型的包 `@deepseek-ai/dsh-tool-paper` 注册五个 `paper_*` 工具（ingest/revise/format/cite/run），它们直接调用引擎的纯处理器。`examples/paper-agent` 将引擎、工具、DeepSeek 适配器与 agent spine 组合成一个可运行的润色 agent，其 `academic-polish` 流水线在 `cordis.yml` 中声明。

**Web 端以 agent preset 内建。** `apps/cli/config/agent-presets/paper/` 在论文写作 persona 之下挂载 `@deepseek-ai/dsh-tool-paper`（以及 shell、filesystem、ask-user、todo 与仅抓取的 web 工具）。由于工具以内联流水线直接调用引擎的纯处理器，preset 中无需引擎服务行。两个 paper 包均为宿主 `@deepseek-ai/dsh-base` bundle 与 `apps/cli` app 的工作区依赖，使 Loader 能解析裸插件名；只改其一而不同时改另一会破坏 preset 的挂载解析。

**手稿即结构化论文。** 原始纯文本或 Markdown 变为带类型的 `Paper`，由有序章节与解析后的参考文献组成；每个处理器返回一份新的论文及审计说明，`paper_run` 返回带步骤级溯源的完整 `RunRecord`。因此面向模型的输出始终可由 run 记录重建。

**配置校验显式失败。** 每种步骤类型都有 Schemastery 配置 schema，在流水线注册与工具调用时校验；未知选项、未知引文风格与超限输入抛出带类型的 `PaperError` 代码（`VALIDATION_ERROR`、`INVALID_STYLE`、`LIMIT_EXCEEDED` 等），而不是静默降级。

**内建可追溯性。** 每一步追加一条溯源记录，每次 `runPipeline` 调用返回带 run id、步骤列表、逐步骤说明与输出摘要的 `RunRecord`；会话持久化捕获该轮，因此整个编辑转录可从会话日志重放。

## 备选方案

**单一巨型包。** 否决，因为框架惯例是按角色拆分能力 seam；引擎／工具拆分让纯逻辑可在无 Cordis 上下文的条件下进行单元测试，而工具负责注册与限制。

**一个流式完成所有步骤的巨型工具。** 否决，因为分步工具让模型能挑选所需阶段并保持参数精简；完整流水线场景由 `paper_run` 覆盖。

**仅提供预先渲染的参考文献。** 否决，因为模型需要独立控制内容、格式与引文阶段；引文风格与排序为逐次调用配置，因此同一份手稿可面向不同风格。

## 结果

拥有 `paper_*` 工具的模型可以接收手稿、优化其内容、规范化其格式、将参考文献整理为 GB/T 7714、APA 或 MLA 并报告可追溯的 run 记录。流水线为声明式 `cordis.yml` 配置（示例注册 `academic-polish`）；未知步骤、重复名称与错误配置会在启动或工具调用时显式失败。引擎为纯函数且无状态，因此无需运行时不变量。单元测试覆盖引擎与工具源码的 100%，且无密钥 loader 冒烟测试重放了一次真实的 `paper_run` 往返。未来新增引文风格时，可接入 `citation/` 目录，共享同一 `formatCitation` 分派。