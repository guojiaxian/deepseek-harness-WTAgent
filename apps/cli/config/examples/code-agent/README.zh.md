# code-agent

[English](README.md) | 中文

本目录拥有专业程序开发 agent 的重放与真实模型测试组合：DeepSeek V4 + `dsh-code` 引擎及其面向模型的 `code_analyze` / `code_check` 工具，全部组合在共享 agent spine 上并使用 JSONL 持久化。它在 Python、JavaScript 与 Java 之间编写、补全、重构与优化代码，通过运行静态分析（语言检测、行度量、圈复杂度、质量得分以及静态质量／安全发现）来为每次改动提供依据，然后在 shell 中运行并对修改后的程序进行测试。

## 运行

组合在 [`cordis.yml`](cordis.yml) 中注册了代码分析服务（资源限额与默认静态检查开关）。模型使用 `code_analyze` / `code_check` 工具为编辑提供依据，并使用 shell 工具运行和测试。在已被 gitignore 的仓库根目录 `.env` 中（或通过导出环境变量）配置 `DEEPSEEK_API_KEY` 后，可通过示例驱动流式执行一次真实会话：

```sh
pnpm exec tsx examples/code-agent/tests/fixtures/code-driver.ts \
  examples/code-agent/cordis.yml \
  "analyze and then improve the python processor in samples/sample_processor.py"
```

驱动会以 JSONL 形式输出规范化的会话事件，随后输出结果记录；该流属于测试基础设施，不是受支持的 CLI 输出格式。

## 无密钥冒烟

[`tests/keyless-smoke.e2e.ts`](tests/keyless-smoke.e2e.ts) 通过 [`tests/fixtures/code-driver.ts`](tests/fixtures/code-driver.ts) 使用 mock LLM 重放该组合：对内联 Python 片段执行一次真实的 `code_analyze` 工具调用，然后给出最终答复，并断言分析记录以 zstd 压缩的会话日志持久化。无需任何 API key 即可运行：

```sh
npx vitest run --config vitest.e2e.config.ts examples/code-agent/tests/keyless-smoke.e2e.ts
```

## Web 内建

Web 端以 agent preset 内建本 agent（`apps/cli/config/agent-presets/dev/`），在程序开发 persona 之下挂载 `@deepseek-ai/dsh-tool-code`，并支持计划模式与进度跟踪。可在浏览器的 agent-preset 选择器中选中它，就地分析并开发代码。