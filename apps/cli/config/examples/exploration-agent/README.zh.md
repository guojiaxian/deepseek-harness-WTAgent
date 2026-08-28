# exploration-agent

[English](README.md) | 中文

本目录拥有专业勘探数据处理 agent 的重放与真实模型测试组合：DeepSeek V4 + `dsh-exploration` 引擎及其面向模型的 `exploration_*` 工具，全部组合在共享 agent spine 上并使用 JSONL 持久化。它接收原始勘探记录（地质、地球物理或测井数据）并进行专业处理：解析输入、清洗、单位或深度／时间转换、统计提取与异常检测，然后报告可追溯的 run 记录。

## 运行

组合在 [`cordis.yml`](cordis.yml) 中注册了一个可配置的 QC 流水线 `well-log-qc`（修剪字符串、深度转米、统计提取、z-score 异常标记）。模型也可以向 `exploration_run` 工具传入一次性流水线。在已被 gitignore 的仓库根目录 `.env` 中（或通过导出环境变量）配置 `DEEPSEEK_API_KEY` 后，可通过示例驱动流式执行一次真实会话：

```sh
pnpm exec tsx examples/exploration-agent/tests/fixtures/exploration-driver.ts \
  examples/exploration-agent/cordis.yml \
  "process this gamma-ray log: 0,45 5,62 10,58 15,220 20,55"
```

驱动会以 JSONL 形式输出规范化的会话事件，随后输出结果记录；该流属于测试基础设施，不是受支持的 CLI 输出格式。

## 无密钥冒烟

[`tests/keyless-smoke.e2e.ts`](tests/keyless-smoke.e2e.ts) 通过 [`tests/fixtures/exploration-driver.ts`](tests/fixtures/exploration-driver.ts) 使用 mock LLM 重放该组合：对内联伽马射线流水线执行一次真实的 `exploration_run` 工具调用，然后给出最终答复，并断言可追溯记录以 zstd 压缩的会话日志持久化。无需任何 API key 即可运行：

```sh
npx vitest run --config vitest.e2e.config.ts examples/exploration-agent/tests/keyless-smoke.e2e.ts
```

## Web 内建

Web 端以 agent preset 内建本 agent（`apps/cli/config/agent-presets/exploration/`），在勘探 persona 之下挂载 `@deepseek-ai/dsh-tool-exploration`。可在浏览器的 agent-preset 选择器中选中它，就地处理勘探数据。
