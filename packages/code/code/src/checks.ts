/**
 * Static quality and security checks.
 *
 * Each rule is a regex applied to the whole source; matches are anchored to the
 * originating 1-based line. Rules are heuristic: they flag likely problems (dynamic
 * execution, raw SQL concatenation, hardcoded secrets, TODO markers, debugger
 * residue, empty or bare exception handlers) for a model to confirm, and every
 * rule can be disabled through {@link StaticCheckConfig}. Findings carry a stable
 * rule id so hosts can suppress or re-rank individual rules.
 * @module @deepseek-ai/dsh-code
 */

import type { Finding, FindingCategory, Language, Severity, StaticCheckConfig } from './types.ts'

/** One rule definition: id, category, severity, regex, and message template. */
interface Rule {
  readonly rule: string
  readonly key: keyof StaticCheckConfig
  readonly category: FindingCategory
  readonly severity: Severity
  readonly source: RegExp
  readonly message: string
}

/** Common SQL-string concatenation pattern reused across language families. */
const SQL_CONCAT = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)[^;\n]*\+\s*\w+/gi

/** Rules common to every language. */
const COMMON_RULES: readonly Rule[] = [
  {
    rule: 'todos', key: 'todos', category: 'maintainability', severity: 'info',
    source: /\b(?:TODO|FIXME|XXX|HACK)\b/g,
    message: 'Marker comment left in code.',
  },
  {
    rule: 'secrets', key: 'secrets', category: 'security', severity: 'error',
    source: /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|aws[_-]?secret)\s*[:=]\s*['"][^'"]+|(?:BEGIN\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY)|(?:sk-[A-Za-z0-9]{16,})|(?:AKIA[0-9A-Z]{16})|(?:xox[baprs]-[A-Za-z0-9-]{10,})/gi,
    message: 'Possible hardcoded secret or credential.',
  },
]

/** The dynamic-execution and debugger rules keyed by language family. */
function familyRules(language: Language): readonly Rule[] {
  switch (language) {
    case 'python':
      return [
        {
          rule: 'dangerous-call', key: 'dangerous', category: 'security', severity: 'error',
          source: /\b(?:os\.system|subprocess\.(?:call|run|Popen|check_output|check_call)|eval|exec|execfile|pickle\.loads|yaml\.load)\s*\(/g,
          message: 'Potentially dangerous dynamic-code or shell-execution call.',
        },
        {
          rule: 'sql-injection', key: 'dangerous', category: 'security', severity: 'error',
          source: SQL_CONCAT, message: 'Raw SQL string concatenation may allow injection; use parameterized queries.',
        },
        {
          rule: 'debug-residue', key: 'debugResidue', category: 'debugResidue', severity: 'warning',
          source: /\b(?:pdb\.set_trace|breakpoint)\s*\(/g, message: 'Python debugger call left in code.',
        },
        {
          rule: 'empty-catch', key: 'emptyCatch', category: 'maintainability', severity: 'warning',
          source: /\n\s*except[^\n]*:\n\s*pass\b/g, message: 'Empty except block silently swallows the error.',
        },
        {
          rule: 'broad-catch', key: 'broadCatch', category: 'maintainability', severity: 'warning',
          source: /^\s*except\s*:/gm, message: 'Bare except handler may hide unexpected errors.',
        },
      ]
    case 'javascript':
    case 'typescript':
      return [
        {
          rule: 'dangerous-call', key: 'dangerous', category: 'security', severity: 'error',
          source: /\b(?:eval|Function|child_process\.(?:exec|execSync|spawn|spawnSync|fork)|require\s*\(\s*['"]child_process['"]\s*\))\s*\(/g,
          message: 'Potentially dangerous dynamic-code or shell-execution call.',
        },
        {
          rule: 'sql-injection', key: 'dangerous', category: 'security', severity: 'error',
          source: SQL_CONCAT, message: 'Raw SQL string concatenation may allow injection; use parameterized queries.',
        },
        {
          rule: 'debug-residue', key: 'debugResidue', category: 'debugResidue', severity: 'warning',
          source: /\bdebugger\s*;?/g, message: 'Debugger statement left in code.',
        },
        {
          rule: 'empty-catch', key: 'emptyCatch', category: 'maintainability', severity: 'warning',
          source: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g, message: 'Empty catch block silently swallows the error.',
        },
        {
          rule: 'broad-catch', key: 'broadCatch', category: 'maintainability', severity: 'warning',
          source: /\bcatch\s*\{/g, message: 'Optional-catch-binding handler may hide unexpected errors.',
        },
      ]
    case 'java':
    case 'c':
    case 'cpp':
      return [
        {
          rule: 'dangerous-call', key: 'dangerous', category: 'security', severity: 'error',
          source: /\b(?:system|popen|exec)\s*\(/g, message: 'Potentially dangerous shell-execution call.',
        },
        {
          rule: 'sql-injection', key: 'dangerous', category: 'security', severity: 'error',
          source: SQL_CONCAT, message: 'Raw SQL string concatenation may allow injection; use prepared statements.',
        },
        {
          rule: 'empty-catch', key: 'emptyCatch', category: 'maintainability', severity: 'warning',
          source: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g, message: 'Empty catch block silently swallows the error.',
        },
      ]
    case 'go':
      return [
        {
          rule: 'dangerous-call', key: 'dangerous', category: 'security', severity: 'error',
          source: /\b(?:exec\.Command|os\.StartProcess|syscall\.Exec|eval)\s*\(/g,
          message: 'Potentially dangerous shell-execution call.',
        },
      ]
    default:
      return []
  }
}

/**
 * Run the static checks that are enabled over `source`.
 * @param language - detected language selecting the rule set.
 * @param source - source text to scan.
 * @param config - rule toggles; a rule runs unless its field is explicitly false.
 * @returns the findings in source order.
 */
export function runChecks(language: Language, source: string, config?: StaticCheckConfig): Finding[] {
  const rules = [...COMMON_RULES, ...familyRules(language)]
  const findings: Finding[] = []
  for (const rule of rules) {
    if (config?.[rule.key] === false) continue
    const matches = [...source.matchAll(rule.source)]
    for (const match of matches) {
      const line = lineNumber(source, match.index)
      findings.push({
        rule: rule.rule,
        category: rule.category,
        severity: rule.severity,
        line,
        message: rule.message,
        snippet: snippetAt(source, match.index),
      })
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
}

/** 1-based line number of a character offset. */
function lineNumber(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++
  }
  return line
}

/** The non-empty source line containing an offset, trimmed to 80 chars. */
function snippetAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index - 1) + 1
  const endIdx = source.indexOf('\n', index)
  const line = source.slice(start, endIdx === -1 ? undefined : endIdx).trim()
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}
