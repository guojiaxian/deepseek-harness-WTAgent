import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import {
  CodeError, CodeService, analyze, computeComplexity, countClasses, countDecisionPoints,
  countLineMetrics, detectLanguage, hasFunctionAnalyzer, languageFromFileName,
  qualityScore, resolveLimits, runChecks,
} from '@deepseek-ai/dsh-code'
import * as codePlugin from '../src/index.ts'
import * as codeInvariant from '../src/invariant.ts'

const PY = `import os
def greet(name):
    # a greeting
    return os.system("echo hi")

class Greeter:
    def __init__(self):
        self.name = "x"
`

describe('language detection', () => {
  it('detects by file extension', () => {
    expect(detectLanguage('app.py', 'x')).toBe('python')
    expect(detectLanguage('main.js', 'x')).toBe('javascript')
    expect(detectLanguage('main.ts', 'x')).toBe('typescript')
    expect(detectLanguage('App.java', 'x')).toBe('java')
    expect(languageFromFileName(undefined)).toBe('unknown')
    expect(languageFromFileName('MODULE.PY')).toBe('python')
    expect(languageFromFileName('notes.txt')).toBe('unknown')
  })

  it('falls back to content heuristics without an extension', () => {
    expect(detectLanguage(undefined, 'def f():\n    pass\n')).toBe('python')
    expect(detectLanguage(undefined, 'public static void main(x)')).toBe('java')
    expect(detectLanguage(undefined, 'fn main() { }')).toBe('rust')
    expect(detectLanguage(undefined, 'use std::io::Write;')).toBe('rust')
    expect(detectLanguage(undefined, 'func foo() {}')).toBe('go')
    expect(detectLanguage(undefined, 'value := bar()')).toBe('go')
    expect(detectLanguage(undefined, '')).toBe('unknown')
  })

  it('treats an unknown extension as unknown then falls back to content', () => {
    expect(detectLanguage('notes.txt', '')).toBe('unknown')
  })

  it('reports whether a language has a function analyzer', () => {
    expect(hasFunctionAnalyzer('python')).toBe(true)
    expect(hasFunctionAnalyzer('unknown')).toBe(false)
  })
})

describe('line metrics', () => {
  it('counts code, comment, and blank lines', () => {
    const m = countLineMetrics('python', 'a = 1\n\n# c\nb = 2\n')
    expect(m).toEqual({ lines: 4, codeLines: 2, commentLines: 1, blankLines: 1 })
  })

  it('does not fold a missing trailing newline into a blank line', () => {
    const m = countLineMetrics('python', 'a = 1')
    expect(m).toEqual({ lines: 1, codeLines: 1, commentLines: 0, blankLines: 0 })
  })

  it('classifies block comments across lines (C-family)', () => {
    const m = countLineMetrics('javascript', '/* one\n two */\nconst x = 1;\n')
    expect(m.commentLines).toBe(2)
    expect(m.codeLines).toBe(1)
  })

  it('counts code that precedes an inline block comment', () => {
    const m = countLineMetrics('javascript', 'const a = 1; /* c */ const b = 2;')
    expect(m.codeLines).toBe(1)
    expect(m.commentLines).toBe(0)
  })

  it('handles python triple-quoted docstring lines', () => {
    const m = countLineMetrics('python', '"""doc"""\ndef f():\n    pass\n')
    expect(m.commentLines).toBe(1)
    expect(m.codeLines).toBe(2)
  })

  it('treats inline comments as code', () => {
    const m = countLineMetrics('javascript', 'const x = 1; // hi\n')
    expect(m.codeLines).toBe(1)
    expect(m.commentLines).toBe(0)
  })

  it('applies the C comment style and #include stays code', () => {
    const m = countLineMetrics('c', '// include check\n#include <stdio.h>\nint main() {}\n')
    expect(m.commentLines).toBe(1)
    expect(m.codeLines).toBe(2)
  })

  it('uses the generic comment style for unknown languages', () => {
    const m = countLineMetrics('unknown', '// a\n# b\nint x;\n')
    expect(m.commentLines).toBe(2)
    expect(m.codeLines).toBe(1)
  })

  it('treats a whitespace-only line as blank', () => {
    const m = countLineMetrics('python', 'a = 1\n   \n')
    expect(m.blankLines).toBe(1)
  })

  it('picks the earliest of competing markers', () => {
    const generic = countLineMetrics('unknown', '// https://x.example # not-a-comment\nint x;\n')
    expect(generic.commentLines).toBe(1)
    const python = countLineMetrics('python', "x = '''a''' \"\"\"b\"\"\"\n")
    expect(python.codeLines).toBe(1)
  })
})

describe('complexity', () => {
  it('counts decision points across language families', () => {
    expect(countDecisionPoints('python', 'if a or b:\n    pass\n')).toBe(2)
    expect(countDecisionPoints('python', 'x = 1')).toBe(0)
    expect(countDecisionPoints('javascript', 'if (a && b) { }')).toBe(2)
    expect(countDecisionPoints('javascript', 'const a = 1;')).toBe(0)
    expect(countDecisionPoints('java', 'if (a && b) { }\nfor (;;) { }')).toBe(3)
    expect(countDecisionPoints('java', 'int x = 1;')).toBe(0)
    expect(countDecisionPoints('unknown', 'if a and b')).toBe(2)
    expect(countDecisionPoints('unknown', 'x = 1')).toBe(0)
  })

  it('attributes per-function complexity for python', () => {
    const c = computeComplexity('python', 'def f():\n    if x:\n        return 1\n    return 0\n')
    expect(c.functions).toHaveLength(1)
    expect(c.functions[0]!.complexity).toBe(2)
    expect(c.max).toBe(2)
    expect(c.overall).toBeGreaterThanOrEqual(2)
  })

  it('attributes per-function complexity for C-family', () => {
    const c = computeComplexity('javascript', 'function add(a, b) {\n  if (a && b) return a + b;\n  return 0;\n}\n')
    expect(c.functions).toHaveLength(1)
    expect(c.functions[0]!.name).toBe('add')
    expect(c.functions[0]!.line).toBe(1)
    expect(c.functions[0]!.complexity).toBe(3)
  })

  it('names anonymous javascript functions as empty', () => {
    const c = computeComplexity('javascript', 'const f = function() {\n  if (x) return 1;\n  return 0;\n};\n')
    expect(c.functions[0]!.name).toBe('')
    expect(c.functions[0]!.complexity).toBe(2)
  })

  it('detects typescript and cpp functions via their patterns', () => {
    const ts = computeComplexity('typescript', 'function add(a: number, b: number): number {\n  return a + b;\n}\n')
    expect(ts.functions[0]!.name).toBe('add')
    const cpp = computeComplexity('cpp', 'int add(int a) { return a; }\n')
    expect(cpp.functions[0]!.name).toBe('add')
  })

  it('closes an unterminated function body at the file end', () => {
    const c = computeComplexity('c', 'int f() {\n  return 1;\n')
    expect(c.functions[0]!.line).toBe(1)
  })

  it('detects java methods guarded by access modifiers', () => {
    const c = computeComplexity('java', 'public class A {\n  public int add(int a) {\n    if (a > 0) return 1;\n    return 0;\n  }\n}\n')
    expect(c.functions[0]!.name).toBe('add')
    expect(c.functions[0]!.complexity).toBe(2)
  })

  it('detects go funcs', () => {
    const c = computeComplexity('go', 'func main() {\n  for i := 0; i < 3; i++ { }\n}\n')
    expect(c.functions[0]!.name).toBe('main')
    expect(c.functions[0]!.complexity).toBe(2)
  })

  it('detects rust fns', () => {
    const c = computeComplexity('rust', 'fn greet(name: &str) {\n  if name.is_empty() { print!("x"); }\n}\n')
    expect(c.functions[0]!.name).toBe('greet')
    expect(c.functions[0]!.complexity).toBe(2)
  })

  it('detects C-style function signatures', () => {
    const c = computeComplexity('c', 'int add(int a) {\n  if (a > 0) return 1;\n  return 0;\n}\n')
    expect(c.functions[0]!.name).toBe('add')
    expect(c.functions[0]!.complexity).toBe(2)
  })

  it('returns an empty function list and overall 1 for unknown', () => {
    const c = computeComplexity('unknown', 'random text\n')
    expect(c.functions).toHaveLength(0)
    expect(c.max).toBe(0)
    expect(c.average).toBeNull()
    expect(c.overall).toBe(1)
  })
})

describe('class counting', () => {
  it('counts classes per language', () => {
    expect(countClasses('python', ['class A:', '  pass', 'class B:', '  pass'])).toBe(2)
    expect(countClasses('javascript', ['class Foo { }', 'const x = 1'])).toBe(1)
    expect(countClasses('java', ['class A {}', 'interface B {}', 'enum C {}'])).toBe(3)
    expect(countClasses('go', ['struct S {}', 'interface I {}'])).toBe(2)
    expect(countClasses('rust', ['struct S {}', 'trait T {}'])).toBe(2)
    expect(countClasses('c', ['class A {}', 'struct B {}'])).toBe(2)
    expect(countClasses('cpp', ['class A {}'])).toBe(1)
    expect(countClasses('unknown', ['class X'])).toBe(1)
  })
})

describe('static checks', () => {
  it('flags dangerous python calls and SQL concatenation', () => {
    const findings = runChecks('python', 'import os\nos.system("ls")\nq = "SELECT * FROM t " + var\n')
    expect(findings.map(f => f.rule)).toContain('dangerous-call')
    expect(findings.map(f => f.rule)).toContain('sql-injection')
  })

  it('flags secrets and TODO markers', () => {
    const findings = runChecks('javascript', 'const apiKey = "sk-abcdef1234567890"; // TODO drain\n')
    const rules = findings.map(f => f.rule)
    expect(rules).toContain('secrets')
    expect(rules).toContain('todos')
    expect(findings.find(f => f.rule === 'todos')!.line).toBe(1)
  })

  it('flags debug residue and empty/broad exception handlers', () => {
    const js = runChecks('javascript', 'function f(){\n  debugger;\n  try {} catch (e) {}\n}\n')
    const jsRules = js.map(f => f.rule)
    expect(jsRules).toContain('debug-residue')
    expect(jsRules).toContain('empty-catch')
    const py = runChecks('python', 'try:\n    x()\nexcept:\n    pass\n')
    const pyRules = py.map(f => f.rule)
    expect(pyRules).toContain('broad-catch')
    expect(pyRules).toContain('empty-catch')
  })

  it('flags C-family and Go dangerous calls and empty catches', () => {
    const java = runChecks('java', 'system("ls");\ntry {} catch (Exception e) {}\nString q = "SELECT * FROM t " + id;\n')
    const javaRules = java.map(f => f.rule)
    expect(javaRules).toContain('dangerous-call')
    expect(javaRules).toContain('sql-injection')
    expect(javaRules).toContain('empty-catch')
    const cpp = runChecks('cpp', 'popen("ls");\ntry {} catch (...) {}\n')
    expect(cpp.map(f => f.rule)).toContain('dangerous-call')
    const go = runChecks('go', 'exec.Command("ls")\n')
    expect(go.map(f => f.rule)).toContain('dangerous-call')
  })

  it('runs only common rules for unknown languages', () => {
    const findings = runChecks('unknown', 'os.system("x")')
    expect(findings.map(f => f.rule)).not.toContain('dangerous-call')
  })

  it('truncates long snippets and computes the right line', () => {
    const longComment = `# ${'x'.repeat(90)} TODO long\nos.system("ls")`
    const findings = runChecks('python', longComment)
    const todo = findings.find(f => f.rule === 'todos')!
    expect(todo.line).toBe(1)
    expect(todo.snippet!.endsWith('…')).toBe(true)
    expect(todo.snippet!.length).toBe(81)
  })

  it('disables a rule through the config', () => {
    const findings = runChecks('python', 'api_token = "abc"\n', { secrets: false })
    expect(findings.map(f => f.rule)).not.toContain('secrets')
  })
})

describe('quality score and limits', () => {
  it('penalizes findings by severity and floors at zero', () => {
    const base = { language: 'python' as const, functionCount: 0, maxFunctionComplexity: 0, findings: [] }
    expect(qualityScore(base)).toBe(100)
    expect(qualityScore({
      ...base,
      findings: [
        { rule: 'x', category: 'security' as const, severity: 'error' as const, line: 1, message: 'm' },
        { rule: 'y', category: 'maintainability' as const, severity: 'warning' as const, line: 2, message: 'm' },
        { rule: 'z', category: 'debugResidue' as const, severity: 'info' as const, line: 3, message: 'm' },
      ],
    })).toBe(85)
    expect(qualityScore({ ...base, functionCount: 2, maxFunctionComplexity: 12 })).toBe(95)
    expect(qualityScore({ ...base, functionCount: 1, maxFunctionComplexity: 25 })).toBe(90)
    expect(qualityScore({ ...base, findings: [
      { rule: 'x', category: 'security' as const, severity: 'error' as const, line: 1, message: 'm', snippet: 's' },
      { rule: 'x', category: 'security' as const, severity: 'error' as const, line: 1, message: 'm' },
    ] })).toBe(80)
  })

  it('resolveLimits applies defaults for omitted fields', () => {
    expect(resolveLimits()).toEqual({ maxCodeBytes: 1024 * 1024, maxFunctions: 1000, maxFindings: 100 })
    expect(resolveLimits({ maxFindings: 3 }).maxFindings).toBe(3)
  })
})

describe('analyze orchestrator', () => {
  it('produces a complete analysis record', () => {
    const a = analyze('service.py', PY)
    expect(a.language).toBe('python')
    expect(a.metrics.lines).toBeGreaterThan(0)
    expect(a.metrics.functions).toBeGreaterThanOrEqual(2)
    expect(a.metrics.classes).toBe(1)
    expect(a.qualityScore).toBeGreaterThanOrEqual(0)
    expect(a.qualityScore).toBeLessThanOrEqual(100)
    expect(Array.isArray(a.findings)).toBe(true)
    expect(Array.isArray(a.notes)).toBe(true)
  })

  it('produces a clean report with no findings', () => {
    const a = analyze('clean.ts', 'export function add(a: number, b: number): number {\n  return a + b;\n}\n')
    expect(a.findings).toHaveLength(0)
    expect(a.qualityScore).toBe(100)
  })

  it('notes unrecognized and functionless sources', () => {
    const unknown = analyze('data.txt', 'plain text')
    expect(unknown.language).toBe('unknown')
    expect(unknown.notes.join()).toContain('Language not detected')
    const clean = analyze('clean.ts', 'const x = 1;\n')
    expect(clean.notes.join()).toContain('No functions detected')
  })

  it('notes when functions or findings are capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => `def f${i}():\n    x${i} = "${'a'.repeat(40)}"  # TODO item ${i}`).join('\n')
    const a = analyze('f.py', many, { limits: { maxFindings: 5, maxFunctions: 1 } })
    expect(a.findings.length).toBeLessThanOrEqual(5)
    expect(a.notes.join()).toContain('Capped findings')
    expect(a.notes.join()).toContain('Capped function records')
  })

  it('notes a high-complexity function', () => {
    const complex = 'def f():\n    ' + Array.from({ length: 12 }, (_, i) => `if x${i}:`).join('\n    ') + '\n    return 0\n'
    const a = analyze('f.py', complex)
    expect(a.notes.join()).toContain('exceed the complexity 10 guideline')
  })

  it('throws LIMIT_EXCEEDED when the source is too large', () => {
    const big = 'a\n'.repeat(100_000)
    expect(() => analyze('x.py', big, { limits: { maxCodeBytes: 1000 } })).toThrow(/exceeding the 1000-byte limit/)
  })
})

describe('CodeService', () => {
  it('mounts on ctx.code and resolves fully-provided limits', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(CodeService, { maxCodeBytes: 1024, maxFunctions: 5, maxFindings: 3 })
    const a = ctx.code.analyze('sample.py', PY)
    expect(a.language).toBe('python')
    await fiber.dispose()
  })

  it('resolves default limits when no config fields are given', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(CodeService)
    const a = ctx.code.analyze('sample.py', PY, {})
    expect(a.language).toBe('python')
    await fiber.dispose()
  })

  it('applies per-call overrides and check toggles', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(CodeService, {})
    const a = ctx.code.analyze('sample.py', PY, { limits: { maxFindings: 3 }, checks: { todos: false } })
    expect(a.findings.length).toBeLessThanOrEqual(3)
    expect(a.findings.some(f => f.rule === 'todos')).toBe(false)
    await fiber.dispose()
  })

  it('applies defaultChecks when no per-call checks are given', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(CodeService, { defaultChecks: { todos: false } })
    const a = ctx.code.analyze('sample.py', PY)
    expect(a.findings.some(f => f.rule === 'todos')).toBe(false)
    await fiber.dispose()
  })

  it('accepts a raw empty config on direct construction', () => {
    const ctx = new Context()
    // Direct construction bypasses the Loader's Config-schema materialization, so
    // the config reaches the constructor raw: omitted max-* fields and a missing
    // defaultChecks exercise the partial-field and absent-check branches.
    const svc = new CodeService(ctx, {})
    const a = svc.analyze('a.py', PY)
    expect(a.language).toBe('python')
    expect(a.findings.length).toBeGreaterThanOrEqual(0)
  })
})

describe('code plugin entry', () => {
  it('exposes the plugin namespace and mounts the service', async () => {
    expect(codePlugin.name).toBe('code')
    expect(codePlugin.inject).toEqual([])
    const ctx = new Context()
    const fiber = await ctx.plugin(codePlugin, { maxCodeBytes: 1024 * 1024 })
    expect(ctx.code.analyze('a.py', PY).language).toBe('python')
    await fiber.dispose()
  })
})

describe('CodeError', () => {
  it('carries a stable code and optional details', () => {
    const err = new CodeError('boom', { code: 'INVALID_ARGUMENT', details: { field: 'source' } })
    expect(err.name).toBe('CodeError')
    expect(err.code).toBe('INVALID_ARGUMENT')
    expect(err.details).toEqual({ field: 'source' })
    expect(err.message).toBe('boom')
    const plain = new CodeError('nope', { code: 'UNSUPPORTED_LANGUAGE' })
    expect(plain.details).toBeUndefined()
  })
})

describe('engine invariant companion', () => {
  it('registers and disposes the package invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(codeInvariant)
    await fiber.dispose()
  })
})
