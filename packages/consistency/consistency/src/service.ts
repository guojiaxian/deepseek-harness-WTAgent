/**
 * Consistency-test engineering service.
 *
 * Owns the Service role of the consistency capability seam: a configurable
 * registry of named pipelines plus a direct pipeline runner. Resource limits
 * come from validated {@link ConsistencyConfig} fields (deployment tunables,
 * never hardcoded inside the processors). The same pure pipeline functions are
 * also exported for hosts that want to run a one-off pipeline without a Cordis
 * runtime.
 * @module @deepseek-ai/dsh-consistency
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { ConsistencyError } from './errors.ts'
import { runPipeline, validatePipeline } from './pipeline.ts'
import type { ConsistencyConfig, Limits, Pipeline, ProcessingInput, RunRecord } from './types.ts'

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_STATIONS = 10_000
const DEFAULT_MAX_SEED_FILES = 100_000
const DEFAULT_MAX_ARRIVALS = 10_000

/** Schemastery config schema shared by the service and the plugin entry point. */
export const ConsistencyConfigSchema: z<ConsistencyConfig> = z.object({
  maxInputBytes: z.number().default(DEFAULT_MAX_INPUT_BYTES),
  maxStations: z.number().default(DEFAULT_MAX_STATIONS),
  maxSeedFiles: z.number().default(DEFAULT_MAX_SEED_FILES),
  maxArrivals: z.number().default(DEFAULT_MAX_ARRIVALS),
  pipelines: z.array(z.any()).default([]),
})

/**
 * Registry and runner for consistency-test engineering pipelines.
 */
export class ConsistencyService extends Service {
  static Config: Schema<ConsistencyConfig> = ConsistencyConfigSchema

  private readonly limits: Limits
  private readonly pipelines = new Map<string, Pipeline>()

  /**
   * @param ctx - registrant context.
   * @param config - service configuration; defaults apply when fields are omitted.
   * Pipelines declared under `pipelines` are validated and registered on mount.
   */
  constructor(ctx: Context, config: ConsistencyConfig = {}) {
    super(ctx, 'consistency')
    this.limits = {
      maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      maxStations: config.maxStations ?? DEFAULT_MAX_STATIONS,
      maxSeedFiles: config.maxSeedFiles ?? DEFAULT_MAX_SEED_FILES,
      maxArrivals: config.maxArrivals ?? DEFAULT_MAX_ARRIVALS,
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
      throw new ConsistencyError(`a pipeline named "${validated.name}" is already registered`, {
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
      throw new ConsistencyError(`unknown pipeline "${name}"`, { code: 'UNKNOWN_PIPELINE' })
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
