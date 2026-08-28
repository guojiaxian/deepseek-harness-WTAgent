# exploration-agent

English | [中文](README.zh.md)

This directory owns the replay and real-model test composition for a professional exploration data processing agent: DeepSeek V4 + the `dsh-exploration` engine and its model-facing `exploration_*` tools, all composed on the shared agent spine with JSONL persistence. It accepts raw exploration records (geology, geophysics, or well-log data) and processes them professionally: parse the input, clean it, convert units or depth/time, extract statistics, detect anomalies, and render seismic section profiles, then report the traceability run record.

## Run it

The composition registers two pipelines in [`cordis.yml`](cordis.yml): `well-log-qc` (trim strings, convert depth to metres, extract statistics, flag z-score anomalies) and `seismic-profile` (ingest a seismic section and render it to PNG/SVG). The model can also pass a one-off pipeline to the `exploration_run` tool. With `DEEPSEEK_API_KEY` in the gitignored root `.env` (or exported), stream one real turn through the example's driver:

```sh
pnpm exec tsx examples/exploration-agent/tests/fixtures/exploration-driver.ts \
  examples/exploration-agent/cordis.yml \
  "process this gamma-ray log: 0,45 5,62 10,58 15,220 20,55"
```

The driver emits canonical session events as JSONL before its result record; that stream is test infrastructure, not a supported CLI output format.

## Keyless smoke

[`tests/keyless-smoke.e2e.ts`](tests/keyless-smoke.e2e.ts) replays the composition through [`tests/fixtures/exploration-driver.ts`](tests/fixtures/exploration-driver.ts) with a mock LLM: one real `exploration_run` tool call over an inline gamma-ray pipeline, then a final answer, asserting the traceability record is persisted as a zstd-compressed session log. Run it without any API key:

```sh
npx vitest run --config vitest.e2e.config.ts examples/exploration-agent/tests/keyless-smoke.e2e.ts
```

## Content

The web surface ships this agent as the `exploration` agent preset (`apps/cli/config/agent-presets/exploration/`), which mounts `@deepseek-ai/dsh-tool-exploration` behind an exploration persona. Select it in the browser's agent-preset picker to process exploration data there.
