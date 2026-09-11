/**
 * Model-facing `consistency_*` tools over the `@deepseek-ai/dsh-consistency`
 * engine's pure processors. Every tool validates its arguments through the
 * engine's config schemas, runs the matching processor over the workflow JSON,
 * and returns the updated workflow plus station/seed/arrival/plot-batch counts
 * and provenance notes; the run tool returns the engine's full traceability
 * record. Named exports only (no default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-tool-consistency
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Limits, ProcessingInput, ProcessorResult, Workflow } from '@deepseek-ai/dsh-consistency'
import {
  convert, cut, exclude, ingest, plot, rename, runPipeline, validatePipeline,
} from '@deepseek-ai/dsh-consistency'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-consistency'

/** Services required by the tool plugin. */
export const inject = ['tools']

/** Resource-limit configuration of the model-facing consistency tools. */
export interface Config {
  /** Maximum accepted input bytes; default 8 MiB. */
  maxInputBytes?: number
  /** Maximum stations kept; default 10 000. */
  maxStations?: number
  /** Maximum seed files kept; default 100 000. */
  maxSeedFiles?: number
  /** Maximum arrival windows kept; default 10 000. */
  maxArrivals?: number
}

/** Schemastery config for the tool consumer. */
export const Config: z<Config> = z.object({
  maxInputBytes: z.number().default(8 * 1024 * 1024),
  maxStations: z.number().default(10_000),
  maxSeedFiles: z.number().default(100_000),
  maxArrivals: z.number().default(10_000),
})

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_STATIONS = 10_000
const DEFAULT_MAX_SEED_FILES = 100_000
const DEFAULT_MAX_ARRIVALS = 10_000

/**
 * Materialize the resource limits even when `apply` is called directly outside
 * Loader normalization.
 * @param config - plugin configuration.
 * @returns the fully populated limits.
 */
function resolveConfig(config: Config): Limits {
  return {
    maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxStations: config.maxStations ?? DEFAULT_MAX_STATIONS,
    maxSeedFiles: config.maxSeedFiles ?? DEFAULT_MAX_SEED_FILES,
    maxArrivals: config.maxArrivals ?? DEFAULT_MAX_ARRIVALS,
  }
}

/**
 * Project an engine {@link Workflow} into a plain JSON value. The engine types
 * are readonly and carry an open meta index signature, but the workflow is
 * JSON-safe by construction, so the cast only bridges readonly types.
 * @param workflow - engine workflow to project.
 * @returns the workflow as a plain JSON value.
 */
function workflowValue(workflow: Workflow): JsonValue {
  return { ...workflow } as unknown as JsonValue
}

/** The compact model-facing result every transform tool returns. */
interface TransformToolValue {
  workflow: JsonValue
  stationCount: number
  seedCount: number
  arrivalCount: number
  plotBatchCount: number
  notes: string[]
}

/** Project one processor result into the compact transform value. */
function transformValue(result: ProcessorResult): TransformToolValue {
  const workflow = result.workflow
  return {
    workflow: workflowValue(workflow),
    stationCount: workflow.stations.length,
    seedCount: workflow.stations.reduce((sum, station) => sum + station.seedFiles.length, 0),
    arrivalCount: workflow.arrivals.length,
    plotBatchCount: workflow.plotBatches.length,
    notes: [...result.notes],
  }
}

/** Re-export the engine's public types for host composition. */
export type {
  Workflow, Station, SeedFile, Arrival, PlotBatch, WorkflowMeta, RunRecord, RunError,
  Pipeline, PipelineStep, ProcessingInput, Limits, IngestConfig, RenameConfig,
  ConvertConfig, CutConfig, PlotConfig, ExcludeConfig, Exclusion, StationOffset,
  OffsetMetric, ConsistencyConfig,
} from '@deepseek-ai/dsh-consistency'

/** Shared output schema of the five transform tools. */
const TRANSFORM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workflow: { type: 'json', required: true },
    stationCount: { type: 'integer', required: true },
    seedCount: { type: 'integer', required: true },
    arrivalCount: { type: 'integer', required: true },
    plotBatchCount: { type: 'integer', required: true },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Output schema of the exclude tool. */
const EXCLUDE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workflow: { type: 'json', required: true },
    stationCount: { type: 'integer', required: true },
    seedCount: { type: 'integer', required: true },
    arrivalCount: { type: 'integer', required: true },
    plotBatchCount: { type: 'integer', required: true },
    excludedStations: { type: 'array', required: true, items: { type: 'string' } },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Output schema of the pipeline run tool. */
const RUN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runId: { type: 'string', required: true },
    pipelineName: { type: 'string', required: true },
    pipelineDescription: { type: 'string' },
    startedAt: { type: 'string', required: true },
    finishedAt: { type: 'string', required: true },
    durationMs: { type: 'number', required: true },
    status: { type: 'string', required: true, enum: ['completed', 'failed'] },
    error: { type: 'object', additionalProperties: true },
    input: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        format: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        checksum: { type: 'string', required: true },
      },
    },
    steps: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
    output: { type: 'json', required: true },
    outputSummary: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        stationCount: { type: 'integer', required: true },
        seedFileCount: { type: 'integer', required: true },
        arrivalCount: { type: 'integer', required: true },
        plotBatchCount: { type: 'integer', required: true },
        checksum: { type: 'string', required: true },
      },
    },
  },
} as const

/** The compact model-facing pipeline run result. */
interface RunToolValue {
  runId: string
  pipelineName: string
  pipelineDescription?: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: 'completed' | 'failed'
  error?: Record<string, JsonValue>
  input: { format: string; bytes: number; checksum: string }
  steps: Record<string, JsonValue>[]
  output: JsonValue
  outputSummary: { stationCount: number; seedFileCount: number; arrivalCount: number; plotBatchCount: number; checksum: string }
}

/**
 * Build the engine's raw {@link ProcessingInput} from the interchange JSON text.
 * @param format - input format name.
 * @param data - JSON text payload.
 * @param source - optional source label.
 * @returns the processing input.
 */
function buildInput(format: string, data: string, source: string | undefined): ProcessingInput {
  return {
    format,
    data,
    ...(source !== undefined ? { source } : {}),
  }
}

/** Generic, args-only pending presentation shared by the consistency tools. */
function present(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/**
 * Register the seven consistency tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's resource-limit policy.
 */
export function apply(ctx: Context, config: Config): void {
  const limits = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'consistency_ingest',
    description: 'Build the consistency-test workflow from an interchange JSON payload (project, station directories with seed file names, and raw datetime.dat arrival lines).',
    parameters: {
      data: { type: 'string', required: true, description: 'JSON text payload of the interchange document.' },
      source: { type: 'string', description: 'Optional source label recorded in the workflow meta.' },
      config: {
        type: 'json',
        description: 'Ingest options (baseDir, inputRoot, outputSacRoot, outputCutRoot, outputFigRoot, converterC, converterE, channel, cutBefore, cutAfter, timezoneOffsetHours, batchSize).',
      },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Ingested ${value.stationCount} stations / ${value.seedCount} seeds / ${value.arrivalCount} arrivals — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = ingest.validate(args.config ?? {})
      return Promise.resolve(transformValue(ingest.run(buildInput('json', args.data, args.source), cfg, limits)))
    },
    presentCall: args => present('Ingest consistency-test workflow', args),
  }))

  ctx.tools.register(defineTool({
    name: 'consistency_rename',
    description: 'Compute uniform station directory names (C-prefix stripped, else first 4 glyphs) with collision guarding.',
    parameters: {
      workflow: { type: 'json', required: true, description: 'The workflow JSON from a prior consistency_* tool.' },
      config: { type: 'json', description: 'Rename options (none tunable; the rule is fixed).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Renamed ${value.stationCount} stations — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = rename.validate(args.config ?? {})
      return Promise.resolve(transformValue(rename.run(args.workflow as unknown as Workflow, cfg)))
    },
    presentCall: args => present('Rename consistency-test stations', args),
  }))

  ctx.tools.register(defineTool({
    name: 'consistency_convert',
    description: 'Validate the mseed2sac/e-mseed2sac converters and build the seed conversion plan by C/E kind.',
    parameters: {
      workflow: { type: 'json', required: true, description: 'The workflow JSON from a prior consistency_* tool.' },
      config: { type: 'json', description: 'Convert options (converterC, converterE overrides).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Planned ${value.seedCount} seed conversions — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = convert.validate(args.config ?? {})
      return Promise.resolve(transformValue(convert.run(args.workflow as unknown as Workflow, cfg)))
    },
    presentCall: args => present('Plan consistency-test SAC conversions', args),
  }))

  ctx.tools.register(defineTool({
    name: 'consistency_cut',
    description: 'Turn the raw datetime.dat arrival lines (Beijing time) into UTC arrival windows and cut file naming.',
    parameters: {
      workflow: { type: 'json', required: true, description: 'The workflow JSON from a prior consistency_* tool.' },
      config: { type: 'json', description: 'Cut options (cutBefore, cutAfter, timezoneOffsetHours, outputCutRoot).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Parsed ${value.arrivalCount} arrival windows — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = cut.validate(args.config ?? {})
      return Promise.resolve(transformValue(cut.run(args.workflow as unknown as Workflow, cfg)))
    },
    presentCall: args => present('Cut consistency-test arrival windows', args),
  }))

  ctx.tools.register(defineTool({
    name: 'consistency_plot',
    description: 'Partition stations into fixed-height plot batches per arrival (sorted numerically, offsets (batchSize-1-i)*1.5, Y labels WT.<sta[:4]>).',
    parameters: {
      workflow: { type: 'json', required: true, description: 'The workflow JSON from a prior consistency_* tool.' },
      config: { type: 'json', description: 'Plot options (outputFigRoot, channel, batchSize).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Planned ${value.plotBatchCount} plot batches over ${value.stationCount} stations — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = plot.validate(args.config ?? {})
      return Promise.resolve(transformValue(plot.run(args.workflow as unknown as Workflow, cfg)))
    },
    presentCall: args => present('Plan consistency-test plots', args),
  }))

  ctx.tools.register(defineTool({
    name: 'consistency_exclude',
    description: 'Analyze measured per-station data offsets (DC baseline shift / static displacement computed with obspy after plotting) against a threshold and report which stations need to be excluded. Returns the report only — plot batches and data are left unchanged; the actual device removal is a manual operator action.',
    parameters: {
      workflow: { type: 'json', required: true, description: 'The workflow JSON from a prior consistency_* tool.' },
      offsets: {
        type: 'array',
        required: true,
        description: 'Measured per-station offset magnitudes, e.g. [{"station":"0756_260818","value":12.5,"source":"obspy dc shift"}].',
        items: { type: 'object', additionalProperties: true },
      },
      config: {
        type: 'json',
        description: 'Exclude options (threshold required; metric in samples/dc-offset/amplitude; optional arrivalLabel to scope one arrival slice).',
      },
    },
    output: {
      schema: EXCLUDE_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Please exclude ${value.excludedStations.length} station(s): ${value.excludedStations.join(', ') || 'none'} — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = exclude.validate(args.config ?? {})
      const result = exclude.run(args.workflow as unknown as Workflow, cfg, args.offsets as unknown as Parameters<typeof exclude.run>[2])
      return Promise.resolve({
        workflow: workflowValue(result.workflow),
        stationCount: result.workflow.stations.length,
        seedCount: result.workflow.stations.reduce((sum, station) => sum + station.seedFiles.length, 0),
        arrivalCount: result.workflow.arrivals.length,
        plotBatchCount: result.workflow.plotBatches.length,
        excludedStations: result.workflow.exclusions.map(e => e.station),
        notes: [...result.notes],
      })
    },
    presentCall: args => present('Exclude large-offset stations from plots', args),
  }))

  ctx.tools.register(defineTool({
    name: 'consistency_run',
    description: 'Run a full consistency-test pipeline (ingest first, then rename/convert/cut/plot/exclude steps) over the interchange JSON and return the traceability record.',
    parameters: {
      data: { type: 'string', required: true, description: 'JSON text payload of the interchange document.' },
      source: { type: 'string', description: 'Optional source label recorded in the ingested workflow meta.' },
      pipeline: { type: 'json', required: true, description: 'Named pipeline whose first step is ingest.' },
    },
    output: {
      schema: RUN_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const s = value.outputSummary
        return [{
          type: 'text',
          text: `Run ${value.runId} [${value.pipelineName}] ${value.status}: ${value.steps.length} steps → ${s.stationCount} stations / ${s.seedFileCount} seeds / ${s.arrivalCount} arrivals / ${s.plotBatchCount} plot batches`,
        }]
      },
    },
    execute(args) {
      const pipeline = validatePipeline(args.pipeline)
      const input = buildInput('json', args.data, args.source)
      // The engine's traceability record is readonly and holds an open workflow;
      // it is JSON-safe by construction and matches RUN_OUTPUT_SCHEMA, so the
      // cast only bridges the readonly engine types to the mutable JSON value.
      return Promise.resolve(runPipeline(input, pipeline, limits, randomUUID()) as unknown as RunToolValue)
    },
    presentCall: args => present('Run consistency-test pipeline', args),
  }))
}
