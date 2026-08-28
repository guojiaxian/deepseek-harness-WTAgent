---
description: "密集台阵一致性测试 Agent 的引擎：ingest、rename、convert、cut、plot 与 exclude 的纯 TypeScript 处理器，以及经验证的具名流水线服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-consistency

[English](README.md) | 中文

## 概述

**密集台阵一致性测试引擎**：一个零依赖的纯 TypeScript 包，将密集台阵设备清单及其 `datetime.dat`
激发时刻转成覆盖 `conformance_test/workflow.md` 四个阶段的可执行工作流：

1. **rename** — 统一台站目录名（`C0756_260818` → `0756_260818`，否则取前 4 个字符），并做冲突守卫。
2. **convert** — 按 seed 的 `C`／`E` 前缀分类，规划 `mseed2sac`／`e-mseed2sac` 到 `站台编号/*.SAC` 的转换。
3. **cut + plot** — 解析北京时间到达时刻，偏移到 UTC（−8 h），计算 `[cutBefore, cutAfter]` 时间窗与
   `WT.<sta>_<label>_<b>s_<a>s.<chan>.SAC` 命名约定，再把台站划分为绘图批次（`wave_z_batchN.png`），
   图片高度随批次实际台站数自适应；全部图生成后按激发时间顺序拼为一张自适应网格总图
   （`combined_wave_all_z.png`，列数按图片总数与单图宽高比决定，使横纵比例均衡）。
4. **exclude** — 绘制完成后，分析各台站数据偏移（用 obspy 测得的 DC 基线偏移／静位移），报告达到配置阈值的台站；异常设备由人工移除。此步骤只做分析，不改动任何绘图或数据。

引擎只计算易错的**领域决策**与可追溯的 [`RunRecord`](src/types.ts)。实际文件 I/O（重命名目录、运行转换器、obspy 裁波、偏移测量、matplotlib 渲染）由 agent preset 的 `tool-bash`／`tool-fs`／`tool-web` 在引擎输出的指引下执行——与勘探 Agent 的架构保持一致。

## 目录

- [概述](#summary)
- [步骤](#steps)
- [用法](#usage)
- [开发备注](#dev-note)

-----

<a id="steps"></a>
## 步骤

| 步骤 | 处理器 | 输出 |
|---|---|---|
| `ingest` | [`src/processors/ingest.ts`](src/processors/ingest.ts) | 从 JSON 互换载荷构建 [`Workflow`](src/types.ts) |
| `rename` | [`src/processors/rename.ts`](src/processors/rename.ts) | 计算经过冲突守卫的统一台站名 |
| `convert` | [`src/processors/convert.ts`](src/processors/convert.ts) | 校验转换器并构建转换规划 |
| `cut` | [`src/processors/cut.ts`](src/processors/cut.ts) | 将到达时刻解析为 UTC + 时间窗与文件命名 |
| `plot` | [`src/processors/plot.ts`](src/processors/plot.ts) | 台站→批次分组、Y 标签与堆叠偏移 |
| `exclude` | [`src/processors/exclude.ts`](src/processors/exclude.ts) | 报告需要剔除的台站并记录 `Exclusion`（不修改绘图批次） |

<a id="usage"></a>
## 用法

```ts
import { validatePipeline, runPipeline } from '@deepseek-ai/dsh-consistency'

const pipeline = validatePipeline({
  name: 'consistency',
  steps: [
    { id: 'ingest', type: 'ingest', config: { baseDir: '/data', converterC: 'mseed2sac', converterE: 'e-mseed2sac' } },
    { id: 'rename', type: 'rename', config: {} },
    { id: 'convert', type: 'convert', config: {} },
    { id: 'cut', type: 'cut', config: {} },
    { id: 'plot', type: 'plot', config: {} },
  ],
})
const run = runPipeline({ format: 'json', data: JSON.stringify({ project: '0756_260818', stations: [{ name: 'C0756_260818' }], arrivalLines: ['2026-08-25 12:00:00'] }) }, pipeline, { maxInputBytes: 8e6, maxStations: 1e4, maxSeedFiles: 1e5, maxArrivals: 1e4 }, 'run-1')
console.log(run.output) // { project, stations (renamed), arrivals (UTC), plotBatches }
```

面向模型的工具位于 [`../tool-consistency`](../tool-consistency)，agent preset 位于
`apps/cli/config/agent-presets/consistency`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>