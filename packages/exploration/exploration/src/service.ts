/**
 * Exploration data processing service.
 *
 * Owns the Service role of the exploration capability seam: a configurable
 * registry of named pipelines plus a direct pipeline runner. Resource limits
 * come from validated {@link ExplorationConfig} fields (deployment tunables,
 * never hardcoded inside the processors). The same pure pipeline functions
 * are also exported for hosts that want to run a one-off pipeline without a
 * Cordis runtime.
 * @module @deepseek-ai/dsh-exploration
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { ExplorationError } from './errors.ts'
import { runPipeline, validatePipeline } from './pipeline.ts'
import type { ExplorationConfig, Limits, Pipeline, ProcessingInput, RunRecord } from './types.ts'

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ROWS = 50_000
const DEFAULT_MAX_COLUMNS = 1024
const DEFAULT_MAX_ANOMALY_RECORDS = 500

/** Schemastery config schema shared by the service and the plugin entry point. */
export const ExplorationConfigSchema: z<ExplorationConfig> = z.object({
  maxInputBytes: z.number().default(DEFAULT_MAX_INPUT_BYTES),
  maxRows: z.number().default(DEFAULT_MAX_ROWS),
  maxColumns: z.number().default(DEFAULT_MAX_COLUMNS),
  maxAnomalyRecords: z.number().default(DEFAULT_MAX_ANOMALY_RECORDS),
  pipelines: z.array(z.any()).default([]),
})

/**
 * Registry and runner for exploration data processing pipelines.
 */
export class ExplorationService extends Service {
  static Config: Schema<ExplorationConfig> = ExplorationConfigSchema

  private readonly limits: Limits
  private readonly pipelines = new Map<string, Pipeline>()

  /**
   * @param ctx - registrant context.
   * @param config - service configuration; defaults apply when fields are omitted.
   * Pipelines declared under `pipelines` are validated and registered on mount.
   */
  constructor(ctx: Context, config: ExplorationConfig = {}) {
    super(ctx, 'exploration')
    this.limits = {
      maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      maxRows: config.maxRows ?? DEFAULT_MAX_ROWS,
      maxColumns: config.maxColumns ?? DEFAULT_MAX_COLUMNS,
      maxAnomalyRecords: config.maxAnomalyRecords ?? DEFAULT_MAX_ANOMALY_RECORDS,
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
      throw new ExplorationError(`a pipeline named "${validated.name}" is already registered`, {
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
   * Run a registered pipeline by name over raw input.
   * @param name - registered pipeline name.
   * @param input - raw input handed to the ingest step.
   * @returns the traceability run record.
   */
  run(name: string, input: ProcessingInput): RunRecord {
    const pipeline = this.pipelines.get(name)
    if (pipeline === undefined) {
      throw new ExplorationError(`unknown pipeline "${name}"`, { code: 'UNKNOWN_PIPELINE' })
    }
    return runPipeline(input, pipeline, this.limits, randomUUID())
  }

  /**
   * Run a one-off pipeline definition over raw input.
   * @param input - raw input handed to the ingest step.
   * @param pipeline - raw pipeline definition, validated before running.
   * @returns the traceability run record.
   */
  runPipeline(input: ProcessingInput, pipeline: unknown): RunRecord {
    return runPipeline(input, validatePipeline(pipeline), this.limits, randomUUID())
  }
}
