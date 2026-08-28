# Dense-Array Consistency Testing

English | [中文](consistency.zh.md)

The dense-array consistency-test service (`ctx.consistency`) validates and registers named
processing pipelines from the plugin config and runs them end to end over the device inventory and
excitation times: unify station directory names, plan the mini-SEED → SAC conversion by `C`/`E`
kind, parse the `datetime.dat` arrivals (北京时间 → UTC) into cut windows, partition stations into
waveform plot batches, and after plotting analyze each station's measured data offset against the
configured threshold and report which stations to exclude (the operator removes the abnormal device
manually), returning a traceability run record. The generic pipeline shape is the
same `ingest → …` flow used by the exploration and paper services. The pure, framework-free engine
functions and types live in [`@deepseek-ai/dsh-consistency`](../../packages/consistency/consistency/README.md).

## Service behavior

[`ConsistencyService`](../../packages/consistency/consistency/src/service.ts) validates every
configured pipeline at mount, registers it by name, and resolves the deployment limits from
validated Config fields. `runPipeline` records per-step `StepRecord`s (timestamps, duration, input
hash, output summary, notes) on a `RunRecord` with an input checksum; a failing step — including an
`INCOMPLETE_DATA` convert step when a converter is missing — is captured on the record without
aborting the caller, and the output falls back to the last completed workflow. The model-facing
`consistency_*` tools in
[`@deepseek-ai/dsh-tool-consistency`](../../packages/consistency/tool-consistency/README.md) call
the engine's pure processors directly.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxconsistency--consistencyservice"></a>

### `ctx.consistency` — `ConsistencyService`

Registry and runner for consistency-test engineering pipelines.

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
 * Run a registered pipeline by name over raw input.
 * @param name - registered pipeline name.
 * @param input - raw input handed to the ingest step.
 * @returns the traceability run record.
 */
run(name: string, input: ProcessingInput): RunRecord

/**
 * Run a one-off pipeline definition over raw input.
 * @param input - raw input handed to the ingest step.
 * @param pipeline - raw pipeline definition, validated before running.
 * @returns the traceability run record.
 */
runPipeline(input: ProcessingInput, pipeline: unknown): RunRecord
```

Source: [`packages/consistency/consistency/src/service.ts`](../../packages/consistency/consistency/src/service.ts)
<!-- END GENERATED cordis-surface -->