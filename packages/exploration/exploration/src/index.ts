/**
 * Exploration data processing plugin.
 *
 * Mounts the {@link ExplorationService} on `ctx.exploration`; pipelines declared
 * in the plugin config are validated and registered by the service on mount.
 * The engine's pure functions and types are re-exported so hosts and the
 * model-facing tool package share one implementation. Named exports only (no
 * default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-exploration
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ExplorationService } from './service.ts'
import type { ExplorationConfig } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'exploration'

/** Services required by the exploration plugin. */
export const inject: string[] = []

/** Plugin config schema shared with the service; defaults mirror the service's limits. */
export const Config: z<ExplorationConfig> = z.object({
  maxInputBytes: z.number().default(8 * 1024 * 1024),
  maxRows: z.number().default(50_000),
  maxColumns: z.number().default(1024),
  maxAnomalyRecords: z.number().default(500),
  pipelines: z.array(z.any()).default([]),
})

/**
 * Mount the exploration service; configured pipelines are registered by the
 * service itself, so no synchronous `ctx.exploration` access is needed here.
 * @param ctx - registrant context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: ExplorationConfig = {}): void {
  ctx.plugin(ExplorationService, config)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    exploration: ExplorationService
  }
}

export * from './types.ts'
export * from './errors.ts'
export * from './checksum.ts'
export * from './stats.ts'
export * from './units.ts'
export * from './dataset.ts'
export * from './pipeline.ts'
export * from './service.ts'
export * from './format/index.ts'
export * from './format/csv.ts'
export * from './format/json.ts'
export * from './format/segy.ts'
export * from './format/ebcdic.ts'
export * from './render/colormap.ts'
export * from './render/png.ts'
export * from './render/section.ts'
export * from './render/svg.ts'
export * from './processors/index.ts'
export * as ingest from './processors/ingest.ts'
export * as clean from './processors/clean.ts'
export * as convert from './processors/convert.ts'
export * as extract from './processors/extract.ts'
export * as detect from './processors/detect.ts'
export * as profile from './processors/profile.ts'
