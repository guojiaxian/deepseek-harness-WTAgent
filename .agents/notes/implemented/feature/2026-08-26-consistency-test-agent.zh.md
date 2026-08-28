# Agent Note: 一致性测试 Agent

Status: implemented

[English](2026-08-26-consistency-test-agent.md) | 中文

## 问题

Harness 缺少针对密集台阵设备一致性测试（`conformance_test/workflow.md`）的专业能力。运维者只能把四个阶段——按统一约定重命名台站目录、用 `mseed2sac`／`e-mseed2sac` 转换器把 mini-SEED 转为 SAC、把到达时刻解析为裁波时间窗与波形图、绘制后剔除实测数据偏移过大的台站——在提示词里手工拼装：既没有共享引擎，也没有经过校验的流水线配置，更无从追溯，命名／时间窗／批次规则也无法复用。

## 决策

**两个包构成一个能力缝，并以 agent preset 呈现。** 引擎包 `@deepseek-ai/dsh-consistency` 拥有纯函数、无状态的处理器（`ingest`、`rename`、`convert`、`cut`、`plot`、`exclude`）、领域类型、经过校验的流水线注册表与 `ConsistencyService`。模型侧包 `@deepseek-ai/dsh-tool-consistency` 注册七个 `consistency_*` 工具，直接调用引擎的纯处理器。preset 在 `apps/cli/config/agent-presets/consistency` 的一致性 persona 之下挂载工具包（`preset.yml` 命名为 一致性测试 Agent）。引擎只计算易错的领域决策并记录可追溯的 `RunRecord`；实际文件 I/O（目录重命名、运行转换器、obspy 裁波、偏移测量、matplotlib 渲染）交由 preset 的 `tool-bash`／`tool-fs` 工具在引擎输出的指引下执行。两个一致性包分别是宿主 `@deepseek-ai/dsh-base` bundle 与 `apps/cli` 应用的 workspace 依赖，使 Loader 能解析裸插件名；只改其一而不改另一会破坏 preset 挂载解析。

**工作流以 `Workflow` 状态在流水线中流动。** `ingest` 从单一互换 JSON（`project`、带 seed 文件名的 `stations` 与原始 `arrivalLines`）构建工作流。`rename` 为每个台站派生 `targetName`——前导 `C` 被去除，否则取前 4 个字符——并对重复做冲突守卫，冲突时响亮失败。`convert` 按 seed 的 `C`／`E` 前缀分类为 `SeedKind`，校验所选转换器命令并构建转换规划；缺失转换器时抛 `INCOMPLETE_DATA`，暂停运行。`cut` 将北京时间到达按时区偏移（−8 h）偏移到 UTC，计算 `[cutBefore, cutAfter]` 时间窗与 `WT.<sta>_<label>_<b>s_<a>s.<chan>.SAC` 文件命名。`plot` 按到达事件把台站划分为批次（默认 40），分配堆叠偏移与 `WT.<sta[:4]>` Y 轴标签，批次高度随实际台站数自适应；渲染出的图件再按激发时间顺序拼为一张自适应网格总图（列数按图片总数与单图宽高比决定，使横纵比例均衡）。`exclude` 在绘制完成后，按配置阈值分析各台站实测偏移（DC 基线偏移／静位移），报告需要剔除的台站并记录 `Exclusion`。它不改动绘图批次与数据——从台阵中移除异常设备是人工操作。

**配置校验失败即报错。** 每种步骤都有 Schemastery 配置 schema，在流水线注册与工具调用时双重校验；未知选项与非法步骤顺序都会抛出带类型的 `ConsistencyError` 码（`VALIDATION_ERROR`、`UNKNOWN_PIPELINE`、`INCOMPLETE_DATA` 等），而不是静默降级。

**可追溯性内建。** 每个步骤都向工作流的来源信息追加一行，每次 `runPipeline` 调用都返回带运行 id、步骤列表、分步注释与输出摘要的 `RunRecord`；会话持久化捕获该轮对话，整个工作流可从会话日志重放。

## 备选方案

**单一巨型包。** 否决：本仓库的约定是按角色拆分能力缝；引擎/工具拆分让纯逻辑无需 Cordis 上下文即可单测，而工具负责注册与限额。

**一个把所有步骤流式跑完的超级工具。** 否决：分步工具让模型按需挑选阶段并保持参数精简；`consistency_run` 覆盖整条流水线的场景。

**在引擎内执行文件 I/O。** 否决：引擎保持零依赖、框架无关；preset 的 shell 与文件系统工具本已掌管真实 I/O，因此引擎只返回决策与记录，不做副作用。

## 影响

拥有 `consistency_*` 工具的模型可以接收互换 JSON，统一台站命名、规划 mini-SEED → SAC 转换、把到达时刻解析为 UTC 裁波时间窗、划分绘图批次、分析台站偏移并报告需要剔除的台站（不改动绘图批次），在报告可追溯运行记录的同时，让 preset 的 shell／文件系统工具执行由此产生的文件操作。流水线为声明式且内联；未知步骤、重名与错误配置会在启动或工具调用时响亮失败。引擎纯函数且无状态，因此只携带空的 invariant 伴生（`consistency-invariant`）。宿主类型检查（`tsc -b tsconfig.host.json`）通过，引擎单元测试全部通过（13/13），覆盖命名、冲突守卫、UTC 解析、批次布局、按偏移的剔除报告与整条 `runPipeline` 往返。