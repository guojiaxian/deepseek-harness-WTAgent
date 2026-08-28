/**
 * Step processor dispatch.
 *
 * Each processor module owns a `validate(config)` and a `run(...)` entry point;
 * this module resolves a step's `type` to its processor. Unknown step types
 * raise `UNKNOWN_STEP` so a declarative pipeline can never silently skip a step
 * it does not understand.
 * @module @deepseek-ai/dsh-paper
 */

import { PaperError } from '../errors.ts'
import type { Limits, PipelineStep, Paper, ProcessingInput, ProcessorResult } from '../types.ts'
import * as cite from './cite.ts'
import * as format from './format.ts'
import * as ingest from './ingest.ts'
import * as revise from './revise.ts'

/**
 * Validate one pipeline step's config against its processor.
 * @param step - pipeline step to validate.
 * @returns the same step with a validated config.
 */
export function validateStep(step: PipelineStep): PipelineStep {
  switch (step.type) {
    case 'ingest':
      return { ...step, config: ingest.validate(step.config) }
    case 'revise':
      return { ...step, config: revise.validate(step.config) }
    case 'format':
      return { ...step, config: format.validate(step.config) }
    case 'cite':
      return { ...step, config: cite.validate(step.config) }
    default:
      return assertNever(step.type)
  }
}

/**
 * Run one pipeline step against its input.
 * @param step - validated pipeline step.
 * @param paper - current paper state (ignored by `ingest`).
 * @param input - raw input (used only by `ingest`).
 * @param limits - resource limits for ingest and step budgets.
 * @returns the processor result.
 */
export function runStep(step: PipelineStep, paper: Paper, input: ProcessingInput, limits: Limits): ProcessorResult {
  switch (step.type) {
    case 'ingest':
      return ingest.run(input, step.config as Parameters<typeof ingest.run>[1], limits)
    case 'revise':
      return revise.run(paper, step.config as Parameters<typeof revise.run>[1], limits)
    case 'format':
      return format.run(paper, step.config as Parameters<typeof format.run>[1], limits)
    case 'cite':
      return cite.run(paper, step.config as Parameters<typeof cite.run>[1], limits)
    default:
      return assertNever(step.type)
  }
}

/** Unreachable for the closed {@link StepType} union; kept as a runtime guard. */
function assertNever(value: never): never {
  void value
  throw new PaperError('unknown step type', { code: 'UNKNOWN_STEP' })
}
