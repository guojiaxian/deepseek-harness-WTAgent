import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as toolPaper from '@deepseek-ai/dsh-tool-paper'
import * as toolInvariant from '../src/invariant.ts'

const testToolSignal = new AbortController().signal

/** Small Markdown manuscript with two references. */
const MANUSCRIPT = [
  '# A Study',
  '',
  '## Abstract',
  '',
  'Abstract text.',
  '',
  '## Method',
  '',
  'Due to the fact that the results were obtained.',
  '',
  '## References',
  '',
  '[1] Smith, J. (2020). A study of paper. Journal of Science, 12(3), 45-60.',
  '[2] Doe, A. (2019). Another work. Some Journal, 2(1), 5-9.',
].join('\n')

/** Paper-shaped JSON accepted by the transform tools and returned by ingest. */
const PAPER = {
  title: 'A Study',
  abstract: 'Abstract text.',
  sections: [
    { kind: 'heading', heading: 'Method', paragraphs: ['Due to the fact that the results were obtained.'] },
  ],
  citations: [
    { id: '1', raw: 'Smith, J. (2020). A study of paper. Journal of Science, 12(3), 45-60.' },
    { id: '2', raw: 'Doe, A. (2019). Another work. Some Journal, 2(1), 5-9.' },
  ],
  meta: {},
}

/** Named pipeline whose first step is ingest, exercised by the run tool. */
const PIPELINE = {
  name: 'manuscript-qc',
  description: 'Manuscript QC pipeline',
  steps: [
    { id: 's1', type: 'ingest', config: {} },
    { id: 's2', type: 'revise', config: {} },
    { id: 's3', type: 'format', config: {} },
    { id: 's4', type: 'cite', config: { style: 'apa' } },
  ],
}

/** Mount ToolRuntime plus the real paper tool plugin body. */
async function harness(config: toolPaper.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(toolPaper, config)
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

describe('tool-paper plugin shape', () => {
  it('has the Loader-safe namespace export shape', () => {
    expect((toolPaper as { default?: unknown }).default).toBeUndefined()
    expect(toolPaper.name).toBe('tool-paper')
    expect(toolPaper.inject).toEqual(['tools'])
  })

  it('registers six paper tools and disposes all contributions', async () => {
    const { ctx, fiber } = await harness()
    const names = ctx.tools.schemas()
      .map(schema => schema.name)
      .filter(name => name.startsWith('paper_'))
      .sort()
    expect(names).toEqual([
      'paper_cite', 'paper_export', 'paper_format', 'paper_ingest', 'paper_revise', 'paper_run',
    ])
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'paper_ingest')).toBe(false)
  })

  it('resolves resource-limit defaults on direct apply', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // Bypass Loader normalization so every limit field stays undefined and the
    // per-field defaults in resolveConfig are taken.
    toolPaper.apply(ctx, {})
    const result = await call(ctx, 'paper_ingest', { format: 'markdown', data: MANUSCRIPT })
    expect(result.isError).toBe(false)
  })

  it('runs tools under explicit deployment limits', async () => {
    const { ctx } = await harness({ maxInputBytes: 1_000_000, maxSections: 100, maxParagraphs: 100, maxCitations: 50, maxFindings: 50 })
    const result = await call(ctx, 'paper_ingest', { format: 'markdown', data: MANUSCRIPT })
    expect(result.isError).toBe(false)
  })
})

describe('paper_ingest', () => {
  it('parses Markdown text into a paper without a source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_ingest', { format: 'markdown', data: MANUSCRIPT })
    const value = resultJson(result)
    expect(value.sectionCount).toBe(1)
    expect(value.citationCount).toBe(2)
    expect(value.notes).toEqual(['ingested inline as markdown: 1 sections, 2 references'])
    const paper = value.paper as { title: string; abstract: string; meta: Record<string, unknown> }
    expect(paper.title).toBe('A Study')
    expect(paper.abstract).toBe('Abstract text.')
    expect(resultText(result)).toContain('Ingested markdown as 1 sections, 2 references')
  })

  it('accepts an ingest config and source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_ingest', {
      format: 'text',
      data: 'Plain title line.\n\nBody text.',
      source: 'paper-a',
      config: { markdownHeadings: false },
    })
    const value = resultJson(result)
    expect(value.sectionCount).toBeGreaterThanOrEqual(1)
  })

  it('rejects an unsupported format', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_ingest', { format: 'xml', data: '<a/>' })
    expect(result.isError).toBe(true)
  })

  it('projects a paper with neither title nor abstract', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_ingest', { format: 'text', data: 'Body text.', config: { detectTitle: false } })
    const value = resultJson(result)
    const paper = value.paper as { title?: string; abstract?: string }
    expect(paper.title).toBeUndefined()
    expect(paper.abstract).toBeUndefined()
  })
})

describe('paper_revise', () => {
  it('analyzes a paper for revision suggestions', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_revise', { paper: PAPER, config: {} })
    const value = resultJson(result)
    expect(value.sectionCount).toBe(1)
    expect(resultText(result)).toContain('Revised 1 sections, 2 references')
  })

  it('rejects an invalid revise config', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_revise', { paper: PAPER, config: { nope: 1 } })
    expect(result.isError).toBe(true)
  })
})

describe('paper_format', () => {
  it('standardizes a paper', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_format', { paper: PAPER, config: {} })
    const value = resultJson(result)
    expect(value.sectionCount).toBe(1)
    expect(resultText(result)).toContain('Formatted 1 sections, 2 references')
  })

  it('applies defaults when config is omitted', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_format', { paper: PAPER })
    expect(result.isError).toBe(false)
  })
})

describe('paper_cite', () => {
  it('formats a paper\'s references in APA', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_cite', { paper: PAPER, config: { style: 'apa' } })
    const value = resultJson(result)
    expect(value.citationCount).toBe(2)
    const paper = value.paper as { citations: { formatted?: string }[] }
    expect(paper.citations[0]?.formatted).toBeTruthy()
    expect(resultText(result)).toContain('Cited 2 references')
  })

  it('rejects an invalid cite style', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_cite', { paper: PAPER, config: { style: 'chicago' } })
    expect(result.isError).toBe(true)
  })
})

describe('paper_run', () => {
  it('runs a full pipeline without a source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_run', { format: 'markdown', data: MANUSCRIPT, pipeline: PIPELINE })
    const value = resultJson(result)
    expect(value.status).toBe('completed')
    expect(value.pipelineName).toBe('manuscript-qc')
    expect((value.steps as unknown[]).length).toBe(4)
    expect(value.outputSummary).toMatchObject({ sectionCount: 1, citationCount: 2 })
    expect(resultText(result)).toContain('output 1 sections / 2 references')
  })

  it('runs a text pipeline with a source label', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_run', {
      format: 'text',
      data: 'Body text.\n\nReferences\n\n[1] Author, A. (2020) T. J, 1(1), 1-2.',
      source: 'paper-b',
      pipeline: { name: 'q', steps: [{ id: 'i', type: 'ingest', config: {} }] },
    })
    expect(result.isError).toBe(false)
  })

  it('rejects an invalid pipeline', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_run', {
      format: 'markdown',
      data: MANUSCRIPT,
      pipeline: { name: 'x', steps: [] },
    })
    expect(result.isError).toBe(true)
  })
})

describe('paper_export', () => {
  const EXPORT = { title: 'A Study', sections: [{ kind: 'heading', heading: 'Method', paragraphs: ['Body text.'] }], citations: [], meta: {} }

  it('exports a .docx document with a derived file name', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_export', {
      paper: EXPORT,
      format: 'docx',
      config: { headerText: 'Draft', pageNumbers: true },
    })
    const value = resultJson(result)
    expect(value.fileName).toBe('A-Study.docx')
    expect(value.format).toBe('docx')
    expect(typeof value.bytes).toBe('number')
    expect((value.bytes as number)).toBeGreaterThan(0)
    expect(value.checksum).toHaveLength(64)
    const data = Buffer.from(value.dataBase64 as string, 'base64')
    expect(data.subarray(0, 2).toString()).toBe('PK')
    expect(resultText(result)).toContain('Exported')
    expect(resultText(result)).toContain('A-Study.docx')
  })

  it('exports a .doc (RTF) document', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_export', { paper: EXPORT, format: 'doc', config: {} })
    const value = resultJson(result)
    expect(value.format).toBe('doc')
    expect(value.fileName).toBe('A-Study.doc')
  })

  it('falls back to the document base name when the title is absent or empty', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_export', {
      paper: { sections: [], citations: [], meta: {} },
      format: 'docx',
    })
    const value = resultJson(result)
    expect(value.fileName).toBe('document.docx')
    // A title reduced to punctuation also sanitizes to the fallback base name.
    const symbolic = await call(ctx, 'paper_export', {
      paper: { title: '!!!', sections: [], citations: [], meta: {} },
      format: 'docx',
    })
    const symbolicValue = resultJson(symbolic)
    expect(symbolicValue.fileName).toBe('document.docx')
  })

  it('rejects an unsupported format with clear guidance', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_export', { paper: EXPORT, format: 'pdf', config: {} })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('must be one of ["doc","docx"]')
  })

  it('rejects an invalid layout config', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'paper_export', { paper: EXPORT, format: 'docx', config: { fontSizePt: -1 } })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('fontSizePt')
  })
})

describe('tool call presentation', () => {
  it('declares a generic pending card for every paper tool', async () => {
    const { ctx } = await harness()
    const cases: [string, string, unknown][] = [
      ['paper_ingest', 'Ingest manuscript', { format: 'markdown', data: '# T' }],
      ['paper_revise', 'Revise manuscript', { paper: PAPER, config: {} }],
      ['paper_format', 'Format manuscript', { paper: PAPER, config: {} }],
      ['paper_cite', 'Format references', { paper: PAPER, config: { style: 'apa' } }],
      ['paper_run', 'Run paper pipeline', { format: 'markdown', data: '# T', pipeline: PIPELINE }],
      ['paper_export', 'Export document', { paper: PAPER, format: 'docx', config: {} }],
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

describe('tool-paper invariant companion', () => {
  it('registers and disposes the package invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(toolInvariant)
    await fiber.dispose()
  })
})
