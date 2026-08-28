import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as toolExploration from '@deepseek-ai/dsh-tool-exploration'
import * as toolInvariant from '../src/invariant.ts'

const testToolSignal = new AbortController().signal

/** Small CSV well-log input: 3 rows x 3 numeric columns. */
const CSV = 'depth,gamma,rhob\n10,75,2.3\n20,80,2.4\n30,90,2.5\n'

/** Dataset-shaped JSON input accepted by the `json` format reader. */
const DATASET = {
  columns: [
    { name: 'depth', type: 'number', unit: 'm' },
    { name: 'gamma', type: 'number', unit: 'api' },
    { name: 'rhob', type: 'number', unit: 'g/cm3' },
  ],
  rows: [[10, 75, 2.3], [20, 80, 2.4], [30, 90, 2.5]],
  meta: { source: 'inline' },
}

/** Named pipeline whose first step is ingest, exercised by the run tool. */
const PIPELINE = {
  name: 'demo',
  description: 'Demo pipeline',
  steps: [
    { id: 's1', type: 'ingest', config: {} },
    { id: 's2', type: 'clean', config: { dedupe: true } },
    { id: 's3', type: 'extract', config: { statistics: {} } },
  ],
}

/** SEG-Y long-format section: 2 traces x 3 samples, exercised by the profile tool. */
const SECTION = {
  columns: [
    { name: 'trace', type: 'number' },
    { name: 'sampleIndex', type: 'number' },
    { name: 'value', type: 'number' },
  ],
  rows: [[0, 0, -1], [0, 1, 0], [0, 2, 1], [1, 0, 0], [1, 1, 1], [1, 2, 2]],
  meta: { source: 'line-1' },
}

/** Pipeline with a profile step that renders the parsed section automatically. */
const PROFILE_PIPELINE = {
  name: 'seismic',
  description: 'Parse and render a seismic section',
  steps: [
    { id: 's1', type: 'ingest', config: {} },
    { id: 's2', type: 'profile', config: { formats: ['png'] } },
  ],
}

/** Encode one IEEE float32 sample as little-endian bytes. */
function float32s(...values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4)
  const view = new DataView(buf.buffer)
  values.forEach((v, i) => { view.setFloat32(i * 4, v, false) })
  return buf
}

/** Build a minimal SEG-Y file: 3600-byte textual header + one 240-byte trace. */
function buildSegY(payload: Uint8Array, opts: { format: number; samplesPerTrace: number }): Uint8Array {
  const buf = new Uint8Array(3600 + payload.length)
  const view = new DataView(buf.buffer)
  view.setInt16(3216, 2000, false)
  view.setInt16(3220, opts.samplesPerTrace, false)
  view.setInt16(3224, opts.format, false)
  view.setInt16(3500, 0x0100, false)
  view.setInt16(3504, 0, false)
  buf.set(payload, 3600)
  return buf
}

/** One 3-sample IEEE float32 trace, base64-encoded for the tools' segy branch. */
const SEGY_BASE64 = (() => {
  const samples = float32s(1, 2, 3)
  const trace = new Uint8Array(240 + samples.length)
  trace.set(samples, 240)
  return Buffer.from(buildSegY(trace, { format: 5, samplesPerTrace: 3 })).toString('base64')
})()

/** Mount ToolRuntime plus the real exploration tool plugin body. */
async function harness(config: toolExploration.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(toolExploration, config)
  return { ctx, fiber }
}

let callCounter = 0
/** Dispatch one registered tool through the real runtime. */
function call(ctx: Context, name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
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

describe('tool-exploration plugin shape', () => {
  it('has the Loader-safe namespace export shape', () => {
    expect((toolExploration as { default?: unknown }).default).toBeUndefined()
    expect(toolExploration.name).toBe('tool-exploration')
    expect(toolExploration.inject).toEqual(['tools'])
  })

  it('registers seven exploration tools and disposes all contributions', async () => {
    const { ctx, fiber } = await harness()
    const names = ctx.tools.schemas()
      .map(schema => schema.name)
      .filter(name => name.startsWith('exploration_'))
      .sort()
    expect(names).toEqual([
      'exploration_clean', 'exploration_convert', 'exploration_detect',
      'exploration_extract', 'exploration_ingest', 'exploration_profile',
      'exploration_run',
    ])
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'exploration_ingest')).toBe(false)
  })

  it('resolves resource-limit defaults on direct apply', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // Bypass Loader normalization so every limit field stays undefined and the
    // per-field defaults in resolveConfig are taken.
    toolExploration.apply(ctx, {})
    const result = await call(ctx, 'exploration_ingest', { format: 'csv', data: CSV })
    expect(result.isError).toBe(false)
  })

  it('runs tools under explicit deployment limits', async () => {
    const { ctx } = await harness({ maxInputBytes: 1_000_000, maxRows: 100, maxColumns: 20, maxAnomalyRecords: 10 })
    const result = await call(ctx, 'exploration_ingest', { format: 'csv', data: CSV })
    expect(result.isError).toBe(false)
  })
})

describe('exploration_ingest', () => {
  it('parses CSV text into a dataset without a source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_ingest', { format: 'csv', data: CSV })
    const value = resultJson(result)
    expect(value.rowCount).toBe(3)
    expect(value.columnCount).toBe(3)
    expect(value.notes).toEqual(['ingested inline as csv (3 rows x 3 columns)'])
    const dataset = value.dataset as { columns: { name: string }[]; rows: unknown[][]; meta: Record<string, unknown> }
    expect(dataset.columns.map(column => column.name)).toEqual(['depth', 'gamma', 'rhob'])
    expect(dataset.rows).toEqual([[10, 75, 2.3], [20, 80, 2.4], [30, 90, 2.5]])
    expect(resultText(result)).toContain('Ingested csv as 3 rows x 3 columns')
  })

  it('accepts an ingest config and source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_ingest', {
      format: 'json',
      data: JSON.stringify(DATASET),
      source: 'well-A',
      config: { trim: true },
    })
    const value = resultJson(result)
    expect(value.rowCount).toBe(3)
    const dataset = value.dataset as { meta: Record<string, unknown> }
    expect(dataset.meta.source).toBe('well-A')
  })

  it('decodes base64 SEG-Y bytes', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_ingest', { format: 'segy', data: SEGY_BASE64 })
    const value = resultJson(result)
    expect((value.rowCount as number)).toBeGreaterThan(0)
    expect((value.columnCount as number)).toBeGreaterThan(0)
  })

  it('rejects an unsupported format', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_ingest', { format: 'xml', data: '<a/>' })
    expect(result.isError).toBe(true)
  })
})

describe('exploration_clean', () => {
  it('cleans a dataset with dedupe', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_clean', { dataset: DATASET, config: { dedupe: true } })
    const value = resultJson(result)
    expect(value.rowCount).toBe(3)
    expect(value.columnCount).toBe(3)
    expect(resultText(result)).toContain('Cleaned to 3 rows x 3 columns')
  })

  it('rejects an invalid clean config', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_clean', { dataset: DATASET, config: { missing: { action: 'fill' } } })
    expect(result.isError).toBe(true)
  })
})

describe('exploration_convert', () => {
  it('selects columns', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_convert', { dataset: DATASET, config: { selectColumns: ['depth', 'gamma'] } })
    const value = resultJson(result)
    const dataset = value.dataset as { columns: { name: string }[] }
    expect(dataset.columns.map(column => column.name)).toEqual(['depth', 'gamma'])
    expect(resultText(result)).toContain('Converted to 3 rows x 2 columns')
  })
})

describe('exploration_extract', () => {
  it('computes descriptive statistics', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_extract', { dataset: DATASET, config: { statistics: {} } })
    const value = resultJson(result)
    expect(value.rowCount).toBe(3)
    expect(resultText(result)).toContain('Extracted statistics over 3 rows')
  })
})

describe('exploration_detect', () => {
  it('detects z-score anomalies', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_detect', {
      dataset: DATASET,
      config: { zscore: [{ column: 'gamma', threshold: 2 }] },
    })
    const value = resultJson(result)
    expect(value.rowCount).toBe(3)
    expect(resultText(result)).toContain('Detected anomalies in 3 rows')
  })
})

describe('exploration_profile', () => {
  it('renders a PNG and SVG section from a seismic dataset', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_profile', {
      dataset: SECTION,
      config: { formats: ['png', 'svg'], width: 32, height: 16, title: 'line-1' },
    })
    const value = resultJson(result)
    const profile = value.profile as { formats: string[]; svg: string; png: string; traceCount: number; sampleCount: number }
    expect(profile.formats).toEqual(['png', 'svg'])
    expect(profile.traceCount).toBe(2)
    expect(profile.sampleCount).toBe(3)
    expect(profile.svg).toContain('data:image/png;base64,')
    expect(profile.png).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(resultText(result)).toContain('Profile rendered')
  })

  it('rejects an invalid profile config', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_profile', { dataset: SECTION, config: { width: 0 } })
    expect(result.isError).toBe(true)
  })

  it('fails loud on a non-seismic dataset', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_profile', { dataset: DATASET, config: { formats: ['png'] } })
    expect(result.isError).toBe(true)
  })
})

describe('exploration_run', () => {
  it('runs a full CSV pipeline without a source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_run', { format: 'csv', data: CSV, pipeline: PIPELINE })
    const value = resultJson(result)
    expect(value.status).toBe('completed')
    expect(value.pipelineName).toBe('demo')
    expect((value.steps as unknown[]).length).toBe(3)
    expect(value.outputSummary).toMatchObject({ shape: '3 x 3', rowCount: 3 })
    expect(resultText(result)).toContain('[demo] completed: 3 steps, output 3 x 3')
  })

  it('runs a SEG-Y pipeline with a source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_run', {
      format: 'segy',
      data: SEGY_BASE64,
      source: 'line-1',
      pipeline: PIPELINE,
    })
    const value = resultJson(result)
    expect(value.status).toBe('completed')
  })

  it('rejects an invalid pipeline', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_run', {
      format: 'csv',
      data: CSV,
      pipeline: { name: 'x', steps: [] },
    })
    expect(result.isError).toBe(true)
  })

  it('renders a section through a pipeline profile step', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_run', {
      format: 'json',
      data: JSON.stringify(SECTION),
      pipeline: PROFILE_PIPELINE,
    })
    const value = resultJson(result)
    expect(value.status).toBe('completed')
    const profile = (value.output as { meta: { profile: { formats: string[]; png: string } } }).meta.profile
    expect(profile.formats).toEqual(['png'])
    expect(typeof profile.png).toBe('string')
    expect(resultText(result)).toContain('with profile')
  })

  it('pauses the run and records INCOMPLETE_DATA when the section is incomplete', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'exploration_run', {
      format: 'csv',
      data: CSV,
      pipeline: PROFILE_PIPELINE,
    })
    const value = resultJson(result)
    expect(value.status).toBe('failed')
    expect(value.error).toMatchObject({ code: 'INCOMPLETE_DATA', stepId: 's2' })
    const steps = value.steps as { id: string; status: string; error?: string }[]
    expect(steps[1]).toMatchObject({ id: 's2', status: 'failed' })
    expect(steps[1]?.error).toContain('no seismic columns')
    expect(resultText(result)).toContain('failed')
  })
})

describe('tool call presentation', () => {
  it('declares a generic pending card for every exploration tool', async () => {
    const { ctx } = await harness()
    const cases: [string, string, unknown][] = [
      ['exploration_ingest', 'Ingest exploration data', { format: 'csv', data: 'a,b\n1,2' }],
      ['exploration_clean', 'Clean exploration dataset', { dataset: DATASET, config: {} }],
      ['exploration_convert', 'Convert exploration dataset', { dataset: DATASET, config: {} }],
      ['exploration_extract', 'Extract exploration statistics', { dataset: DATASET, config: {} }],
      ['exploration_detect', 'Detect exploration anomalies', { dataset: DATASET, config: {} }],
      ['exploration_profile', 'Render seismic profile', { dataset: SECTION, config: { formats: ['png'] } }],
      ['exploration_run', 'Run exploration pipeline', { format: 'csv', data: 'a,b\n1,2', pipeline: PIPELINE }],
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

describe('tool-exploration invariant companion', () => {
  it('registers and disposes the package invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(toolInvariant)
    await fiber.dispose()
  })
})
