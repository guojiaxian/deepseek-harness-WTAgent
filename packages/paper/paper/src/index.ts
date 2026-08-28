/**
 * Academic paper-writing plugin.
 *
 * Mounts the {@link PaperService} on `ctx.paper`; pipelines declared in the
 * plugin config are validated and registered by the service on mount. The
 * engine's pure functions and types are re-exported so hosts and the
 * model-facing tool package share one implementation. Named exports only (no
 * default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-paper
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PaperService } from './service.ts'
import type { PaperConfig } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'paper'

/** Services required by the paper plugin. */
export const inject: string[] = []

/** Plugin config schema shared with the service; defaults mirror the service's limits. */
export const Config: z<PaperConfig> = z.object({
  maxInputBytes: z.number().default(8 * 1024 * 1024),
  maxSections: z.number().default(200),
  maxParagraphs: z.number().default(200),
  maxCitations: z.number().default(500),
  maxFindings: z.number().default(200),
  maxOutputBytes: z.number().default(16 * 1024 * 1024),
  pipelines: z.array(z.any()).default([]),
})

/**
 * Mount the paper service; configured pipelines are registered by the service
 * itself, so no synchronous `ctx.paper` access is needed here.
 * @param ctx - registrant context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: PaperConfig = {}): void {
  ctx.plugin(PaperService, config)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paper: PaperService
  }
}

export * from './types.ts'
export * from './errors.ts'
export * from './checksum.ts'
export * from './manuscript.ts'
export * from './pipeline.ts'
export * from './service.ts'
export * from './citation/index.ts'
export * from './processors/index.ts'
export * from './document/index.ts'
export * as ingest from './processors/ingest.ts'
export * as revise from './processors/revise.ts'
export * as format from './processors/format.ts'
export * as cite from './processors/cite.ts'
