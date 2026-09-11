/**
 * Model-facing `exploration_*` tools over the `@deepseek-ai/dsh-exploration`
 * engine's pure processors. Every tool validates its arguments through the
 * engine's own config schemas, runs the matching processor, and returns a
 * compact JSON dataset plus row/column counts and provenance notes; the run
 * tool returns the engine's full traceability record. Named exports only (no
 * default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-tool-exploration
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Dataset, Limits, ProcessingInput, ProcessorResult } from '@deepseek-ai/dsh-exploration'
import {
  clean, convert, detect, extract, ingest, profile, runPipeline, validatePipeline,
} from '@deepseek-ai/dsh-exploration'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-exploration'

/** Services required by the tool plugin. */
export const inject = ['tools']

/** Resource-limit configuration of the model-facing exploration tools. */
export interface Config {
  /** Maximum accepted input bytes; default 8 MiB. */
  maxInputBytes?: number
  /** Maximum rows after any step; default 50 000. */
  maxRows?: number
  /** Maximum columns after any step; default 1024. */
  maxColumns?: number
  /** Maximum anomaly records kept per detection; default 500. */
  maxAnomalyRecords?: number
}

/** Schemastery config for the tool consumer. */
export const Config: z<Config> = z.object({
  maxInputBytes: z.number().default(8 * 1024 * 1024),
  maxRows: z.number().default(50_000),
  maxColumns: z.number().default(1024),
  maxAnomalyRecords: z.number().default(500),
})

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ROWS = 50_000
const DEFAULT_MAX_COLUMNS = 1024
const DEFAULT_MAX_ANOMALY_RECORDS = 500

/**
 * Materialize the resource limits even when `apply` is called directly outside
 * Loader normalization.
 * @param config - plugin configuration.
 * @returns the fully populated limits.
 */
function resolveConfig(config: Config): Limits {
  return {
    maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxRows: config.maxRows ?? DEFAULT_MAX_ROWS,
    maxColumns: config.maxColumns ?? DEFAULT_MAX_COLUMNS,
    maxAnomalyRecords: config.maxAnomalyRecords ?? DEFAULT_MAX_ANOMALY_RECORDS,
  }
}

/**
 * Rebuild a readonly engine {@link Dataset} into a plain mutable JSON value.
 * The engine types are readonly and carry an open meta index signature, so the
 * cast records that the rebuilt object is JSON-safe by construction.
 * @param dataset - engine dataset to project.
 * @returns the dataset as a plain JSON value.
 */
function datasetToValue(dataset: Dataset): JsonValue {
  return {
    columns: dataset.columns.map(column => ({ ...column })),
    rows: dataset.rows.map(row => [...row]),
    meta: { ...dataset.meta },
  } as unknown as JsonValue
}

/** The compact model-facing result every transform tool returns. */
interface TransformToolValue {
  dataset: JsonValue
  rowCount: number
  columnCount: number
  notes: string[]
}

/** Project one processor result into the compact transform value. */
function transformValue(result: ProcessorResult): TransformToolValue {
  return {
    dataset: datasetToValue(result.dataset),
    rowCount: result.dataset.rows.length,
    columnCount: result.dataset.columns.length,
    notes: [...result.notes],
  }
}

/** Re-export the engine's public types for host composition. */
export type {
  Dataset, IngestConfig, CleanConfig, ConvertConfig, ExtractConfig, DetectConfig, ProfileConfig, ProfileOutput,
  RunRecord, Pipeline, ProcessingInput, Limits,
} from '@deepseek-ai/dsh-exploration'

/** Shared output schema of the five transform tools. */
const TRANSFORM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dataset: { type: 'json', required: true },
    rowCount: { type: 'integer', required: true },
    columnCount: { type: 'integer', required: true },
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
        rowCount: { type: 'integer', required: true },
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
        rowCount: { type: 'integer', required: true },
        columnCount: { type: 'integer', required: true },
        shape: { type: 'string', required: true },
        checksum: { type: 'string', required: true },
      },
    },
  },
} as const

/** Output schema of the profile render tool. */
const PROFILE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profile: { type: 'json', required: true },
    notes: { type: 'array', required: true, items: { type: 'string' } },
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
  input: { format: string; rowCount: number; bytes: number; checksum: string }
  steps: Record<string, JsonValue>[]
  output: JsonValue
  outputSummary: { rowCount: number; columnCount: number; shape: string; checksum: string }
}

/** The compact model-facing profile render result. */
interface ProfileToolValue {
  profile: JsonValue
  notes: string[]
}

/** Project a profile processor result into the compact render value. */
function profileValue(result: ProcessorResult): ProfileToolValue {
  return {
    profile: (result.dataset.meta as Record<string, unknown>).profile as JsonValue,
    notes: [...result.notes],
  }
}

/**
 * Build the engine's raw {@link ProcessingInput} from tool arguments; SEG-Y is
 * transported as base64 text and decoded here.
 * @param format - input format name.
 * @param data - CSV/JSON text or base64 SEG-Y.
 * @param source - optional source label.
 * @returns the processing input.
 */
function buildInput(format: string, data: string, source: string | undefined): ProcessingInput {
  return {
    format,
    data: format === 'segy' ? Buffer.from(data, 'base64') : data,
    ...(source !== undefined ? { source } : {}),
  }
}

/** Generic, args-only pending presentation shared by the exploration tools. */
function present(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/**
 * Register the seven exploration tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's resource-limit policy.
 */
export function apply(ctx: Context, config: Config): void {
  const limits = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'exploration_ingest',
    description: 'Parse raw exploration input (CSV, JSON, or base64-encoded SEG-Y) into a tabular dataset.',
    parameters: {
      format: {
        type: 'string',
        required: true,
        enum: ['csv', 'json', 'segy'],
        description: 'Input format; csv and json take text, segy takes base64-encoded bytes.',
      },
      data: { type: 'string', required: true, description: 'The raw input: CSV/JSON text or base64 SEG-Y.' },
      source: { type: 'string', description: 'Optional source label recorded in the dataset meta.' },
      config: {
        type: 'json',
        description: 'Ingest options (delimiter, hasHeader, trim, inferTypes, longFormat, sampleLimit).',
      },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (args, value) => [{
        type: 'text',
        text: `Ingested ${args.format} as ${value.rowCount} rows x ${value.columnCount} columns — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = ingest.validate(args.config ?? {})
      const input = buildInput(args.format, args.data, args.source)
      return Promise.resolve(transformValue(ingest.run(input, cfg, limits)))
    },
    presentCall: args => present('Ingest exploration data', args),
  }))

  ctx.tools.register(defineTool({
    name: 'exploration_clean',
    description: 'Clean an exploration dataset: missing-value policy, numeric ranges, dedupe, drops, renames, and type coercion.',
    parameters: {
      dataset: { type: 'json', required: true, description: 'The exploration dataset JSON from a prior exploration_* tool.' },
      config: {
        type: 'json',
        required: true,
        description: 'Clean options (missing, ranges, dedupe, dropColumns, renameColumns, trimStrings, columnTypes).',
      },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Cleaned to ${value.rowCount} rows x ${value.columnCount} columns — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = clean.validate(args.config)
      return Promise.resolve(transformValue(clean.run(args.dataset as unknown as Dataset, cfg)))
    },
    presentCall: args => present('Clean exploration dataset', args),
  }))

  ctx.tools.register(defineTool({
    name: 'exploration_convert',
    description: 'Convert an exploration dataset: unit conversions, depth↔time, and column selection.',
    parameters: {
      dataset: { type: 'json', required: true, description: 'The exploration dataset JSON from a prior exploration_* tool.' },
      config: { type: 'json', required: true, description: 'Convert options (units, depthTime, selectColumns).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Converted to ${value.rowCount} rows x ${value.columnCount} columns — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = convert.validate(args.config)
      return Promise.resolve(transformValue(convert.run(args.dataset as unknown as Dataset, cfg)))
    },
    presentCall: args => present('Convert exploration dataset', args),
  }))

  ctx.tools.register(defineTool({
    name: 'exploration_extract',
    description: 'Extract exploration statistics: descriptive statistics, rolling windows, and RMS amplitude.',
    parameters: {
      dataset: { type: 'json', required: true, description: 'The exploration dataset JSON from a prior exploration_* tool.' },
      config: { type: 'json', required: true, description: 'Extract options (statistics, rolling, rms).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Extracted statistics over ${value.rowCount} rows x ${value.columnCount} columns — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = extract.validate(args.config)
      return Promise.resolve(transformValue(extract.run(args.dataset as unknown as Dataset, cfg)))
    },
    presentCall: args => present('Extract exploration statistics', args),
  }))

  ctx.tools.register(defineTool({
    name: 'exploration_detect',
    description: 'Detect exploration anomalies: z-score, IQR, hard thresholds, spikes, dead traces, and nulls.',
    parameters: {
      dataset: { type: 'json', required: true, description: 'The exploration dataset JSON from a prior exploration_* tool.' },
      config: { type: 'json', required: true, description: 'Detect options (zscore, iqr, threshold, spike, deadTrace, nulls).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Detected anomalies in ${value.rowCount} rows x ${value.columnCount} columns — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = detect.validate(args.config)
      return Promise.resolve(transformValue(detect.run(args.dataset as unknown as Dataset, cfg, limits)))
    },
    presentCall: args => present('Detect exploration anomalies', args),
  }))

  ctx.tools.register(defineTool({
    name: 'exploration_run',
    description: 'Run a full exploration pipeline (ingest first, then clean/convert/extract/detect/profile steps) and return the traceability record; a profile step renders a seismic section into the output meta.',
    parameters: {
      format: {
        type: 'string',
        required: true,
        enum: ['csv', 'json', 'segy'],
        description: 'Input format; csv and json take text, segy takes base64-encoded bytes.',
      },
      data: { type: 'string', required: true, description: 'The raw input: CSV/JSON text or base64 SEG-Y.' },
      source: { type: 'string', description: 'Optional source label recorded in the ingested dataset meta.' },
      pipeline: { type: 'json', required: true, description: 'Named pipeline whose first step is ingest.' },
    },
    output: {
      schema: RUN_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const profile = (value.output as { meta?: { profile?: unknown } } | undefined)?.meta?.profile
        const profileText = profile !== undefined ? ' with profile' : ''
        return [{
          type: 'text',
          text: `Run ${value.runId} [${value.pipelineName}] ${value.status}: ${value.steps.length} steps, output ${value.outputSummary.shape}${profileText}`,
        }]
      },
    },
    execute(args) {
      const pipeline = validatePipeline(args.pipeline)
      const input = buildInput(args.format, args.data, args.source)
      // The engine's traceability record is readonly and holds an open Dataset;
      // it is JSON-safe by construction and matches RUN_OUTPUT_SCHEMA, so the
      // cast only bridges the readonly engine types to the mutable JSON value.
      return Promise.resolve(runPipeline(input, pipeline, limits, randomUUID()) as unknown as RunToolValue)
    },
    presentCall: args => present('Run exploration pipeline', args),
  }))

  ctx.tools.register(defineTool({
    name: 'exploration_profile',
    description: 'Render a seismic section profile (PNG and/or SVG) from an exploration dataset and return the render under the profile key; use after parsing and validating SEG-Y.',
    parameters: {
      dataset: { type: 'json', required: true, description: 'The exploration dataset JSON from a prior exploration_* tool.' },
      config: {
        type: 'json',
        required: true,
        description: 'Profile options (formats, width, height, colorMap, title).',
      },
    },
    output: {
      schema: PROFILE_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Profile rendered — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = profile.validate(args.config)
      return Promise.resolve(profileValue(profile.run(args.dataset as unknown as Dataset, cfg)))
    },
    presentCall: args => present('Render seismic profile', args),
  }))
}
