# paper-agent

English | [中文](README.zh.md)

This directory owns the replay and real-model test composition for a professional academic paper-writing agent: DeepSeek V4 + the `dsh-paper` engine and its model-facing `paper_*` tools, all composed on the shared agent spine with JSONL persistence. It receives manuscripts and helps authors professionally: revise the content, standardize the paper format, and organize the references into GB/T 7714, APA, or MLA, then report the traceability run record.

## Run it

The composition registers one configurable pipeline, `academic-polish` (ingest a Markdown manuscript, revise its wording, standardize its format, and organize its references into GB/T 7714), in [`cordis.yml`](cordis.yml). The model can also pass a one-off pipeline to the `paper_run` tool. With `DEEPSEEK_API_KEY` in the gitignored root `.env` (or exported), stream one real turn through the example's driver:

```sh
pnpm exec tsx examples/paper-agent/tests/fixtures/paper-driver.ts \
  examples/paper-agent/cordis.yml \
  "polish this manuscript: scratch document in samples/manuscript-example.md"
```

The driver emits canonical session events as JSONL before its result record; that stream is test infrastructure, not a supported CLI output format.

## Keyless smoke

[`tests/keyless-smoke.e2e.ts`](tests/keyless-smoke.e2e.ts) replays the composition through [`tests/fixtures/paper-driver.ts`](tests/fixtures/paper-driver.ts) with a mock LLM: one real `paper_run` tool call over an inline academic-polish pipeline, then a final answer, asserting the traceability record is persisted as a zstd-compressed session log. Run it without any API key:

```sh
npx vitest run --config vitest.e2e.config.ts examples/paper-agent/tests/keyless-smoke.e2e.ts
```

## Content

The web surface ships this agent as the `paper` agent preset (`apps/cli/config/agent-presets/paper/`), which mounts `@deepseek-ai/dsh-tool-paper` behind a paper-writing persona. Select it in the browser's agent-preset picker to polish papers there.