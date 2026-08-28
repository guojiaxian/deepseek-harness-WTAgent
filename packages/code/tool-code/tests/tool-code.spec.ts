import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as toolCode from '@deepseek-ai/dsh-tool-code'
import * as toolInvariant from '../src/invariant.ts'

const testToolSignal = new AbortController().signal

const PY = `import os
def run(cmd):
    os.system(cmd)  # TODO audit
    return 0
`

/** Mount ToolRuntime plus the real code tool plugin body. */
async function harness(config: toolCode.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(toolCode, config)
  return { ctx, fiber }
}

let callCounter = 0
/** Dispatch one registered tool through the real runtime. */
function call(ctx: Context, name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

/** Assert success and return the canonical JSON value. */
function resultJson(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected tool success')
  return result.value as Record<string, unknown>
}

/** Join the text blocks of one tool result. */
function resultText(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-code plugin shape', () => {
  it('has the Loader-safe namespace export shape', () => {
    expect((toolCode as { default?: unknown }).default).toBeUndefined()
    expect(toolCode.name).toBe('tool-code')
    expect(toolCode.inject).toEqual(['tools'])
  })

  it('registers both code tools and disposes all contributions', async () => {
    const { ctx, fiber } = await harness()
    const names = ctx.tools.schemas()
      .map(schema => schema.name)
      .filter(name => name.startsWith('code_'))
      .sort()
    expect(names).toEqual(['code_analyze', 'code_check'])
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'code_analyze')).toBe(false)
  })

  it('materializes defaults when apply runs a raw partial config', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // Calling apply directly (bypassing Loader schema normalization) keeps the
    // config raw, so resolveLimits falls back to the engine DEFAULT_* limits.
    toolCode.apply(ctx, {})
    const result = await call(ctx, 'code_check', { fileName: 'a.py', source: 'x = 1' })
    expect(result.isError).toBe(false)
  })
})

describe('code_analyze', () => {
  it('returns a full analysis record with a render summary', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'code_analyze', { fileName: 'service.py', source: PY })
    const value = resultJson(result)
    expect(value.language).toBe('python')
    expect(typeof value.qualityScore).toBe('number')
    const metrics = value.metrics as Record<string, unknown>
    expect(metrics.functions).toBeGreaterThanOrEqual(1)
    expect(resultText(result)).toContain('Analyzed python')
  })

  it('honors per-call check toggles', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'code_analyze', {
      fileName: 'service.py',
      source: PY,
      checks: { todos: false, dangerous: false },
    })
    const value = resultJson(result)
    const findings = value.findings as { rule: string }[]
    expect(findings.some(f => f.rule === 'todos')).toBe(false)
    expect(findings.some(f => f.rule === 'dangerous-call')).toBe(false)
  })
})

describe('code_check', () => {
  it('returns findings with severity counts', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'code_check', { fileName: 'service.py', source: PY })
    const value = resultJson(result)
    expect(value.language).toBe('python')
    expect(value.findingCount).toBeGreaterThanOrEqual(2)
    const findings = value.findings as { rule: string; line: number }[]
    expect(findings.some(f => f.rule === 'dangerous-call')).toBe(true)
    expect(findings.some(f => f.rule === 'todos')).toBe(true)
    expect(resultText(result)).toContain('Checked code:')
  })

  it('counts all three severities', async () => {
    const { ctx } = await harness()
    const src = 'import pdb\nos.system("ls") # TODO audit\npdb.set_trace()\n'
    const result = await call(ctx, 'code_check', { fileName: 'pain.py', source: src })
    const value = resultJson(result)
    expect(value.errorCount).toBeGreaterThan(0)
    expect(value.warningCount).toBeGreaterThan(0)
    expect(value.infoCount).toBeGreaterThan(0)
  })

  it('fails loud on oversized input', async () => {
    const { ctx } = await harness({ maxCodeBytes: 100 })
    const result = await call(ctx, 'code_check', { fileName: 'big.py', source: 'a\n'.repeat(100) })
    expect(result.isError).toBe(true)
  })
})

describe('tool budget configuration', () => {
  it('honors fully-specified resource limits', async () => {
    const { ctx } = await harness({ maxCodeBytes: 512, maxFunctions: 3, maxFindings: 2 })
    const result = await call(ctx, 'code_analyze', { fileName: 'limit.py', source: PY })
    const value = resultJson(result)
    expect(value.language).toBe('python')
    const check = await call(ctx, 'code_check', { fileName: 'limit.py', source: 'a\n'.repeat(300) })
    expect(check.isError).toBe(true)
  })

  it('ignores non-flag check keys and non-boolean toggles', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'code_analyze', {
      fileName: 'service.py',
      source: PY,
      checks: { bogus: true, todos: 'no' },
    })
    const value = resultJson(result)
    const findings = value.findings as { rule: string }[]
    expect(findings.some(f => f.rule === 'todos')).toBe(true)
  })

  it('treats a non-object checks payload as no toggles', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'code_analyze', { fileName: 'a.py', source: 'x = 1', checks: 5 } as never)
    expect(result.isError).toBe(false)
  })
})

describe('tool call presentation', () => {
  it('declares a generic pending card for both code tools', async () => {
    const { ctx } = await harness()
    const cases: [string, string, unknown][] = [
      ['code_analyze', 'Analyze source code', { fileName: 'a.py', source: 'x = 1' }],
      ['code_check', 'Check source code', { fileName: 'a.py', source: 'x = 1' }],
    ]
    for (const [name, title, args] of cases) {
      const definition = ctx.tools.get(name)!
      expect(definition.presentCall?.(args as never)).toEqual({
        card: 'generic',
        title,
        kind: 'other',
        rawInput: args,
      })
    }
  })
})

describe('tool-code invariant companion', () => {
  it('registers and disposes the package invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(toolInvariant)
    await fiber.dispose()
  })
})
