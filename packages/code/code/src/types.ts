/**
 * Domain model and configuration types of the code analysis engine.
 *
 * The engine is deliberately dependency-free pure TypeScript: every analyzer is a
 * pure function over source text, so language detection, metrics, complexity, and
 * static checks are unit-testable in isolation and can be embedded by any host
 * without a Cordis runtime. The plugin in `index.ts` mounts the same functions
 * behind the `ctx.code` service.
 * @module @deepseek-ai/dsh-code
 */

/** Programming languages with dedicated analyzers. Unsupported input is `unknown`. */
export type Language =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'java'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'unknown'

/** Line-count categories of one source file. */
export interface LineMetrics {
  /** Total physical line count, including blank and comment lines. */
  readonly lines: number
  /** Lines holding at least one non-comment, non-blank token. */
  readonly codeLines: number
  /** Whole-line comments; block-comment lines count here, inline comments do not. */
  readonly commentLines: number
  /** Lines with only whitespace. */
  readonly blankLines: number
}

/** Cyclomatic-complexity record of one detected function. */
export interface FunctionComplexity {
  /** Function name as parsed from the source; may be qualified or empty. */
  readonly name: string
  /** 1-based start line of the function. */
  readonly line: number
  /** Cyclomatic complexity (decision points + 1). */
  readonly complexity: number
}

/** Aggregated complexity metrics of a source file. */
export interface ComplexityMetrics {
  /** File-level cyclomatic complexity (decision points + 1). */
  readonly overall: number
  /** Mean per-function complexity, or `null` when no functions were detected. */
  readonly average: number | null
  /** Highest per-function complexity. */
  readonly max: number
  /** Per-function complexity records, in source order. */
  readonly functions: readonly FunctionComplexity[]
}

/** Severity of one static-analysis finding. */
export type Severity = 'error' | 'warning' | 'info'

/** Grouping of one static-analysis rule. */
export type FindingCategory = 'security' | 'maintainability' | 'debugResidue'

/** One static-analysis finding, anchored to a source line. */
export interface Finding {
  /** Stable rule id (e.g. `dangerous-call`). */
  readonly rule: string
  /** Rule grouping. */
  readonly category: FindingCategory
  /** Rule severity. */
  readonly severity: Severity
  /** 1-based line the finding was raised from. */
  readonly line: number
  /** Human-readable explanation. */
  readonly message: string
  /** Source snippet around the finding, when available. */
  readonly snippet?: string
}

/** Static-check rule toggles. All rules run when their field is absent. */
export interface StaticCheckConfig {
  /** `eval`, `exec`, `os.system`, `child_process`, and raw SQL-concatenation calls. */
  readonly dangerous?: boolean
  /** Hardcoded secrets: API keys, passwords, tokens, private keys, AWS keys. */
  readonly secrets?: boolean
  /** `TODO`, `FIXME`, `XXX` markers (info-level). */
  readonly todos?: boolean
  /** `debugger` statements and `pdb.set_trace()` calls. */
  readonly debugResidue?: boolean
  /** Empty `catch`/`except` blocks that swallow errors silently. */
  readonly emptyCatch?: boolean
  /** Bare `except:` (Python) or `catch (any)` that catches everything. */
  readonly broadCatch?: boolean
}

/** Combined metrics of one source file. */
export interface CodeMetrics extends LineMetrics {
  /** Detected language. */
  readonly language: Language
  /** Number of top-level or nested functions/classes detected. */
  readonly functions: number
  /** Number of classes detected. */
  readonly classes: number
}

/** Full analysis result of one source file. */
export interface CodeAnalysis {
  /** Detected language. */
  readonly language: Language
  /** Line, function, and class metrics. */
  readonly metrics: CodeMetrics
  /** Cyclomatic-complexity summary. */
  readonly complexity: ComplexityMetrics
  /** 0–100 quality score; higher is better. */
  readonly qualityScore: number
  /** Static-check findings in source order. */
  readonly findings: readonly Finding[]
  /** Audit notes from normalization, limits, and heuristic fallbacks. */
  readonly notes: readonly string[]
}

/** Resource and cap limits enforced by the engine. */
export interface OperationalLimits {
  /** Maximum accepted source byte length; default 1 MiB. */
  readonly maxCodeBytes?: number
  /** Maximum function-complexity records kept; default 1000. */
  readonly maxFunctions?: number
  /** Maximum findings kept per analysis; default 100. */
  readonly maxFindings?: number
}

/** Configuration of the code service; validated fields mirror the engine limits. */
export interface CodeConfig {
  /** Maximum accepted source byte length; default 1 MiB. */
  readonly maxCodeBytes?: number
  /** Maximum function-complexity records kept; default 1000. */
  readonly maxFunctions?: number
  /** Maximum findings kept per analysis; default 100. */
  readonly maxFindings?: number
  /** Rule toggles applied when no per-call checks are given. */
  readonly defaultChecks?: StaticCheckConfig
}
