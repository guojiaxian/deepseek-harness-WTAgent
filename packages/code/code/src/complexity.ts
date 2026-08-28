/**
 * Cyclomatic-complexity analysis.
 *
 * Complexity is a heuristic metric: it counts decision points (`if`/`for`/`while`
 * conditionals, boolean operators, `case` arms, `catch`/`except`) and reports one
 * plus the count per the classic McCabe definition. Decision keywords inside
 * comments or string literals can inflate the count slightly, so values are for
 * relative ranking, not citation. Function detection is language-specific and
 * best-effort: Python uses indentation, C-family languages use a brace-counting
 * scanner that delimiters each function body. `unknown` input gets only a
 * file-level count and no per-function records.
 * @module @deepseek-ai/dsh-code
 */

import type { ComplexityMetrics, FunctionComplexity, Language } from './types.ts'

/** A detected function declaration: source index range plus parsed name. */
interface FunctionDecl {
  /** 0-based start index into the source line array. */
  readonly index: number
  /** Parsed function name; empty when anonymous. */
  readonly name: string
  /** 0-based exclusive end index into the source line array. */
  readonly endIndex: number
}

/** The family buckets that share decision-point rules. */
type Family = 'python' | 'jsLike' | 'cLike' | 'unknown'

/** Map each language to its decision-point family. */
function family(language: Language): Family {
  switch (language) {
    case 'python': return 'python'
    case 'javascript':
    case 'typescript': return 'jsLike'
    case 'java':
    case 'go':
    case 'c':
    case 'cpp':
    case 'rust': return 'cLike'
    case 'unknown': return 'unknown'
  }
}

/**
 * Count the decision points in arbitrary source text.
 * @param language - detected language selecting the counting heuristic.
 * @param text - source text to scan for decision keywords and operators.
 * @returns the total decision-point count.
 */
export function countDecisionPoints(language: Language, text: string): number {
  const f = family(language)
  let words = 0
  let ops = 0
  if (f === 'python') {
    words = (text.match(/\b(?:if|for|while|and|or|except|match|case)\b/g) ?? []).length
  } else if (f === 'jsLike') {
    words = (text.match(/\b(?:if|for|while|catch|case)\b/g) ?? []).length
    ops = (text.match(/&&|\|\||\?\?/g) ?? []).length
  } else if (f === 'cLike') {
    words = (text.match(/\b(?:if|for|while|catch|case)\b/g) ?? []).length
    ops = (text.match(/&&|\|\|/g) ?? []).length
  } else {
    words = (text.match(/\b(?:if|for|while|catch|case|and|or|except)\b/g) ?? []).length
    ops = (text.match(/&&|\|\||\?\?/g) ?? []).length
  }
  return words + ops
}

/** Detect function declarations and their body ranges for a language. */
function findFunctions(language: Language, lines: readonly string[]): FunctionDecl[] {
  if (language === 'python') return findPythonFunctions(lines)
  if (language === 'unknown') return []
  return findCFamilyFunctions(language, lines)
}

/** Python: `def` / `async def`; each body ends at the next declaration line. */
function findPythonFunctions(lines: readonly string[]): FunctionDecl[] {
  const starts: { index: number; name: string; indent: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(lines[i]!)
    if (m && m !== null) {
      /* v8 ignore next -- the python def regex captures both names groups whenever it matches. */
      starts.push({ index: i, name: m[2] ?? '', indent: (m[1] ?? '').length })
    }
  }
  return starts.map((decl, j) => ({
    index: decl.index,
    name: decl.name,
    endIndex: j + 1 < starts.length ? starts[j + 1]!.index : lines.length,
  }))
}

/** C-family: brace-counting delimits each function body. */
function findCFamilyFunctions(language: Language, lines: readonly string[]): FunctionDecl[] {
  const pattern = cFamilyFunctionPattern(language)
  const results: { index: number; name: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = pattern.exec(lines[i]!)
    if (m && m !== null) {
      results.push({ index: i, name: m[1] ?? '' })
    }
  }
  return results.map(decl => ({ ...decl, endIndex: cFamilyBodyEnd(lines, decl.index) }))
}

/** Function-start regex per C-family language; group 1 is the optional name. */
function cFamilyFunctionPattern(language: Language): RegExp {
  switch (language) {
    case 'javascript':
    case 'typescript':
      return /\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/
    case 'java':
      return /\b(?:public|private|protected)\b[^\n{]*\b([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:\{|throws\b)/
    case 'go':
      return /\bfunc\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/
    case 'rust':
      return /\bfn\s+([A-Za-z_]\w*)\s*\(/
    case 'c':
    case 'cpp':
      return /^[A-Za-z_][A-Za-z0-9_:*&<>\s]*\b([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/
    /* v8 ignore next -- unreachable for the c-like-only callers; findFunctions returns [] before unknown. */
    default: return /$^/
  }
}

/** Find the 0-based exclusive end index of a function body by brace balance. */
function cFamilyBodyEnd(lines: readonly string[], start: number): number {
  let depth = 0
  let opened = false
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === '{') {
        depth++
        opened = true
      } else if (ch === '}') {
        depth--
        if (opened && depth === 0) return i + 1
      }
    }
  }
  return lines.length
}

/**
 * Count class-like declarations in source lines for a language.
 * @param language - detected language selecting the declaration pattern.
 * @param lines - source split into lines.
 * @returns the number of class-like declarations.
 */
export function countClasses(language: Language, lines: readonly string[]): number {
  let pattern: RegExp
  switch (language) {
    case 'python': pattern = /^\s*class\s+\w+/; break
    case 'javascript':
    case 'typescript': pattern = /\bclass\s+\w+/; break
    case 'java': pattern = /\b(?:class|interface|enum)\s+\w+/; break
    case 'go':
    case 'rust': pattern = /\b(?:struct|trait|enum|interface)\s+\w+/; break
    case 'c':
    case 'cpp': pattern = /\b(?:class|struct)\s+\w+/; break
    case 'unknown': pattern = /\b(?:class|struct|trait)\s+\w+/; break
  }
  return lines.filter(line => pattern.test(line)).length
}

/**
 * Compute the complexity metrics of a source file.
 * @param language - detected language selecting the analyzer.
 * @param source - source text to analyze.
 * @returns the complexity metrics.
 */
export function computeComplexity(language: Language, source: string): ComplexityMetrics {
  const lines = source.split('\n')
  const overall = countDecisionPoints(language, source) + 1
  const decls = findFunctions(language, lines)
  const functions: FunctionComplexity[] = decls.map((decl) => {
    const body = lines.slice(decl.index, decl.endIndex).join('\n')
    return {
      name: decl.name,
      line: decl.index + 1,
      complexity: countDecisionPoints(language, body) + 1,
    }
  })
  const max = functions.length === 0 ? 0 : Math.max(...functions.map(fn => fn.complexity))
  const average = functions.length === 0
    ? null
    : Math.round(functions.reduce((sum, fn) => sum + fn.complexity, 0) / functions.length)
  return { overall, average, max, functions }
}
