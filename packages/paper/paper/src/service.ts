/**
 * Academic paper-writing service.
 *
 * Owns the Service role of the paper capability seam: a configurable registry
 * of named pipelines plus a direct pipeline runner. Resource limits come from
 * validated {@link PaperConfig} fields (deployment tunables, never hardcoded
 * inside the processors). The same pure pipeline functions are also exported
 * for hosts that want to run a one-off pipeline without a Cordis runtime.
 * @module @deepseek-ai/dsh-paper
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { PaperError } from './errors.ts'
import { runPipeline, validatePipeline } from './pipeline.ts'
import type { Limits, PaperConfig, Pipeline, ProcessingInput, RunRecord } from './types.ts'

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_SECTIONS = 200
const DEFAULT_MAX_PARAGRAPHS = 200
const DEFAULT_MAX_CITATIONS = 500
const DEFAULT_MAX_FINDINGS = 200
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Schemastery config schema shared by the service and the plugin entry point. */
export const PaperConfigSchema: z<PaperConfig> = z.object({
  maxInputBytes: z.number().default(DEFAULT_MAX_INPUT_BYTES),
  maxSections: z.number().default(DEFAULT_MAX_SECTIONS),
  maxParagraphs: z.number().default(DEFAULT_MAX_PARAGRAPHS),
  maxCitations: z.number().default(DEFAULT_MAX_CITATIONS),
  maxFindings: z.number().default(DEFAULT_MAX_FINDINGS),
  maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
  pipelines: z.array(z.any()).default([]),
})

/**
 * Registry and runner for academic paper-writing pipelines.
 */
export class PaperService extends Service {
  static Config: Schema<PaperConfig> = PaperConfigSchema

  private readonly limits: Limits
  private readonly pipelines = new Map<string, Pipeline>()

  /**
   * @param ctx - registrant context.
   * @param config - service configuration; defaults apply when fields are omitted.
   * Pipelines declared under `pipelines` are validated and registered on mount.
   */
  constructor(ctx: Context, config: PaperConfig = {}) {
    super(ctx, 'paper')
    this.limits = {
      maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      maxSections: config.maxSections ?? DEFAULT_MAX_SECTIONS,
      maxParagraphs: config.maxParagraphs ?? DEFAULT_MAX_PARAGRAPHS,
      maxCitations: config.maxCitations ?? DEFAULT_MAX_CITATIONS,
      maxFindings: config.maxFindings ?? DEFAULT_MAX_FINDINGS,
      maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    }
    for (const pipeline of config.pipelines ?? []) {
      this.registerPipeline(pipeline)
    }
  }

  /**
   * Register a named pipeline; duplicate names fail loud.
   * @param pipeline - raw pipeline definition to validate and register.
   */
  registerPipeline(pipeline: unknown): void {
    const validated = validatePipeline(pipeline)
    if (this.pipelines.has(validated.name)) {
      throw new PaperError(`a pipeline named "${validated.name}" is already registered`, {
        code: 'VALIDATION_ERROR',
      })
    }
    this.pipelines.set(validated.name, validated)
  }

  /**
   * List the registered pipelines in registration order.
   * @returns the registered pipelines.
   */
  listPipelines(): readonly Pipeline[] {
    return [...this.pipelines.values()]
  }

  /**
   * Run a registered pipeline by name over raw manuscript input.
   * @param name - registered pipeline name.
   * @param input - raw input handed to the ingest step.
   * @returns the traceability run record.
   */
  run(name: string, input: ProcessingInput): RunRecord {
    const pipeline = this.pipelines.get(name)
    if (pipeline === undefined) {
      throw new PaperError(`unknown pipeline "${name}"`, { code: 'UNKNOWN_PIPELINE' })
    }
    return runPipeline(input, pipeline, this.limits, randomUUID())
  }

  /**
   * Run a one-off pipeline definition over raw manuscript input.
   * @param input - raw input handed to the ingest step.
   * @param pipeline - raw pipeline definition, validated before running.
   * @returns the traceability run record.
   */
  runPipeline(input: ProcessingInput, pipeline: unknown): RunRecord {
    return runPipeline(input, validatePipeline(pipeline), this.limits, randomUUID())
  }
}
