/**
 * Model-facing `code_*` tools over the `@deepseek-ai/dsh-code` engine's pure
 * analyzers. `code_analyze` returns the full analysis record (language, metrics,
 * cyclomatic complexity, quality score, findings), while `code_check` returns a
 * findings-focused view for quality and security scanning. Every tool validates
 * its resource limits through the engine's own config schema and returns compact
 * JSON. Named exports only (no default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-tool-code
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  analyze, detectLanguage, runChecks, CodeError, DEFAULT_LIMITS,
} from '@deepseek-ai/dsh-code'
import type { CodeAnalysis, OperationalLimits, StaticCheckConfig } from '@deepseek-ai/dsh-code'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-code'

/** Services required by the tool plugin. */
export const inject = ['tools']

/** Resource-limit configuration of the model-facing code tools. */
export interface Config {
  /** Maximum accepted source byte length; default 1 MiB. */
  maxCodeBytes?: number
  /** Maximum function-complexity records kept; default 1000. */
  maxFunctions?: number
  /** Maximum findings kept per tool call; default 100. */
  maxFindings?: number
  /** Static-check rule toggles. */
  defaultChecks?: StaticCheckConfig
}

/** Schemastery config for the tool consumer. */
export const Config: z<Config> = z.object({
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

/** Materialize limits even when `apply` is called directly outside Loader normalization. */
function resolveLimits(config: Config): Required<OperationalLimits> {
  return {
    maxCodeBytes: config.maxCodeBytes ?? DEFAULT_LIMITS.maxCodeBytes,
    maxFunctions: config.maxFunctions ?? DEFAULT_LIMITS.maxFunctions,
    maxFindings: config.maxFindings ?? DEFAULT_LIMITS.maxFindings,
  }
}

/** Re-export the engine's public types for host composition. */
export type { CodeAnalysis, Language, StaticCheckConfig, Finding } from '@deepseek-ai/dsh-code'

/** Output schema of `code_analyze`. */
const ANALYZE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', required: true },
    qualityScore: { type: 'number', required: true },
    metrics: { type: 'json', required: true },
    complexity: { type: 'json', required: true },
    findings: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Output schema of `code_check`. */
const CHECK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', required: true },
    findingCount: { type: 'integer', required: true },
    errorCount: { type: 'integer', required: true },
    warningCount: { type: 'integer', required: true },
    infoCount: { type: 'integer', required: true },
    findings: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
  },
} as const

/** JSON projection of a full analysis, matching `ANALYZE_OUTPUT_SCHEMA`. */
interface AnalyzeToolValue {
  language: string
  qualityScore: number
  metrics: JsonValue
  complexity: JsonValue
  findings: Array<Record<string, JsonValue>>
  notes: string[]
}

/** Project a readonly analysis into the compact analyze value. */
function analysisToValue(analysis: CodeAnalysis): AnalyzeToolValue {
  return {
    language: analysis.language,
    qualityScore: analysis.qualityScore,
    metrics: { ...analysis.metrics } as unknown as JsonValue,
    complexity: {
      overall: analysis.complexity.overall,
      average: analysis.complexity.average,
      max: analysis.complexity.max,
      functions: analysis.complexity.functions.map(fn => ({ ...fn })),
    } as unknown as JsonValue,
    findings: analysis.findings.map(finding => ({ ...finding })) as unknown as Array<Record<string, JsonValue>>,
    notes: [...analysis.notes],
  }
}

/** JSON projection of a findings-focused check, matching `CHECK_OUTPUT_SCHEMA`. */
interface CheckToolValue {
  language: string
  findingCount: number
  errorCount: number
  warningCount: number
  infoCount: number
  findings: Array<Record<string, JsonValue>>
}

/** Generic, args-only pending presentation shared by the code tools. */
function present(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/**
 * Register the `code_analyze` and `code_check` tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's resource-limit and check-toggle policy.
 */
export function apply(ctx: Context, config: Config): void {
  const limits = resolveLimits(config)

  ctx.tools.register(defineTool({
    name: 'code_analyze',
    description: 'Analyze a source code snippet: detect language, compute line metrics, functions, classes, cyclomatic complexity, static findings, and a 0–100 quality score.',
    parameters: {
      source: { type: 'string', required: true, description: 'The source code text to analyze.' },
      fileName: { type: 'string', description: 'Optional file name; a known extension wins over content heuristics for language detection.' },
      checks: { type: 'json', description: 'Optional rule toggles: dangerous, secrets, todos, debugResidue, emptyCatch, broadCatch.' },
    },
    output: {
      schema: ANALYZE_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const a = value as { language: string; qualityScore: number; metrics: Record<string, number> }
        return [{
          type: 'text',
          /* v8 ignore next -- the analyzer always emits functions and lines in metrics. */
          text: `Analyzed ${a.language}: ${a.metrics.functions ?? 0} functions, ${a.metrics.lines ?? 0} lines, quality ${a.qualityScore}/100`,
        }]
      },
    },
    execute(args) {
      const overrides: { limits?: OperationalLimits; checks?: StaticCheckConfig } = { limits }
      const checks = normalizeChecks(args.checks)
      if (checks !== undefined) overrides.checks = checks
      const analysis = analyze(args.fileName, args.source, overrides)
      return Promise.resolve(analysisToValue(analysis))
    },
    presentCall: args => present('Analyze source code', args),
  }))

  ctx.tools.register(defineTool({
    name: 'code_check',
    description: 'Run static quality and security checks on a source snippet: dynamic execution, raw SQL concatenation, hardcoded secrets, TODO markers, debugger residue, and empty/bare exception handlers.',
    parameters: {
      source: { type: 'string', required: true, description: 'The source code text to scan.' },
      fileName: { type: 'string', description: 'Optional file name for language detection.' },
      checks: { type: 'json', description: 'Optional rule toggles: dangerous, secrets, todos, debugResidue, emptyCatch, broadCatch.' },
    },
    output: {
      schema: CHECK_OUTPUT_SCHEMA,
      render: (_args, value) => {
        const c = value as { findingCount: number; errorCount: number; warningCount: number }
        return [{
          type: 'text',
          text: `Checked code: ${c.findingCount} finding(s) — ${c.errorCount} error(s), ${c.warningCount} warning(s)`,
        }]
      },
    },
    execute(args) {
      const bytes = new TextEncoder().encode(args.source).length
      if (bytes > limits.maxCodeBytes) {
        throw new CodeError(`source is ${bytes} bytes, exceeding the ${limits.maxCodeBytes}-byte limit`, {
          code: 'LIMIT_EXCEEDED',
        })
      }
      const checks = normalizeChecks(args.checks)
      const language = detectLanguage(args.fileName, args.source)
      const findings = runChecks(language, args.source, checks).slice(0, limits.maxFindings)
      let errorCount = 0
      let warningCount = 0
      let infoCount = 0
      for (const finding of findings) {
        if (finding.severity === 'error') errorCount++
        else if (finding.severity === 'warning') warningCount++
        else infoCount++
      }
      return Promise.resolve({
        language,
        findingCount: findings.length,
        errorCount,
        warningCount,
        infoCount,
        findings: findings.map(finding => ({ ...finding })) as unknown as Array<Record<string, JsonValue>>,
      } satisfies CheckToolValue)
    },
    presentCall: args => present('Check source code', args),
  }))
}

/** A policy that disables a check when passed an explicit `false`. */
function normalizeChecks(raw: unknown): StaticCheckConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const flags = new Set(['dangerous', 'secrets', 'todos', 'debugResidue', 'emptyCatch', 'broadCatch'])
  const out: Record<string, boolean> = {}
  const src = raw as Record<string, unknown>
  for (const key of Object.keys(src)) {
    if (flags.has(key) && typeof src[key] === 'boolean') {
      out[key] = src[key] as boolean
    }
  }
  return out as StaticCheckConfig
}
