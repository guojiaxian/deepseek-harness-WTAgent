# deepseek-harness-WTAgent

[English](README.en.md) | 中文

**deepseek-harness-WTAgent**（以下简称 **WTAgent** 或 `dsh`）是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 二次开发并持续演进的 agent harness（智能体框架），保留了上游**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

本项目在完整继承上游能力（会话、系统提示、工具、agent 循环、LLM 能力、shell/subprocess/文件系统/LSP/Web 等全套能力缝、以及 SDK / Web UI / ACP / JSON-RPC 等对外接口）的基础上，额外新增了面向专业领域的模块、插件与 agent 预设，具体见下方[相对上游新增的模块/插件](#相对上游新增的模块插件)。当前升级基线为上游 [`dsh-v0.1.2-alpha.1`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.1)，升级记录见[升级历史与上游差异](#升级历史与上游差异)。

## 开发者预览

本项目目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。** 运行本项目前请先阅读[安全须知](SAFETY.md)。

## 相对上游新增的模块/插件

本章节列出本项目相对于源头项目 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（master 分支）新增的全部模块、插件及其功能说明。

| 模块 / 插件 | 类别 | 用途 | 面向模型工具 |
| --- | --- | --- | --- |
| [`@deepseek-ai/dsh-code`](#1-code-模块deepseek-aidsh-code) | 引擎（服务 + 纯函数） | Python / JavaScript / Java 静态代码分析 | — |
| [`@deepseek-ai/dsh-tool-code`](#2-tool-code-插件deepseek-aidsh-tool-code) | 面向模型工具插件 | 暴露 `code_analyze` / `code_check` 工具 | `code_analyze`、`code_check` |
| [`@deepseek-ai/dsh-exploration`](#3-exploration-模块deepseek-aidsh-exploration) | 引擎（服务 + 纯函数） | 勘探数据（CSV/JSON/SEG-Y）处理 | — |
| [`@deepseek-ai/dsh-tool-exploration`](#4-tool-exploration-插件deepseek-aidsh-tool-exploration) | 面向模型工具插件 | 暴露 7 个 `exploration_*` 工具 | `exploration_ingest`、`exploration_clean`、`exploration_convert`、`exploration_extract`、`exploration_detect`、`exploration_run`、`exploration_profile` |
| [`@deepseek-ai/dsh-consistency`](#5-consistency-模块deepseek-aidsh-consistency) | 引擎（服务 + 纯函数） | 密集台阵一致性测试（台站命名／SAC 转换规划／裁波／绘图／偏移分析报告） | — |
| [`@deepseek-ai/dsh-tool-consistency`](#6-tool-consistency-插件deepseek-aidsh-tool-consistency) | 面向模型工具插件 | 暴露 7 个 `consistency_*` 工具 | `consistency_ingest`、`consistency_rename`、`consistency_convert`、`consistency_cut`、`consistency_plot`、`consistency_exclude`、`consistency_run` |
| [`@deepseek-ai/dsh-paper`](#7-paper-模块deepseek-aidsh-paper) | 引擎（服务 + 纯函数） | 科研论文手稿解析、润色、引文格式化与文档导出 | — |
| [`@deepseek-ai/dsh-tool-paper`](#8-tool-paper-插件deepseek-aidsh-tool-paper) | 面向模型工具插件 | 暴露 6 个 `paper_*` 工具 | `paper_ingest`、`paper_revise`、`paper_format`、`paper_cite`、`paper_run`、`paper_export` |
| `dev` / `exploration` / `consistency` / `paper` agent 预设 | Agent 预设 | Web UI 内建的专业 Agent（程序开发 / 勘探数据处理 / 一致性测试 / 科研论文写作） | 对应工具集 |
| `code-agent` / `exploration-agent` / `paper-agent` 示例 | 示例 bundle | 可运行的组合示例 + 无密钥冒烟测试 | 对应工具集 |

### 1. code 模块（`@deepseek-ai/dsh-code`）

- **名称**：`@deepseek-ai/dsh-code`（插件名 `code`，包位于 `packages/code/code/`）
- **用途**：对 Python、JavaScript / TypeScript 与 Java 源码进行静态分析——语言检测、行度量、函数与类统计、圈复杂度、静态质量 / 安全检查，并推导确定性的 0–100 质量得分。
- **实现方式**：以 Cordis 服务（`ctx.code`）加纯函数（框架无关）两种形态提供。核心入口 `analyze(fileName, source, options?)` 依次运行语言检测、度量、圈复杂度、静态检查与质量得分；`CodeService.analyze(...)` 作为插件挂载时应用经过校验的 Config 限额（`maxCodeBytes`、`maxFunctions`、`maxFindings`）与默认检查开关。静态分析完全在进程内完成，运行 / 测试被修改的程序委托给模型已有的 shell 工具。`src/report.ts` 提供基于发现与复杂度的确定性质量得分启发式。
- **使用示例**：

  ```ts
  import { analyze } from '@deepseek-ai/dsh-code'

  const result = analyze(
    'util.ts',
    'function classify(code: number): string {\n  return code < 0 ? "neg" : code < 100 ? "small" : "large"\n}\n',
  )
  console.log(result.language, result.qualityScore, result.metrics.functions)
  ```

### 2. tool-code 插件（`@deepseek-ai/dsh-tool-code`）

- **名称**：`@deepseek-ai/dsh-tool-code`（插件名 `tool-code`，包位于 `packages/code/tool-code/`）
- **用途**：将 code 引擎暴露给模型，注册两个工具：`code_analyze`（返回语言、质量得分、度量、复杂度、发现与说明的完整分析记录）与 `code_check`（返回聚焦发现的质量 / 安全扫描视图）。
- **实现方式**：插件在 `ctx.tools` 上注册工具，通过引擎自身的配置 schema 校验参数与资源限额，返回紧凑 JSON。
- **使用示例**（在 agent preset 中启用后由模型调用）：

  ```json
  { "name": "code_analyze", "arguments": { "fileName": "sample.py", "source": "print('hello')" } }
  ```

### 3. exploration 模块（`@deepseek-ai/dsh-exploration`）

- **名称**：`@deepseek-ai/dsh-exploration`（插件名 `exploration`，包位于 `packages/exploration/exploration/`）
- **用途**：对原始勘探记录（地质、地球物理、测井数据）进行专业处理——解析 CSV、JSON 与 SEG-Y，通过可配置、可追溯的流水线完成数据清洗与转换、统计提取和异常检测，并支持渲染地震剖面图（PNG / SVG）。
- **实现方式**：以 Cordis 服务（`ExplorationService`）加纯函数两种形态提供。`runPipeline(input, pipeline, limits)` 按具名、有序的步骤列表执行，处理器包括 `ingest`、`clean`、`convert`（单位换算、深度↔双程时间）、`extract`（描述性统计、滚动窗口、RMS 振幅）、`detect`（z-score、IQR、硬阈值、尖峰、死道、缺失值）与 `profile`（渲染剖面）。每次运行记录逐步骤 `RunRecord`（时间戳、耗时、输入哈希、输出摘要）与 FNV-1a 校验和，保证跨运行可复现；资源 `Limits` 是经过校验的 Config 字段。
- **使用示例**：

  ```ts
  import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-exploration'

  const result = runPipeline(
    { format: 'csv', data: 'depth_m,gamma_api\n0,45\n15,220\n' },
    validatePipeline({
      name: 'quick-qc',
      steps: [
        { id: 'ingest', type: 'ingest' },
        { id: 'detect', type: 'detect', config: { zscore: [{ column: 'gamma_api' }] } },
      ],
    }),
    { maxInputBytes: 8 * 1024 * 1024, maxRows: 50_000, maxColumns: 1024, maxAnomalyRecords: 500 },
    crypto.randomUUID(),
  )
  ```

### 4. tool-exploration 插件（`@deepseek-ai/dsh-tool-exploration`）

- **名称**：`@deepseek-ai/dsh-tool-exploration`（插件名 `tool-exploration`，包位于 `packages/exploration/tool-exploration/`）
- **用途**：将 exploration 引擎暴露给模型，注册 7 个 `exploration_*` 工具：`exploration_ingest`（CSV / JSON 文本或 base64 SEG-Y 解析）、`exploration_clean`、`exploration_convert`、`exploration_extract`、`exploration_detect`、`exploration_run`（校验并运行具名流水线，返回完整 `RunRecord`）与 `exploration_profile`（将勘探数据集渲染为地震剖面 PNG / SVG）。
- **实现方式**：插件在 `ctx.tools` 上注册工具，参数通过引擎 schema 校验，SEG-Y 数据以 base64 传输。
- **使用示例**（由模型调用，链式转换工具可传入 / 返回数据集 JSON）：

  ```json
  { "name": "exploration_run", "arguments": { "format": "csv", "data": "depth_m,gamma_api\n0,45\n15,220", "pipeline": { "name": "qc", "steps": [ { "id": "ingest", "type": "ingest" } ] } } }
  ```

### 5. consistency 模块（`@deepseek-ai/dsh-consistency`）

- **名称**：`@deepseek-ai/dsh-consistency`（插件名 `consistency`，包位于 `packages/consistency/consistency/`）
- **用途**：密集台阵设备一致性测试引擎——将设备清单与 `datetime.dat` 激发时刻转成覆盖 `conformance_test/workflow.md` 四个阶段的可执行工作流：统一台站目录命名（去前导 `C` 或取前 4 字符，含冲突守卫）、按 `C`／`E` 类别规划 mini-SEED → SAC 转换、解析北京时间到达为 UTC 裁波时间窗、并把台站划分为高度随实际台站数自适应的波形绘图批次、再按激发时间顺序拼为自适应网格总图（列数按图片总数与单图宽高比决定，横纵均衡）；绘制完成后，分析各台站数据偏移并报告达到配置阈值的台站（异常设备由人工移除，此步骤只做分析）。
- **实现方式**：以 Cordis 服务（`ConsistencyService`）加纯函数两种形态提供。`runPipeline(input, pipeline, limits)` 按具名、有序的步骤列表执行，处理器包括 `ingest`（从互换 JSON 构建工作流）、`rename`、`convert`（校验转换器并生成转换规划）、`cut`（北京时间 → UTC 与时间窗／文件名）、`plot`（批次分组、Y 标签与堆叠偏移）与 `exclude`（按阈值报告需要剔除的台站并记录 `Exclusion`，不修改绘图批次）。每次运行记录逐步骤 `RunRecord`（时间戳、耗时、输入哈希、输出摘要）与校验和；缺失转换器会抛 `INCOMPLETE_DATA`。资源 `Limits` 是经过校验的配置字段。
- **使用示例**：

  ```ts
  import { validatePipeline, runPipeline } from '@deepseek-ai/dsh-consistency'

  const result = runPipeline(
    { format: 'json', data: JSON.stringify({ project: '0756_260818', stations: [{ name: 'C0756_260818' }], arrivalLines: ['2026-08-25 12:00:00'] }) },
    validatePipeline({
      name: 'consistency',
      steps: [
        { id: 'ingest', type: 'ingest', config: { converterC: 'mseed2sac', converterE: 'e-mseed2sac' } },
        { id: 'rename', type: 'rename' },
        { id: 'convert', type: 'convert' },
        { id: 'cut', type: 'cut' },
        { id: 'plot', type: 'plot' },
      ],
    }),
    { maxInputBytes: 8 * 1024 * 1024, maxStations: 10_000, maxSeedFiles: 100_000, maxArrivals: 10_000 },
    crypto.randomUUID(),
  )
  ```

### 6. tool-consistency 插件（`@deepseek-ai/dsh-tool-consistency`）

- **名称**：`@deepseek-ai/dsh-tool-consistency`（插件名 `tool-consistency`，包位于 `packages/consistency/tool-consistency/`）
- **用途**：将 consistency 引擎暴露给模型，注册 7 个 `consistency_*` 工具：`consistency_ingest`（从互换 JSON 构建工作流）、`consistency_rename`、`consistency_convert`、`consistency_cut`、`consistency_plot`、`consistency_exclude`（绘制后分析偏移并报告需要剔除的台站，不改动数据）与 `consistency_run`（校验并运行具名流水线，返回完整 `RunRecord`）。
- **实现方式**：插件在 `ctx.tools` 上注册工具，参数通过引擎 schema 校验；实际的文件 I/O（重命名目录、运行转换器、obspy 裁波、偏移测量、matplotlib 绘图）由 preset 的 `tool-bash`／`tool-fs` 在引擎输出的指引下执行。
- **使用示例**（由模型调用，链式转换工具可传入 / 返回工作流 JSON）：

  ```json
  { "name": "consistency_run", "arguments": { "data": "{\"project\":\"0756_260818\",\"stations\":[{\"name\":\"C0756_260818\"}],\"arrivalLines\":[\"2026-08-25 12:00:00\"]}", "pipeline": { "name": "consistency", "steps": [ { "id": "ingest", "type": "ingest" }, { "id": "rename", "type": "rename" } ] } } }
  ```

### 7. paper 模块（`@deepseek-ai/dsh-paper`）

- **名称**：`@deepseek-ai/dsh-paper`（插件名 `paper`，包位于 `packages/paper/paper/`）
- **用途**：专业科研论文写作引擎——将纯文本或 Markdown 手稿解析为结构化论文，优化内容清晰度、规范化格式，并将参考文献整理为 GB/T 7714、APA 或 MLA 格式；`renderDocument` 可将论文导出为 `.docx`（真实 OOXML）或 `.doc`（经典 RTF）文件。
- **实现方式**：以 Cordis 服务（`PaperService`）加纯函数两种形态提供。处理器包括 `ingest`（解析标题、摘要、段落与参考文献）、`revise`（清晰度改写、被动语态检测、陈词滥调标记）、`format`（标题编号、间距与标点规范化、排版引号）、`cite`（按目标样式渲染参考文献）与 `export`（文档导出）。`runPipeline` 记录逐步骤 `RunRecord` 与 FNV-1a 校验和；资源 `Limits`（`maxInputBytes`、`maxSections`、`maxParagraphs`、`maxCitations`、`maxFindings`、`maxOutputBytes`）是经过校验的 Config 字段，零依赖实现文档渲染。
- **使用示例**：

  ```ts
  import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-paper'

  const result = runPipeline(
    { format: 'markdown', data: '# A Study\n\nAbstract…\n\n## Method\n\nWe studied…\n' },
    validatePipeline({
      name: 'polish',
      steps: [
        { id: 'ingest', type: 'ingest' },
        { id: 'revise', type: 'revise' },
        { id: 'cite', type: 'cite', config: { style: 'gb7714' } },
      ],
    }),
    { maxInputBytes: 8 * 1024 * 1024, maxSections: 200, maxParagraphs: 200, maxCitations: 500, maxFindings: 200 },
    crypto.randomUUID(),
  )
  ```

### 8. tool-paper 插件（`@deepseek-ai/dsh-tool-paper`）

- **名称**：`@deepseek-ai/dsh-tool-paper`（插件名 `tool-paper`，包位于 `packages/paper/tool-paper/`）
- **用途**：将 paper 引擎暴露给模型，注册 6 个 `paper_*` 工具：`paper_ingest`、`paper_revise`、`paper_format`、`paper_cite`、`paper_run`（校验并运行具名流水线，返回完整 `RunRecord`）与 `paper_export`（导出 `.docx` / `.doc`，返回 base64 字节、sha256 校验和、格式与字节数）。
- **实现方式**：插件在 `ctx.tools` 上注册工具，参数通过引擎 schema 校验；`style` 为枚举（`gb7714` / `apa` / `mla`）。
- **使用示例**（由模型调用）：

  ```json
  { "name": "paper_run", "arguments": { "format": "markdown", "data": "# A Study\n\nAbstract…", "pipeline": { "name": "polish", "steps": [ { "id": "ingest", "type": "ingest" }, { "id": "cite", "type": "cite", "config": { "style": "gb7714" } } ] } } }
  ```

### 9. 新增 agent 预设

Web UI 通过 agent preset 内建四个专业 Agent（位于 `apps/cli/config/agent-presets/`），在对应 persona 下挂载上述工具集：

| 预设目录 | 名称 | 用途 | 挂载工具 |
| --- | --- | --- | --- |
| `agent-presets/dev/` | 程序开发 Agent | 跨 Python / JavaScript / Java 的代码生成、补全、重构与优化，通过 `code_analyze` / `code_check` 做质量与安全分析，支持任务规划与进度跟踪 | `@deepseek-ai/dsh-tool-code` |
| `agent-presets/exploration/` | 勘探数据处理 Agent | 解析 CSV / JSON / SEG-Y，执行清洗、格式转换、特征提取与异常检测，报告可追溯的运行记录 | `@deepseek-ai/dsh-tool-exploration` |
| `agent-presets/consistency/` | 一致性测试 Agent | 统一台站目录命名、规划 mini-SEED → SAC 转换、解析激发时为 UTC 裁波时间窗并划分绘图批次；绘制后分析台站数据偏移并报告需要剔除的异常台站（人工执行剔除），报告可追溯的运行记录 | `@deepseek-ai/dsh-tool-consistency` |
| `agent-presets/paper/` | 科研论文写作 Agent | 解析手稿、优化论文内容、规范化格式，将参考文献整理为 GB/T 7714、APA、MLA 等主流引文风格 | `@deepseek-ai/dsh-tool-paper` |

使用方式：在浏览器打开 Web UI 后，从 agent-preset 选择器中选中对应 Agent 即可就地使用。

### 10. 新增示例（examples）

三个可运行的示例 bundle 位于 `examples/`，每个都包含组合 `cordis.yml`、示例数据（`samples/`）、可执行驱动（`tests/fixtures/*-driver.ts`）与无密钥冒烟测试（`tests/keyless-smoke.e2e.ts`）：

- [`examples/code-agent/`](examples/code-agent/README.md)：程序开发 agent 组合。配置 `DEEPSEEK_API_KEY` 后运行：

  ```sh
  pnpm exec tsx examples/code-agent/tests/fixtures/code-driver.ts \
    examples/code-agent/cordis.yml \
    "analyze and then improve the python processor in samples/sample_processor.py"
  ```

- [`examples/exploration-agent/`](examples/exploration-agent/README.md)：勘探数据处理 agent 组合。运行：

  ```sh
  pnpm exec tsx examples/exploration-agent/tests/fixtures/exploration-driver.ts \
    examples/exploration-agent/cordis.yml \
    "process this gamma-ray log: 0,45 5,62 10,58 15,220 20,55"
  ```

- [`examples/paper-agent/`](examples/paper-agent/README.md)：科研论文写作 agent 组合。运行：

  ```sh
  pnpm exec tsx examples/paper-agent/tests/fixtures/paper-driver.ts \
    examples/paper-agent/cordis.yml \
    "polish this manuscript: scratch document in samples/manuscript-example.md"
  ```

以上驱动以 JSONL 形式输出规范化的会话事件（属测试基础设施，不是受支持的 CLI 输出格式）。无密钥冒烟测试可通过 `npx vitest run --config vitest.e2e.config.ts examples/<agent>/tests/keyless-smoke.e2e.ts` 运行。

### 9. 配套集成

- **工具目录生成**：`scripts/gen-tool-catalog.ts` 将上述工具纳入生成的 [`docs/tool-catalog.md`](docs/tool-catalog.md) 与 API 目录，模型可直接看到 `code_*` / `exploration_*` / `consistency_*` / `paper_*` schemas。
- **子系统文档**：`docs/subsystems/code.md`、`docs/subsystems/exploration.md`、`docs/subsystems/consistency.md`、`docs/subsystems/paper.md` 记录各模块架构说明。
- **Agent Notes**：`.agents/notes/implemented/feature/` 下的勘探数据处理、密集台阵一致性测试与学术论文写作 agent 设计笔记记录了实现与演进决策。
- **TypeScript 路径与编译器面**：`tsconfig.base.json` 的 `paths` 与 `tsconfig.host.json` 的引用已加入新增包。

## 运行

<a id="run"></a>

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

### 从源码运行

<a id="run-from-source"></a>

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 加入 <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord 社区</a>。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
