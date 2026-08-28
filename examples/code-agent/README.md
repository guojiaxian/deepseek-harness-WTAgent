# code-agent

English | [中文](README.zh.md)

This directory owns the replay and real-model test composition for a professional program-development agent: DeepSeek V4 + the `dsh-code` engine and its model-facing `code_analyze` / `code_check` tools, all composed on the shared agent spine with JSONL persistence. It writes, completes, refactors, and optimizes code across Python, JavaScript, and Java, grounds every change by running static analysis (language detection, metrics, cyclomatic complexity, quality score, and static quality/security findings), then runs and tests edited programs in the shell.

## Run it

The composition registers the code-analysis service (resource limits and default static-check toggles) in [`cordis.yml`](cordis.yml). The model uses the `code_analyze` / `code_check` tools to ground edits and the shell tool to run and test them. With `DEEPSEEK_API_KEY` in the gitignored root `.env` (or exported), stream one real turn through the example's driver:

```sh
pnpm exec tsx examples/code-agent/tests/fixtures/code-driver.ts \
  examples/code-agent/cordis.yml \
  "analyze and then improve the python processor in samples/sample_processor.py"
```

The driver emits canonical session events as JSONL before its result record; that stream is test infrastructure, not a supported CLI output format.

## Keyless smoke

[`tests/keyless-smoke.e2e.ts`](tests/keyless-smoke.e2e.ts) replays the composition through [`tests/fixtures/code-driver.ts`](tests/fixtures/code-driver.ts) with a mock LLM: one real `code_analyze` tool call over an inline python snippet, then a final answer, asserting the analysis record is persisted as a zstd-compressed session log. Run it without any API key:

```sh
npx vitest run --config vitest.e2e.config.ts examples/code-agent/tests/keyless-smoke.e2e.ts
```

## Content

The web surface ships this agent as the `dev` agent preset (`apps/cli/config/agent-presets/dev/`), which mounts `@deepseek-ai/dsh-tool-code` behind a program-development persona with plan mode and progress tracking. Select it in the browser's agent-preset picker to analyze and develop code there.