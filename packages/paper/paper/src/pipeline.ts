/**
 * Pipeline validation and execution.
 *
 * A pipeline is a named, ordered list of steps whose first step must be
 * `ingest`. Validation fails loud on empty pipelines, duplicate step ids, a
 * non-ingest first step, or an invalid step config. Execution records a
 * per-step and per-run traceability record; resource budgets are enforced by
 * the ingest processor. A failing step is captured on the run record without
 * aborting the caller, and the output falls back to the last completed paper.
 * @module @deepseek-ai/dsh-paper
 */

import { checksumBytes, checksumPaper } from './checksum.ts'
import { PaperError } from './errors.ts'
import { runStep, validateStep } from './processors/index.ts'
import { asArray, asEnum, asString, checkKeys, checkObject } from './processors/validate.ts'
import type {
  InputSummary, Limits, Paper, PaperSummary, Pipeline, PipelineStep, ProcessingInput, RunError, RunRecord, StepRecord, StepType,
} from './types.ts'

const STEP_TYPES: readonly StepType[] = ['ingest', 'revise', 'format', 'cite']

const EMPTY_PAPER: Paper = { sections: [], citations: [], meta: {} }

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
    throw new PaperError('pipeline.steps must not be empty', { code: 'VALIDATION_ERROR' })
  }
  const steps: PipelineStep[] = rawSteps.map((entry, i) => {
    const s = checkObject(entry, `pipeline.steps[${i}]`)
    checkKeys(s, ['id', 'type', 'config', 'description'], `pipeline.steps[${i}]`)
    const id = asString(s.id, `pipeline.steps[${i}].id`)
    const type = asEnum(s.type, STEP_TYPES, `pipeline.steps[${i}].type`)
    const step: PipelineStep = {
      id,
      type,
      config: s.config,
      ...(s.description !== undefined ? { description: asString(s.description, `pipeline.steps[${i}].description`) } : {}),
    }
    return step
  })
  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new PaperError(`duplicate step id "${step.id}"`, { code: 'VALIDATION_ERROR' })
    }
    ids.add(step.id)
  }
  if ((steps[0] as PipelineStep).type !== 'ingest') {
    throw new PaperError('pipeline must start with an ingest step', { code: 'VALIDATION_ERROR' })
  }
  const pipeline: Pipeline = {
    name,
    steps: steps.map(validateStep),
    ...(obj.description !== undefined ? { description: asString(obj.description, 'pipeline.description') } : {}),
  }
  return pipeline
}

/**
 * Execute a validated pipeline over raw input.
 * @param input - raw input consumed by the ingest step.
 * @param pipeline - validated pipeline.
 * @param limits - resource limits applied by the ingest processor.
    * @param runId - run identifier recorded on the result.
 * @returns the full traceability run record.
 */
export function runPipeline(input: ProcessingInput, pipeline: Pipeline, limits: Limits, runId: string): RunRecord {
  const startedAt = new Date().toISOString()
  const inputBytes = toBytes(input.data)
  const inputSummary: InputSummary = {
    format: input.format,
    bytes: inputBytes.byteLength,
    characterCount: input.data.length,
    checksum: checksumBytes(inputBytes),
  }
  const stepRecords: StepRecord[] = []
  let status: 'completed' | 'failed' = 'completed'
  let runError: RunError | undefined
  let paper: Paper = EMPTY_PAPER
  let lastGood: Paper = EMPTY_PAPER
  let provenance: string[] = []

  for (const step of pipeline.steps) {
    const stepStartedAt = new Date().toISOString()
    const isIngest = step.type === 'ingest'
    const inputHash = isIngest ? inputSummary.checksum : checksumPaper(paper)
    let finishedAt: string
    let durationMs: number
    let record: StepRecord
    try {
      const result = runStep(step, paper, input, limits)
      const output = withProvenance(result.paper, provenance, step, result.notes)
      finishedAt = new Date().toISOString()
      durationMs = Date.parse(finishedAt) - Date.parse(stepStartedAt)
      paper = output
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
      const err = asPaperError(error)
      const fallback = isIngest ? EMPTY_PAPER : paper
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
  const output = status === 'failed' ? lastGood : paper
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

/** Canonical output summary of a paper. */
function summarize(paper: Paper): PaperSummary {
  return {
    sectionCount: paper.sections.length,
    citationCount: paper.citations.length,
    characterCount: characterCount(paper),
    checksum: checksumPaper(paper),
  }
}

/** Total characters across title, abstract, sections, and citations. */
function characterCount(paper: Paper): number {
  let total = (paper.title ?? '').length + (paper.abstract ?? '').length
  for (const section of paper.sections) {
    total += (section.heading ?? '').length
    for (const paragraph of section.paragraphs) total += paragraph.length
  }
  for (const citation of paper.citations) total += citation.raw.length
  return total
}

/** Rebuild paper meta with the accumulated provenance appended for this step. */
function withProvenance(paper: Paper, provenance: readonly string[], step: PipelineStep, notes: readonly string[]): Paper {
  const meta: Record<string, unknown> = { ...paper.meta }
  meta.provenance = [...provenance, provenanceLine(step, notes)]
  return { ...paper, meta }
}

/** One-line provenance entry for a step. */
function provenanceLine(step: PipelineStep, notes: readonly string[]): string {
  const label = step.description !== undefined
    ? `${step.id} (${step.type}: ${step.description})`
    : `${step.id} (${step.type})`
  return `${label} — ${notes.join('; ')}`
}

/** Normalize any thrown value to a structured paper error. */
function asPaperError(error: unknown): PaperError {
  if (error instanceof PaperError) return error
  return new PaperError(error instanceof Error ? error.message : String(error), { code: 'DATA_ERROR' })
}
