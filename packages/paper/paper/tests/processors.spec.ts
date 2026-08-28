import { describe, expect, it } from 'vitest'
import * as cite from '../src/processors/cite.ts'
import * as format from '../src/processors/format.ts'
import * as ingest from '../src/processors/ingest.ts'
import * as revise from '../src/processors/revise.ts'
import type { Limits, Paper } from '../src/types.ts'

const LIMITS: Limits = { maxInputBytes: 1_000_000, maxSections: 50, maxParagraphs: 50, maxCitations: 30, maxFindings: 50 }

const MD = [
  '# A Paper',
  '',
  '## Introduction',
  '',
  'Due to the fact that it matters.',
  '',
  '## References',
  '',
  '[1] Smith, J. (2020). A study of paper. Journal of Science, 12(3), 45-60.',
  '[2] Doe, A. (2019) Another work. Some Journal, 2(1), 5-9.',
].join('\n')

describe('ingest processor', () => {
  it('validates a config', () => {
    expect(ingest.validate({ markdownHeadings: true, detectTitle: false, sectionPattern: '^\\d+\\.' }))
      .toEqual({ markdownHeadings: true, detectTitle: false, sectionPattern: '^\\d+\\.' })
    expect(ingest.validate(undefined)).toEqual({})
    expect(() => ingest.validate({ nope: 1 })).toThrow(/unknown ingest option/)
    expect(() => ingest.validate({ markdownHeadings: 'x' })).toThrow(/must be a boolean/)
  })

  it('parses a markdown manuscript into a paper with sections and citations', () => {
    const result = ingest.run({ format: 'markdown', data: MD, source: 'paper.md' }, {}, LIMITS)
    expect(result.paper.title).toBe('A Paper')
    expect(result.paper.abstract).toBeUndefined()
    expect(result.paper.sections).toHaveLength(1)
    expect(result.paper.sections[0]?.heading).toBe('Introduction')
    expect(result.paper.citations).toHaveLength(2)
    expect(result.paper.citations[0]?.id).toBe('1')
    expect(result.paper.citations[0]?.raw).toContain('Smith')
    expect(result.paper.meta.source).toBe('paper.md')
    expect(result.notes[0]).toContain('ingested paper.md')
  })

  it('lifts an abstract section into paper.abstract', () => {
    const data = '## Abstract\n\nFirst line.\nSecond line.\n\n# T\n\nBody.'
    const result = ingest.run({ format: 'markdown', data }, {}, LIMITS)
    expect(result.paper.abstract).toBe('First line.\nSecond line.')
    expect(result.paper.sections.some(s => (s.heading ?? '').toLowerCase() === 'abstract')).toBe(false)
  })

  it('treats text without headings as plain paragraphs and detects a leading title only when enabled', () => {
    const rooted = ingest.run({ format: 'text', data: 'Title Line\n\nSome body.' }, { detectTitle: true }, LIMITS)
    expect(rooted.paper.title).toBe('Title Line')

    const notDetected = ingest.run({ format: 'text', data: 'Title Line\n\nSome body.' }, { detectTitle: false }, LIMITS)
    expect(notDetected.paper.title).toBeUndefined()
  })

  it('rejects unsupported formats and over-budget input', () => {
    expect(() => ingest.run({ format: 'docx', data: MD }, {}, LIMITS)).toThrow(/unsupported input format/)
    expect(() => ingest.run({ format: 'text', data: 'x'.repeat(20) }, {}, { ...LIMITS, maxInputBytes: 10 }))
      .toThrow(/byte limit/)
    const over = ingest.run({ format: 'text', data: 'a\nb\nc' }, {}, { ...LIMITS, maxSections: 2 })
    expect([over]).toBeTruthy()
  })

  it('enforces citation, paragraph, and section budgets', () => {
    const manyRefs = Array.from({ length: 5 }, (_, i) => `[${i + 1}] Author ${i} (2020) Title. Journal, 1(1), 1-2.`).join('\n')
    expect(() => ingest.run({ format: 'text', data: manyRefs }, {}, { ...LIMITS, maxCitations: 2 }))
      .toThrow(/citation limit/)
    expect(() => ingest.run({ format: 'markdown', data: '# A\n\n\n B\n\n C\n\n D' }, {}, { ...LIMITS, maxParagraphs: 1 }))
      .toThrow(/paragraph limit/)
    const manySections = Array.from({ length: 6 }, (_, i) => `# H${i}\n`).join('')
    expect(() => ingest.run({ format: 'markdown', data: manySections }, {}, { ...LIMITS, maxSections: 3 }))
      .toThrow(/section limit/)
  })
})

describe('revise processor', () => {
  const base: Paper = {
    title: 'T',
    sections: [
      { kind: 'paragraph', paragraphs: ['Due to the fact that it matters.'] },
    ],
    citations: [],
    meta: {},
  }

  it('validates a config', () => {
    expect(revise.validate({ clarity: false, flagPassiveVoice: true, flagClichés: false, maxFindings: 5 }))
      .toEqual({ clarity: false, flagPassiveVoice: true, flagClichés: false, maxFindings: 5 })
    expect(() => revise.validate({ nope: 1 })).toThrow(/unknown revise option/)
    expect(() => revise.validate({ flagPassiveVoice: 'y' })).toThrow(/must be a boolean/)
  })

  it('applies clarity rewrites and records suggestions', () => {
    const result = revise.run(base, {}, LIMITS)
    expect(result.paper.sections[0]?.paragraphs[0]).toBe('because it matters.')
    expect(result.paper.meta.suggestions).toHaveLength(1)
    expect(result.paper.meta.suggestions?.[0]).toMatchObject({
      rule: 'wordy.due-to', before: 'Due to the fact that', after: 'because',
    })
    expect(result.notes[0]).toContain('revised 1 passage')
  })

  it('flags passive voice and clichés when enabled', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['It was decided by the group in this day and age.'] }], citations: [], meta: {} }
    const result = revise.run(p, { clarity: false, flagPassiveVoice: true, flagClichés: true }, LIMITS)
    const rules = result.paper.meta.suggestions?.map(s => s.rule)
    expect(rules).toContain('voice.passive')
    expect(rules).toContain('cliche')
  })

  it('does not emit suggestions when nothing matches and respects cfg-off flags', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['Plain prose here.'] }], citations: [], meta: {} }
    const result = revise.run(p, { clarity: false, flagPassiveVoice: false, flagClichés: false }, LIMITS)
    expect(result.paper.meta.suggestions).toBeUndefined()
    expect(result.notes[0]).toContain('no clarity revisions')
  })

  it('caps suggestions at maxFindings', () => {
    const text = 'Due to the fact that A. Due to the fact that B. Due to the fact that C.'
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: [text] }], citations: [], meta: {} }
    const result = revise.run(p, { maxFindings: 2 }, LIMITS)
    expect(result.paper.meta.suggestions).toHaveLength(2)
  })
})

describe('format processor', () => {
  it('validates a config', () => {
    expect(format.validate({ numberedHeadings: false, spacing: true, typographicQuotes: false, citationMarks: false, maxFindings: 3 }))
      .toEqual({ numberedHeadings: false, spacing: true, typographicQuotes: false, citationMarks: false, maxFindings: 3 })
    expect(() => format.validate({ nope: 1 })).toThrow(/unknown format option/)
  })

  it('renumbers heading sections by level', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'heading', heading: 'Intro', level: 1, paragraphs: [] }, { kind: 'heading', heading: 'Method', level: 2, paragraphs: ['Body.'] }, { kind: 'heading', heading: 'Results', level: 2, paragraphs: [] }], citations: [], meta: {} }
    const result = format.run(p, {}, LIMITS)
    expect(result.paper.sections.map(s => s.heading)).toEqual(['1 Intro', '1.1 Method', '1.2 Results'])
  })

  it('leaves section list unchanged when numbering is disabled', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'heading', heading: 'Intro', paragraphs: [] }], citations: [], meta: {} }
    const result = format.run(p, { numberedHeadings: false }, LIMITS)
    expect(result.paper.sections[0]?.heading).toBe('Intro')
  })

  it('normalizes whitespace and typographic quotes', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['He said   "hi"  now.'] }], citations: [], meta: {} }
    const result = format.run(p, { numberedHeadings: false, spacing: true, typographicQuotes: true, citationMarks: false }, LIMITS)
    expect(result.paper.sections[0]?.paragraphs[0]).toBe('He said \u201Chi\u201D now.')
  })

  it('appends a period after a trailing inline citation marker', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'paragraph', paragraphs: ['See the result[1]'] }], citations: [], meta: {} }
    const result = format.run(p, { numberedHeadings: false, spacing: false, typographicQuotes: false, citationMarks: true }, LIMITS)
    expect(result.paper.sections[0]?.paragraphs[0]).toBe('See the result[1].')
  })

  it('reports findings and no-change note', () => {
    const p: Paper = { title: 'T', sections: [{ kind: 'heading', heading: 'Intro', paragraphs: ['Plain.'] }], citations: [], meta: {} }
    const changed = format.run(p, {}, LIMITS)
    expect(changed.paper.meta.findings?.length).toBeGreaterThan(0)
    expect(changed.notes[0]).toContain('formatted')

    const untouched = format.run(p, { numberedHeadings: false, spacing: false, typographicQuotes: false, citationMarks: false }, LIMITS)
    expect(untouched.paper.meta.findings).toBeUndefined()
    expect(untouched.notes[0]).toContain('no format changes')
  })
})

describe('cite processor', () => {
  const base = (style: string) => ({
    title: 'T',
    sections: [],
    citations: [
      { id: '1', raw: 'Smith, J. (2020). A study of paper. Journal of Science, 12(3), 45-60.' },
      { id: '2', raw: 'Doe, A. (2019) Another work. Some Journal, 2(1), 5-9.' },
    ],
    meta: { source: style },
  }) as unknown as Paper

  it('validates a config requiring a style', () => {
    expect(cite.validate({ style: 'apa' })).toEqual({ style: 'apa' })
    expect(cite.validate({ style: 'gb7714', sort: true, maxCitations: 5 })).toEqual({ style: 'gb7714', sort: true, maxCitations: 5 })
    expect(() => cite.validate({})).toThrow(/cite.style/)
    expect(() => cite.validate({ style: 'harvard' })).toThrow(/one of gb7714, apa, mla/)
    expect(() => cite.validate({ style: 'apa', nope: 1 })).toThrow(/unknown cite option/)
  })

  it('formats every citation in the target style', () => {
    const result = cite.run(base('apa'), { style: 'apa' }, LIMITS)
    expect(result.paper.citations[0]?.formatted).toContain('A study of paper')
    expect(result.notes[0]).toContain('in apa')
  })

  it('sorts citations by author then year', () => {
    const result = cite.run(base('apa'), { style: 'mla', sort: true }, LIMITS)
    expect(result.paper.citations[0]?.id).toBe('2')
    expect(result.notes[0]).toContain('sorted by author/year')
  })

  it('passes through citations beyond maxCitations', () => {
    const result = cite.run(base('apa'), { style: 'gb7714', maxCitations: 1 }, LIMITS)
    expect(result.paper.citations[0]?.formatted).toBeTruthy()
    expect(result.paper.citations[1]?.formatted).toBeUndefined()
  })
})
