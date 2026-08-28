/**
 * Consistency-test engineering plugin.
 *
 * Mounts the {@link ConsistencyService} on `ctx.consistency`; pipelines declared
 * in the plugin config are validated and registered by the service on mount. The
 * engine's pure functions and types are re-exported so hosts and the model-facing
 * tool package share one implementation. Named exports only (no default),
 * preserving loader injection metadata.
 * @module @deepseek-ai/dsh-consistency
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ConsistencyService } from './service.ts'
import type { ConsistencyConfig } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'consistency'

/** Services required by the consistency plugin. */
export const inject: string[] = []

/** Plugin config schema shared with the service; defaults mirror the service's limits. */
export const Config: z<ConsistencyConfig> = z.object({
  maxInputBytes: z.number().default(8 * 1024 * 1024),
  maxStations: z.number().default(10_000),
  maxSeedFiles: z.number().default(100_000),
  maxArrivals: z.number().default(10_000),
  pipelines: z.array(z.any()).default([]),
})

/**
 * Mount the consistency service; configured pipelines are registered by the
 * service itself, so no synchronous `ctx.consistency` access is needed here.
 * @param ctx - registrant context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: ConsistencyConfig = {}): void {
  ctx.plugin(ConsistencyService, config)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    consistency: ConsistencyService
  }
}

export * from './types.ts'
export * from './errors.ts'
export * from './checksum.ts'
export * from './pipeline.ts'
export * from './service.ts'
export * from './processors/index.ts'
export * as ingest from './processors/ingest.ts'
export * as rename from './processors/rename.ts'
export * as convert from './processors/convert.ts'
export * as cut from './processors/cut.ts'
export * as plot from './processors/plot.ts'
export * as exclude from './processors/exclude.ts'
