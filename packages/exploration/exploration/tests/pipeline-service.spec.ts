import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { runPipeline, validatePipeline } from '../src/pipeline.ts'
import { ExplorationService } from '../src/service.ts'
import type { Limits, Pipeline, ProcessingInput } from '../src/types.ts'
import * as plugin from '../src/index.ts'

const LIMITS: Limits = { maxInputBytes: 1_000_000, maxRows: 1000, maxColumns: 100, maxAnomalyRecords: 500 }
const CSV: ProcessingInput = { format: 'csv', data: 'a,b\n1,2\n1,2', source: 'f.csv' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('validatePipeline', () => {
  it('validates a full pipeline definition', () => {
    const pipeline = validatePipeline({
      name: 'demo',
      description: 'a demo pipeline',
      steps: [
        { id: 'i', type: 'ingest', config: {}, description: 'load csv' },
        { id: 'c', type: 'clean', config: { dedupe: true } },
      ],
    })
    expect(pipeline.name).toBe('demo')
    expect(pipeline.description).toBe('a demo pipeline')
    expect(pipeline.steps).toHaveLength(2)
    expect(pipeline.steps[0]?.description).toBe('load csv')
  })

  it('rejects malformed pipelines', () => {
    expect(() => validatePipeline(42)).toThrow(/must be an object/)
    expect(() => validatePipeline({ name: 'x', steps: [], nope: 1 })).toThrow(/unknown pipeline option/)
    expect(() => validatePipeline({ name: 'x', steps: [] })).toThrow(/must not be empty/)
    expect(() => validatePipeline({ name: 'x', steps: [
      { id: 'a', type: 'ingest', config: {} },
      { id: 'a', type: 'clean', config: {} },
    ] })).toThrow(/duplicate step id/)
    expect(() => validatePipeline({ name: 'x', steps: [{ id: 'c', type: 'clean', config: {} }] }))
      .toThrow(/must start with an ingest step/)
    expect(() => validatePipeline({ name: 'x', steps: [{ id: 'i', type: 'ingest', config: {} }], bad: 1 }))
      .toThrow(/unknown pipeline option/)
  })
})

describe('runPipeline', () => {
  const demo: Pipeline = validatePipeline({
    name: 'demo',
    steps: [
      { id: 'i', type: 'ingest', config: {}, description: 'load csv' },
      { id: 'c', type: 'clean', config: { dedupe: true } },
    ],
  })

  it('runs a full pipeline and records traceability', () => {
    const record = runPipeline(CSV, demo, LIMITS, 'run-1')
    expect(record.status).toBe('completed')
    expect(record.runId).toBe('run-1')
    expect(record.pipelineName).toBe('demo')
    expect(record.steps).toHaveLength(2)
    expect(record.steps[0]).toMatchObject({ id: 'i', type: 'ingest', status: 'completed', description: 'load csv' })
    expect(record.steps[1]).toMatchObject({ id: 'c', type: 'clean', status: 'completed' })
    expect(record.steps[0]?.inputHash).toBe(record.input.checksum)
    expect(record.steps[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(record.input).toMatchObject({ format: 'csv', rowCount: 0, bytes: 11 })
    expect(record.output.meta.provenance).toHaveLength(2)
    expect(record.output.meta.provenance?.[0]).toContain('ingested f.csv as csv')
    expect(record.output.meta.provenance?.[1]).toContain('(clean)')
    expect(record.outputSummary).toMatchObject({ rowCount: 1, columnCount: 2, shape: '1 x 2' })
    expect(record.durationMs).toBeGreaterThanOrEqual(0)
    expect(record.error).toBeUndefined()
  })

  it('captures a failing step without aborting the run', () => {
    const pipeline = validatePipeline({
      name: 'x',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'u', type: 'convert', config: { units: [{ column: 'a', from: 'm', to: 'nope' }] } },
      ],
    })
    const record = runPipeline({ format: 'csv', data: 'a\n1' }, pipeline, LIMITS, 'run-2')
    expect(record.status).toBe('failed')
    expect(record.error).toMatchObject({ code: 'VALIDATION_ERROR', stepId: 'u' })
    expect(record.steps).toHaveLength(2)
    expect(record.steps[0]?.status).toBe('completed')
    expect(record.steps[1]?.status).toBe('failed')
    expect(record.steps[1]?.error).toContain('unknown unit')
    expect(record.output.rows).toEqual([[1]])
  })

  it('enforces the row and column limits', () => {
    const ingestOnly = validatePipeline({ name: 'x', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    const tooManyRows = runPipeline({ format: 'csv', data: 'a\n1\n2\n3' }, ingestOnly, { ...LIMITS, maxRows: 2 }, 'run-3')
    expect(tooManyRows.status).toBe('failed')
    expect(tooManyRows.error?.code).toBe('LIMIT_EXCEEDED')
    expect(tooManyRows.error?.stepId).toBe('i')
    expect(tooManyRows.output.rows).toHaveLength(0)

    const tooManyCols = runPipeline({ format: 'csv', data: 'a,b,c\n1,2,3' }, ingestOnly, { ...LIMITS, maxColumns: 2 }, 'run-4')
    expect(tooManyCols.status).toBe('failed')
    expect(tooManyCols.error?.code).toBe('LIMIT_EXCEEDED')
  })

  it('normalizes non-ExplorationError step failures', () => {
    const ingestOnly = validatePipeline({ name: 'x', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    const typeError = runPipeline({ format: 'csv', data: 'a\n1' }, ingestOnly, undefined as unknown as Limits, 'run-5')
    expect(typeError.status).toBe('failed')
    expect(typeError.error).toMatchObject({ code: 'DATA_ERROR', stepId: 'i' })

    const pipeline = validatePipeline({
      name: 'x',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'c', type: 'clean', config: {} },
      ],
    })
    ;(pipeline.steps[1] as { config: unknown }).config = new Proxy({}, { get: () => { throw 'boom' } })
    const thrown = runPipeline({ format: 'csv', data: 'a\n1' }, pipeline, LIMITS, 'run-6')
    expect(thrown.status).toBe('failed')
    expect(thrown.error?.message).toBe('boom')
  })

  it('records the description of a failing step', () => {
    const pipeline = validatePipeline({
      name: 'x',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'u', type: 'convert', config: { units: [{ column: 'a', from: 'm', to: 'nope' }] }, description: 'unit step' },
      ],
    })
    const record = runPipeline({ format: 'csv', data: 'a\n1' }, pipeline, LIMITS, 'run-desc')
    expect(record.status).toBe('failed')
    expect(record.steps[1]).toMatchObject({ description: 'unit step', status: 'failed' })
  })

  it('records a pipeline description on the run record', () => {
    const pipeline = validatePipeline({
      name: 'x',
      description: 'a described pipeline',
      steps: [{ id: 'i', type: 'ingest', config: {} }],
    })
    const record = runPipeline({ format: 'csv', data: 'a\n1' }, pipeline, LIMITS, 'run-pd')
    expect(record.status).toBe('completed')
    expect(record.pipelineDescription).toBe('a described pipeline')
  })

  it('accepts raw byte input', () => {
    const ingestOnly = validatePipeline({ name: 'x', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    const record = runPipeline({ format: 'csv', data: new TextEncoder().encode('a\n1') }, ingestOnly, LIMITS, 'run-bytes')
    expect(record.status).toBe('completed')
    expect(record.output.rows).toEqual([[1]])
  })

  it('emits a plain provenance line for steps without notes', () => {
    const pipeline = validatePipeline({
      name: 'x',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'c', type: 'clean', config: {} },
      ],
    })
    const record = runPipeline({ format: 'csv', data: 'a\n1' }, pipeline, LIMITS, 'run-nn')
    expect(record.status).toBe('completed')
    expect(record.output.meta.provenance?.[1]).toBe('c (clean)')
  })

  it('runs a profile step and attaches the render to the output meta', () => {
    const pipeline = validatePipeline({
      name: 'seismic',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'p', type: 'profile', config: { formats: ['png'], width: 16, height: 8 } },
      ],
    })
    const input: ProcessingInput = {
      format: 'json',
      data: JSON.stringify({
        columns: [
          { name: 'trace', type: 'number' },
          { name: 'sampleIndex', type: 'number' },
          { name: 'value', type: 'number' },
        ],
        rows: [[0, 0, -1], [0, 1, 1], [1, 0, 0], [1, 1, 2]],
        meta: {},
      }),
    }
    const record = runPipeline(input, pipeline, LIMITS, 'run-profile')
    expect(record.status).toBe('completed')
    expect(record.steps[1]).toMatchObject({ id: 'p', type: 'profile', status: 'completed' })
    const profile = record.output.meta.profile as { kind: string; formats: string[]; traceCount: number; sampleCount: number }
    expect(profile).toMatchObject({ kind: 'seismic', formats: ['png'], traceCount: 2, sampleCount: 2 })
    expect(record.output.meta.provenance?.[1]).toContain('(profile)')
  })

  it('pauses the run and records INCOMPLETE_DATA on an incomplete profile step', () => {
    const pipeline = validatePipeline({
      name: 'seismic',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'p', type: 'profile', config: {} },
      ],
    })
    const record = runPipeline(CSV, pipeline, LIMITS, 'run-incomplete')
    expect(record.status).toBe('failed')
    expect(record.error).toMatchObject({ code: 'INCOMPLETE_DATA', stepId: 'p' })
    expect(record.steps[1]?.status).toBe('failed')
    expect(record.steps[1]?.error).toContain('no seismic columns')
    expect(record.output.meta.profile).toBeUndefined()
  })
})

describe('ExplorationService', () => {
  it('registers, lists, and runs named pipelines', () => {
    const ctx = new Context()
    const service = new ExplorationService(ctx, { maxRows: 1000, maxColumns: 100, maxAnomalyRecords: 10 })
    service.registerPipeline({ name: 'demo', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    expect(service.listPipelines().map(p => p.name)).toEqual(['demo'])

    const record = service.run('demo', { format: 'csv', data: 'a\n1' })
    expect(record.status).toBe('completed')
    expect(record.runId).toMatch(UUID_RE)

    expect(() => { service.registerPipeline({ name: 'demo', steps: [{ id: 'i', type: 'ingest', config: {} }] }) })
      .toThrow(/already registered/)
    expect(() => service.run('nope', { format: 'csv', data: 'a\n1' })).toThrow(/unknown pipeline/)

    const oneOff = service.runPipeline({ format: 'csv', data: 'a\n1' }, { name: 'one', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    expect(oneOff.status).toBe('completed')
    expect(oneOff.pipelineName).toBe('one')
    expect(() => service.runPipeline({ format: 'csv', data: 'a\n1' }, { name: 'bad', steps: [] }))
      .toThrow(/must not be empty/)
  })

  it('applies defaults when configuration is omitted', () => {
    const ctx = new Context()
    const service = new ExplorationService(ctx)
    const record = service.runPipeline({ format: 'csv', data: 'a\n1' }, { name: 'x', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    expect(record.status).toBe('completed')
  })
})

describe('exploration plugin', () => {
  it('exposes the standard plugin metadata', () => {
    expect(plugin.name).toBe('exploration')
    expect(plugin.inject).toEqual([])
    expect(plugin.Config).toBeDefined()
  })

  it('mounts the service and registers configured pipelines', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {
      maxRows: 1000,
      pipelines: [{ name: 'demo', steps: [{ id: 'i', type: 'ingest', config: {} }] }],
    })
    expect(ctx.exploration).toBeInstanceOf(ExplorationService)
    expect(ctx.exploration.listPipelines().map(p => p.name)).toEqual(['demo'])
    const record = ctx.exploration.run('demo', { format: 'csv', data: 'a\n1' })
    expect(record.status).toBe('completed')
    await fiber.dispose()
  })

  it('mounts without configured pipelines', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {})
    expect(ctx.exploration.listPipelines()).toEqual([])
    await fiber.dispose()
  })
})
