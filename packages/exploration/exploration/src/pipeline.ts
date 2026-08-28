/**
 * Pipeline validation and execution.
 *
 * A pipeline is a named, ordered list of steps whose first step must be
 * `ingest`. Validation fails loud on empty pipelines, duplicate step ids, a
 * non-ingest first step, or an invalid step config. Execution records a
 * per-step and per-run traceability record; a failing step is captured on the
 * run record without aborting the caller, and the output falls back to the
 * last completed dataset.
 * @module @deepseek-ai/dsh-exploration
 */

import { checksumBytes, checksumDataset } from './checksum.ts'
import { ExplorationError } from './errors.ts'
import { runStep, validateStep } from './processors/index.ts'
import type {
  Dataset, DatasetSummary, InputSummary, Limits, Pipeline, PipelineStep, ProcessingInput,
  RunError, RunRecord, StepRecord, StepType,
} from './types.ts'
import { asArray, asEnum, asString, checkKeys, checkObject } from './processors/validate.ts'

const STEP_TYPES: readonly StepType[] = ['ingest', 'clean', 'convert', 'extract', 'detect', 'profile']

const EMPTY_DATASET: Dataset = { columns: [], rows: [], meta: {} }

/**
 * Validate a raw pipeline definition.
 * @param value - raw pipeline value.
 * @returns the validated pipeline with per-step validated configs.
 */
export function validatePipeline(value: unknown): Pipeline {
  const obj = checkObject(value, 'pipeline')
  checkKeys(obj, ['name', 'description', 'steps'], 'pipeline')
  const name = asString(obj.name, 'pipeline.name')
  const rawSteps = asArray(obj.steps, 'pipeline.steps')
  if (rawSteps.length === 0) {
    throw new ExplorationError('pipeline.steps must not be empty', { code: 'VALIDATION_ERROR' })
  }
  const steps: PipelineStep[] = rawSteps.map((entry, i) => {
    const s = checkObject(entry, `pipeline.steps[${i}]`)
    checkKeys(s, ['id', 'type', 'config', 'description'], `pipeline.steps[${i}]`)
    const id = asString(s.id, `pipeline.steps[${i}].id`)
    const type = asEnum(s.type, STEP_TYPES, `pipeline.steps[${i}].type`)
    const step: PipelineStep = { id, type, config: s.config }
    if (s.description !== undefined) step.description = asString(s.description, `pipeline.steps[${i}].description`)
    return step
  })
  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new ExplorationError(`duplicate step id "${step.id}"`, { code: 'VALIDATION_ERROR' })
    }
    ids.add(step.id)
  }
  if ((steps[0] as PipelineStep).type !== 'ingest') {
    throw new ExplorationError('pipeline must start with an ingest step', { code: 'VALIDATION_ERROR' })
  }
  const pipeline: Pipeline = { name, steps: steps.map(validateStep) }
  if (obj.description !== undefined) pipeline.description = asString(obj.description, 'pipeline.description')
  return pipeline
}

/**
 * Execute a validated pipeline over raw input.
 * @param input - raw input consumed by the ingest step.
 * @param pipeline - validated pipeline.
 * @param limits - resource limits enforced after every step.
 * @param runId - run identifier recorded on the result.
 * @returns the full traceability run record.
 */
export function runPipeline(input: ProcessingInput, pipeline: Pipeline, limits: Limits, runId: string): RunRecord {
  const startedAt = new Date().toISOString()
  const inputBytes = toBytes(input.data)
  const inputSummary: InputSummary = {
    format: input.format,
    rowCount: 0,
    bytes: inputBytes.byteLength,
    checksum: checksumBytes(inputBytes),
  }
  const stepRecords: StepRecord[] = []
  let status: 'completed' | 'failed' = 'completed'
  let runError: RunError | undefined
  let dataset: Dataset = EMPTY_DATASET
  let lastGood: Dataset = EMPTY_DATASET
  let provenance: string[] = []

  for (const step of pipeline.steps) {
    const stepStartedAt = new Date().toISOString()
    const isIngest = step.type === 'ingest'
    const inputHash = isIngest ? inputSummary.checksum : checksumDataset(dataset)
    let finishedAt: string
    let durationMs: number
    let record: StepRecord
    try {
      const result = runStep(step, dataset, input, limits)
      const output = withProvenance(result.dataset, provenance, step, result.notes)
      enforceLimits(output, limits)
      finishedAt = new Date().toISOString()
      durationMs = Date.parse(finishedAt) - Date.parse(stepStartedAt)
      dataset = output
      lastGood = output
      provenance = [...provenance, provenanceLine(step, result.notes)]
      record = {
        id: step.id,
        type: step.type,
        ...(step.description !== undefined ? { description: step.description } : {}),
        startedAt: stepStartedAt,
        finishedAt,
        durationMs,
        status: 'completed',
        inputHash,
        outputSummary: summarize(output),
        notes: result.notes,
      }
    } catch (error) {
      const err = asExplorationError(error)
      const fallback = isIngest ? EMPTY_DATASET : dataset
      finishedAt = new Date().toISOString()
      durationMs = Date.parse(finishedAt) - Date.parse(stepStartedAt)
      record = {
        id: step.id,
        type: step.type,
        ...(step.description !== undefined ? { description: step.description } : {}),
        startedAt: stepStartedAt,
        finishedAt,
        durationMs,
        status: 'failed',
        error: err.message,
        inputHash,
        outputSummary: summarize(fallback),
        notes: [],
      }
      status = 'failed'
      runError = { code: err.code, message: err.message, stepId: step.id }
      stepRecords.push(record)
      break
    }
    stepRecords.push(record)
  }

  const finishedAt = new Date().toISOString()
  const output = status === 'failed' ? lastGood : dataset
  const runRecord: RunRecord = {
    runId,
    pipelineName: pipeline.name,
    ...(pipeline.description !== undefined ? { pipelineDescription: pipeline.description } : {}),
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    status,
    ...(runError !== undefined ? { error: runError } : {}),
    input: inputSummary,
    steps: stepRecords,
    output,
    outputSummary: summarize(output),
  }
  return runRecord
}

/** Normalize raw input to bytes for fingerprinting. */
function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data
}

/** Canonical output summary of a dataset. */
function summarize(dataset: Dataset): DatasetSummary {
  return {
    rowCount: dataset.rows.length,
    columnCount: dataset.columns.length,
    shape: `${dataset.rows.length} x ${dataset.columns.length}`,
    checksum: checksumDataset(dataset),
  }
}

/** Rebuild dataset meta with the accumulated provenance appended for this step. */
function withProvenance(dataset: Dataset, provenance: readonly string[], step: PipelineStep, notes: readonly string[]): Dataset {
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(dataset.meta)) {
    /* v8 ignore next 1 -- every processor strips its own 'provenance' meta before withProvenance runs, so the guard never fires */
    if (key !== 'provenance') meta[key] = dataset.meta[key]
  }
  meta.provenance = [...provenance, provenanceLine(step, notes)]
  meta.rowCount = dataset.rows.length
  return { columns: dataset.columns, rows: dataset.rows, meta }
}

/** One-line provenance entry for a step. */
function provenanceLine(step: PipelineStep, notes: readonly string[]): string {
  const label = step.description !== undefined
    ? `${step.id} (${step.type}: ${step.description})`
    : `${step.id} (${step.type})`
  return notes.length > 0 ? `${label} — ${notes.join('; ')}` : label
}

/** Enforce row and column budgets after a step. */
function enforceLimits(dataset: Dataset, limits: Limits): void {
  if (dataset.rows.length > limits.maxRows) {
    throw new ExplorationError(
      `output of ${dataset.rows.length} rows exceeds the ${limits.maxRows}-row limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  if (dataset.columns.length > limits.maxColumns) {
    throw new ExplorationError(
      `output of ${dataset.columns.length} columns exceeds the ${limits.maxColumns}-column limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
}

/** Normalize any thrown value to a structured exploration error. */
function asExplorationError(error: unknown): ExplorationError {
  if (error instanceof ExplorationError) return error
  return new ExplorationError(error instanceof Error ? error.message : String(error), { code: 'DATA_ERROR' })
}
