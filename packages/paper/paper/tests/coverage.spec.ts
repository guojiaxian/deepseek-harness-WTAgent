import { describe, expect, it } from 'vitest'
import { detectKind, parseCitation } from '../src/citation/parser.ts'
import * as apa from '../src/citation/apa.ts'
import * as gb7714 from '../src/citation/gb7714.ts'
import * as mla from '../src/citation/mla.ts'
import * as format from '../src/processors/format.ts'
import * as ingest from '../src/processors/ingest.ts'
import * as cite from '../src/processors/cite.ts'
import * as processors from '../src/processors/index.ts'
import { runPipeline, validatePipeline } from '../src/pipeline.ts'
import type { Citation, Limits, Paper, ReferenceSourceKind } from '../src/types.ts'

const LIMITS: Limits = { maxInputBytes: 1_000_000, maxSections: 50, maxParagraphs: 50, maxCitations: 30, maxFindings: 50 }

function cit(kind: ReferenceSourceKind, overrides: Partial<Citation> = {}): Citation {
  return { id: '1', kind, raw: '', authors: [], year: '', title: '', ...overrides } as Citation
}

describe('parser', () => {
  it('parses DOI, URL, volume/issue, pages, publisher, and separators', () => {
    const ref = parseCitation('1', 'Zhang, Liang; Li, Wei (2020) Title. Journal, 12(3), 45-60, doi:10.1000/xyz')
    expect(ref.kind).toBe('journal')
    expect(ref.year).toBe('2020')
    expect(ref.authors).toContain('Zhang, Liang')
    expect(ref.volume).toBe('12')
    expect(ref.issue).toBe('3')
    expect(ref.pages).toBe('45-60')
    expect(ref.doi).toBe('10.1000/xyz')
  })

  it('detects URL references and prefers an explicit URL', () => {
    const ref = parseCitation('2', 'Author (2020) Title. https://example.com/doc')
    expect(ref.kind).toBe('web')
    expect(ref.url).toBe('https://example.com/doc')
  })

  it('parses ` and ` / `&` author separators and a publisher clause', () => {
    const ref = parseCitation('3', 'One A and Two B & Three C (2021) Book. Press: London')
    expect(ref.authors).toEqual(['One A', 'Two B', 'Three C'])
    expect(ref.publisher).toBe('London')
  })

  it('degrades to empty fields for a year-less, body-less citation', () => {
    const ref = parseCitation('4', 'Untitled')
    expect(ref.year).toBe('')
    expect(ref.authors).toEqual([])
    expect(ref.title).toBe('')
    expect(ref.source).toBeUndefined()
  })

  it('falls back to book for plain prose and reduces an empty publisher', () => {
    expect(detectKind('Plain Title. A Publisher')).toBe('book')
    const withColon = parseCitation('5', 'Author (2020) Title. Press:')
    expect(withColon.publisher).toBeUndefined()
  })
})

describe('cite sort', () => {
  const sorted = (first: string, second: string) => cite.run(
    {
      title: 'T', sections: [], citations: [{ id: '1', raw: first }, { id: '2', raw: second }], meta: {},
    } as unknown as Paper,
    { style: 'gb7714', sort: true },
    LIMITS,
  )

  it('orders equal authors by year', () => {
    const r = sorted('Smith, J. (2020) A. S, 1(1), 1-2.', 'Smith, J. (2019) B. S, 1(1), 1-2.')
    expect(r.paper.citations[0]?.id).toBe('2')
  })

  it('orders equal author and year by id', () => {
    const r = sorted('Smith, J. (2020) A. S, 1(1), 1-2.', 'Smith, J. (2020) B. S, 1(1), 1-2.')
    expect(r.paper.citations[0]?.id).toBe('1')
  })

  it('falls back to id when an author is missing', () => {
    const r = sorted('Untitled without authors', 'Smith, J. (2020) B. S, 1(1), 1-2.')
    expect(r.paper.citations[0]?.id).toBe('1')
  })
})

describe('format processor deep branches', () => {
  it('validates an empty config', () => {
    expect(format.validate({})).toEqual({})
    expect(() => format.validate({ nope: 1 })).toThrow(/unknown format option/)
  })

  it('leaves paragraph-kind sections untouched during numbering', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['Body.'] }], citations: [], meta: {} }
    const r = format.run(p, {}, LIMITS)
    expect(r.paper.sections[0]?.kind).toBe('paragraph')
  })

  it('converts single and double quotes with toggling', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['"it\'s a \'test\'"'] }], citations: [], meta: {} }
    const r = format.run(p, { numberedHeadings: false, spacing: false, citationMarks: false }, LIMITS)
    expect(r.paper.sections[0]?.paragraphs[0]).toBe('\u201Cit\u2019s a \u2018test\u2019\u201D')
  })

  it('reports a single-quote finding and a singular finding count', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['it\'s fine'] }], citations: [], meta: {} }
    const r = format.run(p, { numberedHeadings: false, spacing: false, citationMarks: false }, LIMITS)
    expect(r.paper.meta.findings?.some(f => f.rule === 'format.quotes')).toBe(true)
    expect(r.notes[0]).toContain('1 aspect')
  })

  it('reports no numbering finding when only paragraphs are present', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['Plain.'] }], citations: [], meta: {} }
    const r = format.run(p, { spacing: false, typographicQuotes: false, citationMarks: false }, LIMITS)
    expect(r.paper.meta.findings?.some(f => f.rule === 'format.numbering')).toBeUndefined()
  })

  it('caps findings at maxFindings', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['it\'s "fine" here.'] }, { kind: 'heading', heading: 'Intro', level: 1, paragraphs: [] }], citations: [], meta: {} }
    const r = format.run(p, { spacing: false, citationMarks: false, maxFindings: 1 }, LIMITS)
    expect(r.paper.meta.findings?.length).toBeLessThanOrEqual(1)
  })
})

describe('ingest deep branches', () => {
  it('splits sections by a custom pattern without markdown levels', () => {
    const data = '1. Intro\n\nBody.\n\nReferences\n\n[1] Author (2020) T. S, 1(1), 1-2.'
    const r = ingest.run({ format: 'text', data }, { sectionPattern: '^\\d+\\.' }, LIMITS)
    expect(r.paper.sections[0]?.heading).toBe('Intro')
    expect(r.paper.sections[0]?.level).toBeUndefined()
  })

  it('detects a plain-text References heading and wraps citations across lines', () => {
    const data = 'Body text.\n\nReferences\n\n[1] Author, A. (2020). A long title that continues\nonto the next line. Journal, 1(1), 1-2.'
    const r = ingest.run({ format: 'text', data }, { detectTitle: false }, LIMITS)
    expect(r.paper.citations[0]?.raw).toContain('continues onto the next line')
  })

  it('lifts an empty abstract section fallback', () => {
    const data = '# Title\n\n## Abstract\n\n## Method'
    const r = ingest.run({ format: 'markdown', data }, { detectTitle: false }, LIMITS)
    expect(r.paper.abstract).toBe('')
    expect(r.paper.sections.some(s => (s.heading ?? '').toLowerCase() === 'abstract')).toBe(false)
  })
})

describe('processor dispatch', () => {
  it('validates and runs format and cite steps, and rejects unknown types', () => {
    const validated = (['format', 'cite'] as const).map(type =>
      processors.validateStep({ id: 's', type, config: type === 'cite' ? { style: 'apa' } : {} }))
    expect(validated.length).toBe(2)

    const paper = { title: 'T', sections: [], citations: [{ id: '1', raw: 'Smith, J. (2020) A. S, 1(1), 1-2.' }], meta: {} } as unknown as Paper
    const viaCite = processors.runStep({ id: 's', type: 'cite', config: { style: 'apa' } }, paper, { format: 'text', data: '' }, LIMITS)
    expect(viaCite.paper.citations[0]?.formatted).toBeTruthy()

    expect(() => processors.validateStep({ id: 'x', type: 'nope' as never, config: {} }))
      .toThrow(/unknown step type/)
    expect(() => processors.runStep({ id: 'x', type: 'nope' as never, config: {} }, paper, { format: 'text', data: '' }, LIMITS))
      .toThrow(/unknown step type/)
  })
})

describe('formatter leftover branches', () => {
  it('gb7714 renders a Chinese author given name', () => {
    const out = gb7714.formatCitation(cit('journal', { authors: ['明, 张'], title: 'T', source: 'S' }))
    expect(out).toContain('张 明')
  })

  it('apa renders a bare volume and bare journal venue/book imprint', () => {
    const volOnly = apa.formatCitation(cit('journal', { authors: ['A'], title: 'T', source: 'S', volume: '12' }))
    expect(volOnly).toContain('12')
    const bareJournal = apa.formatCitation(cit('journal', { authors: ['A'], year: '2020', title: 'T' }))
    expect(bareJournal).toContain('T.')
    const bareBook = apa.formatCitation(cit('book', { authors: ['A'], year: '2020', title: 'T' }))
    expect(bareBook).toContain('T.')
  })

  it('mla omits source/publisher when absent', () => {
    expect(mla.formatCitation(cit('journal', { authors: ['A'], year: '2020', title: 'T', pages: '1-2' }))).toContain('vol. —')
    expect(mla.formatCitation(cit('book', { authors: ['A'], year: '2020', title: 'T' }))).toContain(', 2020.')
    expect(mla.formatCitation(cit('conference', { authors: ['A'], year: '2020', title: 'T', pages: '1-4' }))).toContain('2020')
  })
})

describe('remaining branch coverage', () => {
  it('falls back to the author id when both sorted citations lack authors', () => {
    const r = cite.run(
      { title: 'T', sections: [], citations: [{ id: '1', raw: 'Untitled A' }, { id: '2', raw: 'Untitled B' }], meta: {} } as unknown as Paper,
      { style: 'gb7714', sort: true },
      LIMITS,
    )
    expect(r.paper.citations[0]?.id).toBe('1')
  })

  it('reports a plural aspect count when more than one finding is produced', () => {
    const p: Paper = {
      title: 'T',
      sections: [
        { kind: 'paragraph', paragraphs: ['it said "hi".'] },
        { kind: 'heading', heading: 'Intro', level: 1, paragraphs: [] },
      ],
      citations: [],
      meta: {},
    }
    const r = format.run(p, { spacing: false, citationMarks: false }, LIMITS)
    expect(r.notes[0]).toContain('2 aspects')
  })

  it('skips stray non-citation lines inside the references block', () => {
    const data = 'References\n\nStray note without a marker.\n\n[1] Author, A. (2020) T. J, 1(1), 1-2.'
    const r = ingest.run({ format: 'text', data }, {}, LIMITS)
    expect(r.paper.citations).toHaveLength(1)
  })

  it('rejects out-of-range configs through the shared validators', () => {
    expect(() => format.validate({ maxFindings: 'x' })).toThrow(/finite number/)
    expect(() => ingest.validate({ sectionPattern: '   ' })).toThrow(/non-empty string/)
    expect(() => validatePipeline({ name: 'x', steps: 'nope' })).toThrow(/steps must be an array/)
  })

  it('runs a full ingest+format+cite pipeline with a description', () => {
    const pipeline = validatePipeline({
      name: 'p',
      description: 'd',
      steps: [
        { id: 'i', type: 'ingest', config: {} },
        { id: 'f', type: 'format', config: {} },
        { id: 'c', type: 'cite', config: { style: 'apa' } },
      ],
    })
    const record = runPipeline(
      { format: 'markdown', data: '# T\n\nIntro text.\n\nReferences\n\n[1] Smith, J. (2020) A study. Journal, 1(1), 2-3.' },
      pipeline,
      LIMITS,
      'run-coverage',
    )
    expect(record.status).toBe('completed')
    expect(record.pipelineDescription).toBe('d')
    expect(record.steps.map(s => s.type)).toEqual(['ingest', 'format', 'cite'])
  })

  it('summarizes a paragraph-only plain-text manuscript', () => {
    const record = runPipeline(
      { format: 'text', data: 'Just a body line.' },
      validatePipeline({ name: 'q', steps: [{ id: 'i', type: 'ingest', config: {} }] }),
      LIMITS,
      'run-para',
    )
    expect(record.status).toBe('completed')
    expect(record.outputSummary.characterCount).toBeGreaterThan(0)
  })

  it('hashes a byte-array input', () => {
    const record = runPipeline(
      { format: 'text', data: new TextEncoder().encode('byte input') as unknown as string },
      validatePipeline({ name: 'q', steps: [{ id: 'i', type: 'ingest', config: {} }] }),
      LIMITS,
      'run-bytes',
    )
    expect(record.input.checksum).toBeDefined()
  })
})
