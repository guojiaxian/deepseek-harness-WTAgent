/**
 * Step processor dispatch.
 *
 * Each processor module owns a `validate(config)` and a `run(...)` entry point;
 * this module resolves a step's `type` to its processor. Unknown step types raise
 * `UNKNOWN_STEP` so a declarative pipeline can never silently skip a step it does
 * not understand.
 * @module @deepseek-ai/dsh-consistency
 */

import { ConsistencyError } from '../errors.ts'
import type { Limits, PipelineStep, ProcessingInput, ProcessorResult, Workflow } from '../types.ts'
import * as convert from './convert.ts'
import * as cut from './cut.ts'
import * as exclude from './exclude.ts'
import * as ingest from './ingest.ts'
import * as plot from './plot.ts'
import * as rename from './rename.ts'

/**
 * Validate one pipeline step's config against its processor.
 * @param step - pipeline step to validate.
 * @returns the same step with a validated config.
 */
export function validateStep(step: PipelineStep): PipelineStep {
  switch (step.type) {
    case 'ingest':
      return { ...step, config: ingest.validate(step.config) }
    case 'rename':
      return { ...step, config: rename.validate(step.config) }
    case 'convert':
      return { ...step, config: convert.validate(step.config) }
    case 'cut':
      return { ...step, config: cut.validate(step.config) }
    case 'plot':
      return { ...step, config: plot.validate(step.config) }
    case 'exclude':
      return { ...step, config: exclude.validate(step.config) }
    default:
      return assertNever(step.type)
  }
}

/**
 * Run one pipeline step against its input workflow.
 * @param step - validated pipeline step.
 * @param workflow - current workflow (ignored by `ingest`).
 * @param input - raw input (used only by `ingest`).
 * @param limits - resource limits for ingest.
 * @returns the processor result.
 */
export function runStep(step: PipelineStep, workflow: Workflow, input: ProcessingInput, limits: Limits): ProcessorResult {
  switch (step.type) {
    case 'ingest':
      return ingest.run(input, step.config as Parameters<typeof ingest.run>[1], limits)
    case 'rename':
      return rename.run(workflow, step.config as Parameters<typeof rename.run>[1])
    case 'convert':
      return convert.run(workflow, step.config as Parameters<typeof convert.run>[1])
    case 'cut':
      return cut.run(workflow, step.config as Parameters<typeof cut.run>[1])
    case 'plot':
      return plot.run(workflow, step.config as Parameters<typeof plot.run>[1])
    case 'exclude':
      return exclude.run(workflow, step.config as Parameters<typeof exclude.run>[1])
    default:
      return assertNever(step.type)
  }
}

/** Unreachable for the closed {@link StepType} union; kept as a runtime guard. */
function assertNever(value: never): never {
  void value
  throw new ConsistencyError('unknown step type', { code: 'UNKNOWN_STEP' })
}
