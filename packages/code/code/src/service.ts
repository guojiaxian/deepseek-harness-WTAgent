/**
 * Code analysis service.
 *
 * Owns the Service role of the code-analysis capability seam: a thin, configurable
 * wrapper over the engine's pure `analyze` function. Resource limits and default
 * static-check toggles come from validated {@link CodeConfig} fields (deployment
 * tunables, never hardcoded inside the analyzers). The same pure functions are
 * also exported for hosts that want to run an analysis without a Cordis runtime.
 * @module @deepseek-ai/dsh-code
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { analyze as runAnalyze, DEFAULT_LIMITS, resolveLimits } from './report.ts'
import type { CodeAnalysis, CodeConfig, OperationalLimits, StaticCheckConfig } from './types.ts'

/** Schemastery config schema shared by the service and the plugin entry point. */
export const CodeConfigSchema: z<CodeConfig> = z.object({
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
 * Service exposing the engine's analysis behind `ctx.code`.
 */
export class CodeService extends Service {
  static Config: Schema<CodeConfig> = CodeConfigSchema

  private readonly limits: Required<OperationalLimits>
  private readonly defaultChecks: StaticCheckConfig | undefined

  /**
   * @param ctx - registrant context.
   * @param config - service configuration; defaults apply when fields are omitted.
   */
  constructor(ctx: Context, config: CodeConfig = {}) {
    super(ctx, 'code')
    this.limits = resolveLimits({
      ...(config.maxCodeBytes !== undefined ? { maxCodeBytes: config.maxCodeBytes } : {}),
      ...(config.maxFunctions !== undefined ? { maxFunctions: config.maxFunctions } : {}),
      ...(config.maxFindings !== undefined ? { maxFindings: config.maxFindings } : {}),
    })
    this.defaultChecks = config.defaultChecks
  }

  /**
   * Analyze a source file end to end, using the service's configured limits and
   * default check toggles unless the caller overrides them.
   * @param fileName - optional file name used for language detection.
   * @param source - source text to analyze.
   * @param options - optional per-call overrides for limits and check toggles.
   * @returns the full analysis record.
   */
  analyze(
    fileName: string | undefined,
    source: string,
    options?: { readonly limits?: OperationalLimits; readonly checks?: StaticCheckConfig },
  ): CodeAnalysis {
    const overrides: { limits?: OperationalLimits; checks?: StaticCheckConfig } = {}
    if (options?.limits !== undefined) overrides.limits = { ...this.limits, ...options.limits }
    const checks = options?.checks ?? this.defaultChecks
    if (checks !== undefined) overrides.checks = checks
    return runAnalyze(fileName, source, overrides)
  }
}
