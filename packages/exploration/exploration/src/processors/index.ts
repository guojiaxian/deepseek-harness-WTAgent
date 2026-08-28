/**
 * Step processor dispatch.
 *
 * Each processor module owns a `validate(config)` and a `run(...)` entry
 * point; this module resolves a step's `type` to its processor. Unknown step
 * types raise `UNKNOWN_STEP` so a declarative pipeline can never silently
 * skip a step it does not understand.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from '../errors.ts'
import type { Dataset, Limits, PipelineStep, ProcessingInput, ProcessorResult } from '../types.ts'
import * as clean from './clean.ts'
import * as convert from './convert.ts'
import * as detect from './detect.ts'
import * as extract from './extract.ts'
import * as ingest from './ingest.ts'
import * as profile from './profile.ts'

/**
 * Validate one pipeline step's config against its processor.
 * @param step - pipeline step to validate.
 * @returns the same step with a validated config.
 */
export function validateStep(step: PipelineStep): PipelineStep {
  switch (step.type) {
    case 'ingest':
      return { ...step, config: ingest.validate(step.config) }
    case 'clean':
      return { ...step, config: clean.validate(step.config) }
    case 'convert':
      return { ...step, config: convert.validate(step.config) }
    case 'extract':
      return { ...step, config: extract.validate(step.config) }
    case 'detect':
      return { ...step, config: detect.validate(step.config) }
    case 'profile':
      return { ...step, config: profile.validate(step.config) }
    default:
      return assertNever(step.type)
  }
}

/**
 * Run one pipeline step against its input.
 * @param step - validated pipeline step.
 * @param dataset - current dataset (ignored by `ingest`).
 * @param input - raw input (used only by `ingest`).
 * @param limits - resource limits for ingest and detect.
 * @returns the processor result.
 */
export function runStep(step: PipelineStep, dataset: Dataset, input: ProcessingInput, limits: Limits): ProcessorResult {
  switch (step.type) {
    case 'ingest':
      return ingest.run(input, step.config as Parameters<typeof ingest.run>[1], limits)
    case 'clean':
      return clean.run(dataset, step.config as Parameters<typeof clean.run>[1])
    case 'convert':
      return convert.run(dataset, step.config as Parameters<typeof convert.run>[1])
    case 'extract':
      return extract.run(dataset, step.config as Parameters<typeof extract.run>[1])
    case 'detect':
      return detect.run(dataset, step.config as Parameters<typeof detect.run>[1], limits)
    case 'profile':
      return profile.run(dataset, step.config as Parameters<typeof profile.run>[1])
    default:
      return assertNever(step.type)
  }
}

/** Unreachable for the closed {@link StepType} union; kept as a runtime guard. */
function assertNever(value: never): never {
  void value
  throw new ExplorationError('unknown step type', { code: 'UNKNOWN_STEP' })
}
