import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as plugin from '../src/index.ts'
import * as paperInvariant from '../src/invariant.ts'
import { runPipeline, validatePipeline } from '../src/pipeline.ts'
import { PaperService } from '../src/service.ts'
import type { Limits, ProcessingInput } from '../src/types.ts'

const LIMITS: Limits = { maxInputBytes: 1_000_000, maxSections: 50, maxParagraphs: 50, maxCitations: 30, maxFindings: 50 }
const MANUSCRIPT: ProcessingInput = {
  format: 'markdown',
  data: '# A Paper\n\n## Abstract\n\nAbstract text.\n\n## Intro\n\nDue to the fact that it matters.\n\n## References\n\n[1] Smith, J. (2020). A study of paper. Journal of Science, 12(3), 45-60.',
  source: 'paper.md',
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function qcPipeline() {
  return validatePipeline({
    name: 'manuscript-qc',
    steps: [
      { id: 'ingest', type: 'ingest', config: {}, description: 'parse manuscript' },
      { id: 'revise', type: 'revise', config: {} },
    ],
  })
}

describe('validatePipeline', () => {
  it('validates a full pipeline definition', () => {
    const pipeline = qcPipeline()
    expect(pipeline.name).toBe('manuscript-qc')
    expect(pipeline.steps).toHaveLength(2)
    expect((pipeline.steps[0] as PipelineStepLike).description).toBe('parse manuscript')
  })

  it('rejects malformed pipelines', () => {
    expect(() => validatePipeline(42)).toThrow(/must be an object/)
    expect(() => validatePipeline({ name: 'x', steps: [], nope: 1 })).toThrow(/unknown pipeline option/)
    expect(() => validatePipeline({ name: 'x', steps: [] })).toThrow(/must not be empty/)
    expect(() => validatePipeline({ name: 'x', steps: [
      { id: 'a', type: 'ingest', config: {} },
      { id: 'a', type: 'revise', config: {} },
    ] })).toThrow(/duplicate step id/)
    expect(() => validatePipeline({ name: 'x', steps: [{ id: 'r', type: 'revise', config: {} }] }))
      .toThrow(/must start with an ingest step/)
    expect(() => validatePipeline({ name: 'x', steps: [{ id: 'i', type: 'nope', config: {} }] }))
      .toThrow(/must be one of ingest, revise, format, cite/)
  })
})

describe('runPipeline', () => {
  it('runs a full pipeline and records traceability', () => {
    const record = runPipeline(MANUSCRIPT, qcPipeline(), LIMITS, 'run-1')
    expect(record.status).toBe('completed')
    expect(record.runId).toBe('run-1')
    expect(record.pipelineName).toBe('manuscript-qc')
    expect(record.steps).toHaveLength(2)
    expect(record.steps[0]).toMatchObject({ id: 'ingest', type: 'ingest', status: 'completed', description: 'parse manuscript' })
    expect(record.steps[0]?.inputHash).toBe(record.input.checksum)
    expect(record.input).toMatchObject({ format: 'markdown' })
    expect(record.output.meta.provenance).toHaveLength(2)
    expect(record.output.meta.provenance?.[0]).toContain('ingested paper.md')
    expect(record.outputSummary).toMatchObject({ sectionCount: 1 })
    expect(record.durationMs).toBeGreaterThanOrEqual(0)
    expect(record.error).toBeUndefined()
  })

  it('captures a failing step without aborting the run', () => {
    const pipeline = validatePipeline({
      name: 'x',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'r', type: 'revise', config: {} },
      ],
    })
    ;(pipeline.steps[1] as { config: unknown }).config = new Proxy({}, { get: () => { throw 'boom' } })
    const record = runPipeline({ format: 'text', data: 'body' }, pipeline, LIMITS, 'run-2')
    expect(record.status).toBe('failed')
    expect(record.error).toMatchObject({ code: 'DATA_ERROR', stepId: 'r', message: 'boom' })
    expect(record.steps[1]?.status).toBe('failed')
  })

  it('records the description of a failing step', () => {
    const pipeline = validatePipeline({
      name: 'x',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'r', type: 'revise', config: {}, description: 'revise step' },
      ],
    })
    ;(pipeline.steps[1] as { config: unknown }).config = new Proxy({}, { get: () => { throw new Error('kaboom') } })
    const record = runPipeline({ format: 'text', data: 'body' }, pipeline, LIMITS, 'run-desc')
    expect(record.status).toBe('failed')
    expect(record.steps[1]).toMatchObject({ description: 'revise step', status: 'failed', error: 'kaboom' })
  })

  it('enforces section and citation limits after a step', () => {
    const record = runPipeline(MANUSCRIPT, qcPipeline(), { ...LIMITS, maxSections: 0 }, 'run-lim')
    expect(record.status).toBe('failed')
    expect(record.error?.code).toBe('LIMIT_EXCEEDED')
    expect(record.error?.stepId).toBe('ingest')
  })

  it('captures an ingest failure and falls back to an empty paper', () => {
    const pipeline = validatePipeline({ name: 'x', steps: [{ id: 'i', type: 'ingest', config: {} }] })
    const record = runPipeline({ format: 'text', data: 'data' }, pipeline, undefined as unknown as Limits, 'run-5')
    expect(record.status).toBe('failed')
    expect(record.error?.stepId).toBe('i')
    expect(record.output.sections).toHaveLength(0)
  })
})

describe('PaperService', () => {
  it('registers, lists, and runs named pipelines', () => {
    const ctx = new Context()
    const service = new PaperService(ctx, { maxSections: 100, maxFindings: 10 })
    service.registerPipeline({ name: 'qc', steps: [{ id: 'ingest', type: 'ingest', config: {} }] })
    expect(service.listPipelines().map(p => p.name)).toEqual(['qc'])

    const record = service.run('qc', { format: 'text', data: 'body' })
    expect(record.status).toBe('completed')
    expect(record.runId).toMatch(UUID_RE)

    expect(() => { service.registerPipeline({ name: 'qc', steps: [{ id: 'ingest', type: 'ingest', config: {} }] }) })
      .toThrow(/already registered/)
    expect(() => service.run('nope', { format: 'text', data: 'body' })).toThrow(/unknown pipeline/)

    const oneOff = service.runPipeline({ format: 'text', data: 'body' }, { name: 'one', steps: [{ id: 'ingest', type: 'ingest', config: {} }] })
    expect(oneOff.status).toBe('completed')
    expect(oneOff.pipelineName).toBe('one')
    expect(() => service.runPipeline({ format: 'text', data: 'body' }, { name: 'bad', steps: [] }))
      .toThrow(/must not be empty/)
  })

  it('applies defaults when configuration is omitted', () => {
    const ctx = new Context()
    const service = new PaperService(ctx)
    const record = service.runPipeline({ format: 'text', data: 'body' }, { name: 'x', steps: [{ id: 'ingest', type: 'ingest', config: {} }] })
    expect(record.status).toBe('completed')
  })
})

describe('paper plugin', () => {
  it('exposes the standard plugin metadata', () => {
    expect(plugin.name).toBe('paper')
    expect(plugin.inject).toEqual([])
    expect(plugin.Config).toBeDefined()
  })

  it('mounts the service and registers configured pipelines', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {
      pipelines: [{ name: 'qc', steps: [{ id: 'ingest', type: 'ingest', config: {} }] }],
    })
    expect(ctx.paper).toBeInstanceOf(PaperService)
    expect(ctx.paper.listPipelines().map(p => p.name)).toEqual(['qc'])
    expect(ctx.paper.run('qc', { format: 'text', data: 'body' }).status).toBe('completed')
    await fiber.dispose()
  })

  it('mounts without configured pipelines', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(plugin, {})
    expect(ctx.paper.listPipelines()).toEqual([])
    await fiber.dispose()
  })
})

describe('paper invariant companion', () => {
  it('registers and disposes the package invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(paperInvariant)
    await fiber.dispose()
  })
})

interface PipelineStepLike {
  description?: string
}
