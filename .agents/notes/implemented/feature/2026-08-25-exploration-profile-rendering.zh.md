# Agent Note：勘探剖面的渲染

状态：已实现

[English](2026-08-25-exploration-profile-rendering.md) | 中文

## 问题

专业的物探数据处理 agent 已经可以对 SEG-Y 数据执行 ingest、clean、convert、extract 与 detect，但没有任何途径把解析并验证过的地震剖面变成可查看的剖面图像。渲染剖面需要在引擎之外做后处理，因此 agent 无法在不借助额外、未审计步骤的情况下回答「给我看这一道测线」；而当剖面不完整时，也没有任何机制暂停流水线。

## 决策

**新增一个 `profile` 步骤处理器与一个 `exploration_profile` 工具。** 处理器把二维地震剖面（SEG-Y 长表格式 `trace`／`sampleIndex`／`value`，或短表格式 `trace` 加 `sample_*` 列）渲染为颜色映射栅格（seismic／grayscale／jet），并把结果作为自包含 SVG 加 base64 PNG 嵌入 `meta.profile`。面向模型的 `exploration_run` 将其作为流水线步骤运行，因此在解析与验证之后单独调用 `exploration_profile` 的采集流程也能覆盖一次性场景。

**触发机制沿用流水线的失败即中断。** 剖面渲染与解析、验证同属一条可审计的流水线，以 `ingest` 之后的 `profile` 步骤声明式声明。没有地震列、没有行或没有有限振幅的数据集会抛出新的 `INCOMPLETE_DATA` 错误码；`runPipeline` 已能把失败步骤的码、消息与步骤 id 记录到运行记录并暂停后续运行，因此不完整的剖面会自动停止并留下记录的原因。

**输出零依赖且基于开放标准。** PNG 输出由一个极简的内建索引色编码器（zlib deflate 加表驱动 CRC-32）生成，SVG 以嵌入 PNG 数据 URI 的方式包裹栅格，因此文件能被任何支持 PNG／SVG 的查看器打开，并可导入接受其中任一格式的专业地质软件。无需任何图像库。

**格式范围保持 PNG ＋ SVG。** SEG-Y／GeoJSON／LAS 导出不在范围内；输出是渲染结果，不是数据交换文件。

## 备选方案

**依赖渲染库。** 否决。原因是引擎处理器在处理精度敏感的任务时保持零依赖；表驱动 PNG 编码器保住了这一性质且表面积很小。

**在工具中把剖面持久化到磁盘。** 否决。原因是工具返回 JSON，会话日志是事实来源；渲染随数据集元数据流动，因此可以从记录回放。

## 影响

物探 agent 可以在同一条流水线中解析并验证 SEG-Y，然后把剖面渲染为 PNG 和/或 SVG，全程无需人工步骤；不完整或非地震数据集会用 `INCOMPLETE_DATA` 记录暂停运行，而不是产出一张误导性图片。单元测试覆盖新渲染模块与处理器的 100%，工具级测试套件同时覆盖独立的 `exploration_profile` 路径与流水线 `profile` 步骤（包括其失败暂停）。`seismic-profile` 示例流水线与勘探 agent 预设的人设会宣传这一渲染能力。
