# Academic Paper Writing

English | [中文](paper.zh.md)

The academic paper writing service (`ctx.paper`) validates and registers named processing pipelines from the plugin config and runs them end to end: parse a raw manuscript into a structured paper, revise the content, standardize the paper format, and organize the references into GB/T 7714, APA, or MLA, returning a traceability run record. The pure, framework-free engine functions and types live in [`@deepseek-ai/dsh-paper`](../../packages/paper/paper/README.md).

## Service behavior

[`PaperService`](../../packages/paper/paper/src/service.ts) validates every configured pipeline at mount, registers it by name, and resolves the deployment limits from validated `Config` fields. `runPipeline` records per-step `StepRecord`s (timestamps, duration, input hash, output summary, notes) on a `RunRecord` with an input checksum; a failing step is captured on the record without aborting the caller, and the output falls back to the last completed paper. The model-facing `paper_*` tools in [`@deepseek-ai/dsh-tool-paper`](../../packages/paper/tool-paper/README.md) call the engine's pure processors directly.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpaper--paperservice"></a>

### `ctx.paper` — `PaperService`

Registry and runner for academic paper-writing pipelines.

```ts cordis-catalog
/**
 * Register a named pipeline; duplicate names fail loud.
 * @param pipeline - raw pipeline definition to validate and register.
 */
registerPipeline(pipeline: unknown): void

/**
 * List the registered pipelines in registration order.
 * @returns the registered pipelines.
 */
listPipelines(): readonly Pipeline[]

/**
 * Run a registered pipeline by name over raw manuscript input.
 * @param name - registered pipeline name.
 * @param input - raw input handed to the ingest step.
 * @returns the traceability run record.
 */
run(name: string, input: ProcessingInput): RunRecord

/**
 * Run a one-off pipeline definition over raw manuscript input.
 * @param input - raw input handed to the ingest step.
 * @param pipeline - raw pipeline definition, validated before running.
 * @returns the traceability run record.
 */
runPipeline(input: ProcessingInput, pipeline: unknown): RunRecord
```

Source: [`packages/paper/paper/src/service.ts`](../../packages/paper/paper/src/service.ts)
<!-- END GENERATED cordis-surface -->