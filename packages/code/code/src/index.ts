/**
 * Code analysis plugin.
 *
 * Mounts the {@link CodeService} on `ctx.code`. The engine's pure functions are
 * re-exported so hosts and the model-facing tool package share one implementation.
 * Named exports only (no default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-code
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CodeService } from './service.ts'
import { DEFAULT_LIMITS } from './report.ts'
import type { CodeConfig } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'code'

/** Services required by the code plugin. */
export const inject: string[] = []

/** Plugin config schema shared with the service; defaults mirror the engine limits. */
export const Config: z<CodeConfig> = z.object({
  maxCodeBytes: z.number().default(DEFAULT_LIMITS.maxCodeBytes),
  maxFunctions: z.number().default(DEFAULT_LIMITS.maxFunctions),
  maxFindings: z.number().default(DEFAULT_LIMITS.maxFindings),
  defaultChecks: z.object({
    dangerous: z.boolean(),
    secrets: z.boolean(),
    todos: z.boolean(),
    debugResidue: z.boolean(),
    emptyCatch: z.boolean(),
    broadCatch: z.boolean(),
  }),
})

/**
 * Mount the code analysis service.
 * @param ctx - registrant context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: CodeConfig = {}): void {
  ctx.plugin(CodeService, config)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    code: CodeService
  }
}

export * from './types.ts'
export * from './errors.ts'
export * from './lang.ts'
export * from './metrics.ts'
export * from './complexity.ts'
export * from './checks.ts'
export * from './report.ts'
export * from './service.ts'
