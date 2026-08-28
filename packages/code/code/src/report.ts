/**
 * Analysis orchestrator.
 *
 * `analyze` composes the pure stages — language detection, line metrics, function
 * and complexity analysis, class counting, and static checks — into one
 * {@link CodeAnalysis}. Resource caps come from validated {@link OperationalLimits}
 * fields (deployment tunables, never hardcoded inside the stages), and the quality
 * score is a deterministic penalty-accumulation heuristic over findings and
 * complexity, so hosts can rank files without depending on a specific ordering.
 * @module @deepseek-ai/dsh-code
 */

import { runChecks } from './checks.ts'
import { computeComplexity, countClasses } from './complexity.ts'
import { CodeError } from './errors.ts'
import { detectLanguage } from './lang.ts'
import { countLineMetrics } from './metrics.ts'
import type { CodeAnalysis, Finding, Language, OperationalLimits, StaticCheckConfig } from './types.ts'

/** Analysis defaults when callers omit limits. */
export const DEFAULT_LIMITS: Required<OperationalLimits> = {
  maxCodeBytes: 1024 * 1024,
  maxFunctions: 1000,
  maxFindings: 100,
}

/**
 * Compute the quality score (0–100, higher is better) from an analysis.
 * @param metrics - language, function count, max function complexity, and findings.
 * @returns the rounded 0–100 quality score.
 */
export function qualityScore(metrics: {
  readonly language: Language
  readonly functionCount: number
  readonly maxFunctionComplexity: number
  readonly findings: readonly Finding[]
}): number {
  let score = 100
  for (const finding of metrics.findings) {
    if (finding.severity === 'error') score -= 10
    else if (finding.severity === 'warning') score -= 4
    else score -= 1
  }
  if (metrics.maxFunctionComplexity > 10) {
    score -= 5
  }
  if (metrics.functionCount > 0 && metrics.maxFunctionComplexity > 20) {
    score -= 5
  }
  return Math.max(0, Math.round(score))
}

/**
 * Resolve caller overrides against the deployment defaults.
 * @param limits - optional caller-provided limits to merge over the defaults.
 * @returns the fully-resolved limits with every field set.
 */
export function resolveLimits(limits?: OperationalLimits): Required<OperationalLimits> {
  return {
    maxCodeBytes: limits?.maxCodeBytes ?? DEFAULT_LIMITS.maxCodeBytes,
    maxFunctions: limits?.maxFunctions ?? DEFAULT_LIMITS.maxFunctions,
    maxFindings: limits?.maxFindings ?? DEFAULT_LIMITS.maxFindings,
  }
}

/**
 * Analyze a source file end to end.
 * @param fileName - optional file name used for language detection.
 * @param source - source text to analyze.
 * @param options - optional limits and static-check toggles.
 * @returns the full analysis record.
 * @throws {@link CodeError} when the source exceeds `maxCodeBytes`.
 */
export function analyze(
  fileName: string | undefined,
  source: string,
  options?: { readonly limits?: OperationalLimits; readonly checks?: StaticCheckConfig },
): CodeAnalysis {
  const limits = resolveLimits(options?.limits)
  const bytes = new TextEncoder().encode(source).length
  if (bytes > limits.maxCodeBytes) {
    throw new CodeError(`source is ${bytes} bytes, exceeding the ${limits.maxCodeBytes}-byte limit`, {
      code: 'LIMIT_EXCEEDED',
    })
  }

  const language = detectLanguage(fileName, source)
  const lines = source.split('\n')
  const lineMetrics = countLineMetrics(language, source)
  const complexity = computeComplexity(language, source)
  const classes = countClasses(language, lines)
  const findings = runChecks(language, source, options?.checks).slice(0, limits.maxFindings)

  const notes: string[] = []
  if (language === 'unknown') notes.push('Language not detected; used the generic analyzer.')
  if (complexity.functions.length === 0 && language !== 'unknown') {
    notes.push('No functions detected.')
  }
  if (complexity.functions.length > limits.maxFunctions) {
    notes.push(`Capped function records at ${limits.maxFunctions}.`)
  }
  const truncated = runChecks(language, source, options?.checks).length - findings.length
  if (truncated > 0) notes.push(`Capped findings at ${limits.maxFindings}; ${truncated} more suppressed.`)
  if (complexity.max > 10) notes.push(`${complexity.functions.length} function(s) exceed the complexity 10 guideline.`)

  const functions = complexity.functions.slice(0, limits.maxFunctions)

  return {
    language,
    metrics: {
      ...lineMetrics,
      language,
      functions: functions.length,
      classes,
    },
    complexity: {
      overall: complexity.overall,
      average: complexity.average,
      max: complexity.max,
      functions,
    },
    qualityScore: qualityScore({
      language,
      functionCount: functions.length,
      maxFunctionComplexity: complexity.max,
      findings,
    }),
    findings,
    notes,
  }
}
