# paper-agent

[English](README.md) | 中文

本目录拥有专业科研论文写作 agent 的重放与真实模型测试组合：DeepSeek V4 + `dsh-paper` 引擎及其面向模型的 `paper_*` 工具，全部组合在共享 agent spine 上并使用 JSONL 持久化。它接收论文手稿并专业地帮助作者：修改与优化内容、规范化论文格式、将参考文献整理为 GB/T 7714、APA 或 MLA 格式，然后报告可追溯的 run 记录。

## 运行

组合在 [`cordis.yml`](cordis.yml) 中注册了一个可配置的流水线 `academic-polish`（解析 Markdown 手稿、修改措辞、规范化格式、将参考文献整理为 GB/T 7714 格式）。模型也可以向 `paper_run` 工具传入一次性流水线。在已被 gitignore 的仓库根目录 `.env` 中（或通过导出环境变量）配置 `DEEPSEEK_API_KEY` 后，可通过示例驱动流式执行一次真实会话：

```sh
pnpm exec tsx examples/paper-agent/tests/fixtures/paper-driver.ts \
  examples/paper-agent/cordis.yml \
  "polish this manuscript: scratch document in samples/manuscript-example.md"
```

驱动会以 JSONL 形式输出规范化的会话事件，随后输出结果记录；该流属于测试基础设施，不是受支持的 CLI 输出格式。

## 无密钥冒烟

[`tests/keyless-smoke.e2e.ts`](tests/keyless-smoke.e2e.ts) 通过 [`tests/fixtures/paper-driver.ts`](tests/fixtures/paper-driver.ts) 使用 mock LLM 重放该组合：对内联学术润色流水线执行一次真实的 `paper_run` 工具调用，然后给出最终答复，并断言可追溯记录以 zstd 压缩的会话日志持久化。无需任何 API key 即可运行：

```sh
npx vitest run --config vitest.e2e.config.ts examples/paper-agent/tests/keyless-smoke.e2e.ts
```

## Web 内建

Web 端以 agent preset 内建本 agent（`apps/cli/config/agent-presets/paper/`），在论文写作 persona 之下挂载 `@deepseek-ai/dsh-tool-paper`。可在浏览器的 agent-preset 选择器中选中它，就地润色论文。