/**
 * Pipeline validation and execution.
 *
 * A pipeline is a named, ordered list of steps whose first step must be
 * `ingest`. Validation fails loud on empty pipelines, duplicate step ids, a
 * non-ingest first step, or an invalid step config. Execution records a
 * per-step and per-run traceability record; a failing step is captured on the
 * run record without aborting the caller, and the output falls back to the
 * last completed workflow. The flowing state is a {@link Workflow}; the actual
 * file I/O stays with the agent's tools guided by the engine's outputs.
 * @module @deepseek-ai/dsh-consistency
 */

import { checksumBytes, checksumWorkflow } from './checksum.ts'
import { ConsistencyError } from './errors.ts'
import { runStep, validateStep } from './processors/index.ts'
import type {
  InputSummary, Limits, Pipeline, PipelineStep, ProcessingInput, RunError, RunRecord,
  StepRecord, StepType, Workflow, WorkflowSummary,
} from './types.ts'
import { asArray, asEnum, asString, checkKeys, checkObject } from './processors/validate.ts'

const STEP_TYPES: readonly StepType[] = ['ingest', 'rename', 'convert', 'cut', 'plot', 'exclude']

const EMPTY_WORKFLOW: Workflow = {
  project: '', baseDir: '.', inputRoot: '', outputSacRoot: '', outputCutRoot: '', outputFigRoot: '',
  converterC: null, converterE: null, channel: 'Z', cutBefore: 1, cutAfter: 2,
  timezoneOffsetHours: 8, batchSize: 40, stations: [], arrivals: [], plotBatches: [], exclusions: [], meta: {},
}

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
    throw new ConsistencyError('pipeline.steps must not be empty', { code: 'VALIDATION_ERROR' })
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
      throw new ConsistencyError(`duplicate step id "${step.id}"`, { code: 'VALIDATION_ERROR' })
    }
    ids.add(step.id)
  }
  if ((steps[0] as PipelineStep).type !== 'ingest') {
    throw new ConsistencyError('pipeline must start with an ingest step', { code: 'VALIDATION_ERROR' })
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
    bytes: inputBytes.byteLength,
    checksum: checksumBytes(inputBytes),
  }
  const stepRecords: StepRecord[] = []
  let status: 'completed' | 'failed' = 'completed'
  let runError: RunError | undefined
  let workflow: Workflow = EMPTY_WORKFLOW
  let lastGood: Workflow = EMPTY_WORKFLOW
  let provenance: string[] = []

  for (const step of pipeline.steps) {
    const stepStartedAt = new Date().toISOString()
    const isIngest = step.type === 'ingest'
    const inputHash = isIngest ? inputSummary.checksum : checksumWorkflow(workflow)
    let finishedAt: string
    let durationMs: number
    let record: StepRecord
    try {
      const result = runStep(step, workflow, input, limits)
      const output = withProvenance(result.workflow, provenance, step, result.notes)
      enforceLimits(output, limits)
      finishedAt = new Date().toISOString()
      durationMs = Date.parse(finishedAt) - Date.parse(stepStartedAt)
      workflow = output
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
      const err = asConsistencyError(error)
      const fallback = isIngest ? EMPTY_WORKFLOW : workflow
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
  const output = status === 'failed' ? lastGood : workflow
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

/** Total seed file count across the workflow's stations. */
function seedCount(workflow: Workflow): number {
  return workflow.stations.reduce((sum, station) => sum + station.seedFiles.length, 0)
}

/** Canonical output summary of a workflow. */
function summarize(workflow: Workflow): WorkflowSummary {
  return {
    stationCount: workflow.stations.length,
    seedFileCount: seedCount(workflow),
    arrivalCount: workflow.arrivals.length,
    plotBatchCount: workflow.plotBatches.length,
    checksum: checksumWorkflow(workflow),
  }
}

/** Rebuild workflow meta with the accumulated provenance appended for this step. */
function withProvenance(workflow: Workflow, provenance: readonly string[], step: PipelineStep, notes: readonly string[]): Workflow {
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(workflow.meta)) {
    /* v8 ignore next 1 -- every processor strips its own 'provenance' meta before withProvenance runs, so the guard never fires */
    if (key !== 'provenance') meta[key] = workflow.meta[key]
  }
  meta.provenance = [...provenance, provenanceLine(step, notes)]
  return { ...workflow, meta }
}

/** One-line provenance entry for a step. */
function provenanceLine(step: PipelineStep, notes: readonly string[]): string {
  const label = step.description !== undefined
    ? `${step.id} (${step.type}: ${step.description})`
    : `${step.id} (${step.type})`
  return notes.length > 0 ? `${label} — ${notes.join('; ')}` : label
}

/** Enforce station, seed file, and arrival budgets after a step. */
function enforceLimits(workflow: Workflow, limits: Limits): void {
  if (workflow.stations.length > limits.maxStations) {
    throw new ConsistencyError(
      `workflow has ${workflow.stations.length} stations exceeding the ${limits.maxStations}-station limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  if (seedCount(workflow) > limits.maxSeedFiles) {
    throw new ConsistencyError(
      `workflow has ${seedCount(workflow)} seed files exceeding the ${limits.maxSeedFiles}-seed limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  if (workflow.arrivals.length > limits.maxArrivals) {
    throw new ConsistencyError(
      `workflow has ${workflow.arrivals.length} arrivals exceeding the ${limits.maxArrivals}-arrival limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
}

/** Normalize any thrown value to a structured consistency error. */
function asConsistencyError(error: unknown): ConsistencyError {
  if (error instanceof ConsistencyError) return error
  return new ConsistencyError(error instanceof Error ? error.message : String(error), { code: 'DATA_ERROR' })
}
