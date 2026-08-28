import { describe, expect, it } from 'vitest'
import { checksumBytes, checksumPaper } from '../src/checksum.ts'
import {
  formatCitation, formatApa, formatGb7714, formatMla, initials, joinClauses, nameParts, parseCitation, detectKind,
} from '../src/citation/index.ts'
import { PaperError } from '../src/errors.ts'
import { carryMeta, requireSection, withMeta } from '../src/manuscript.ts'
import type { Citation } from '../src/types.ts'

const JOURNAL_RAW = 'Smith, J. (2020). A study of paper. Journal of Science, 12(3), 45-60. doi:10.1000/xyz1234'

describe('PaperError', () => {
  it('carries a stable code and optional run/step context', () => {
    const error = new PaperError('boom', { code: 'PARSE_ERROR' })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PaperError')
    expect(error.message).toBe('boom')
    expect(error.code).toBe('PARSE_ERROR')
    expect(error.runId).toBeUndefined()
    expect(error.stepId).toBeUndefined()
    expect(error.details).toBeUndefined()
  })

  it('assigns optional fields only when present', () => {
    const error = new PaperError('boom', {
      code: 'DATA_ERROR',
      runId: 'run-1',
      stepId: 'step-2',
      details: { section: 0 },
    })
    expect(error.runId).toBe('run-1')
    expect(error.stepId).toBe('step-2')
    expect(error.details).toEqual({ section: 0 })
  })
})

describe('checksum', () => {
  it('hashes bytes deterministically', () => {
    const first = checksumBytes(new TextEncoder().encode('abc'))
    const second = checksumBytes(new TextEncoder().encode('abc'))
    expect(first).toBe(second)
    expect(first).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(checksumBytes(new TextEncoder().encode('abd'))).not.toBe(first)
  })

  it('canonicalizes a paper with sorted meta keys', () => {
    const base = samplePaper()
    const shuffled = { ...base, meta: { z: 1, a: 2 } }
    const ordered = { ...base, meta: { a: 2, z: 1 } }
    expect(checksumPaper(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(checksumPaper(shuffled)).toBe(checksumPaper(ordered))
    expect(checksumPaper(base)).not.toBe(checksumPaper(shuffled))
  })
})

describe('manuscript helpers', () => {
  it('carryMeta drops pipeline-owned provenance and keeps extension keys', () => {
    const carried = carryMeta({ source: 'paper.md', provenance: ['a'], custom: 1 })
    expect(carried).toEqual({ source: 'paper.md', custom: 1 })
  })

  it('withMeta rebuilds a paper preserving title, abstract, sections, and citations', () => {
    const base = samplePaper()
    const rebuilt = withMeta(base, { source: 'x.md' })
    expect(rebuilt.title).toBe('A Title')
    expect(rebuilt.abstract).toBe('The abstract.')
    expect(rebuilt.sections).toBe(base.sections)
    expect(rebuilt.citations).toBe(base.citations)
    expect(rebuilt.meta).toEqual({ source: 'x.md' })
  })

  it('requireSection resolves a section index or fails loud', () => {
    const base = samplePaper()
    expect(requireSection(base, 0, 'what')).toBe(0)
    expect(() => requireSection(base, 9, 'what')).toThrow(/section index 9 out of range/)
    expect(() => requireSection(base, -1, 'what')).toThrow(/out of range/)
    expect(() => requireSection(base, 1.5, 'what')).toThrow(/out of range/)
  })
})

describe('reference parsing', () => {
  it('parses a journal reference into components', () => {
    const citation = parseCitation('1', JOURNAL_RAW)
    expect(citation.id).toBe('1')
    expect(citation.kind).toBe('journal')
    expect(citation.authors).toEqual(['Smith, J'])
    expect(citation.year).toBe('2020')
    expect(citation.title).toBe('A study of paper')
    expect(citation.source).toBe('Journal of Science')
    expect(citation.volume).toBe('12')
    expect(citation.issue).toBe('3')
    expect(citation.pages).toBe('45-60')
    expect(citation.doi).toBe('10.1000/xyz1234')
    expect(citation.raw).toBe(JOURNAL_RAW)
  })

  it('parses a url-bearing web reference without DOI', () => {
    const citation = parseCitation('2', 'Doe, A. & Roe, B. (2021). A web note. Example Site. https://example.com/page')
    expect(citation.kind).toBe('web')
    expect(citation.authors).toEqual(['Doe, A.', 'Roe, B'])
    expect(citation.url).toBe('https://example.com/page')
    expect(citation.source).toBe('Example Site')
  })

  it('detects kind from GB/T governed markers', () => {
    expect(detectKind('[J] something')).toBe('journal')
    expect(detectKind('[M] something')).toBe('book')
    expect(detectKind('[C] something')).toBe('conference')
    expect(detectKind('[D] something')).toBe('thesis')
    expect(detectKind('[EB/OL] something')).toBe('web')
    expect(detectKind('Proceedings of the IEEE')).toBe('conference')
    expect(detectKind('A dissertation')).toBe('thesis')
    expect(detectKind('http://x.com')).toBe('web')
  })
})

describe('style formatters', () => {
  const parsed = parseCitation('1', JOURNAL_RAW)

  it('formats GB/T 7714 with a governed identifier', () => {
    const out = formatGb7714(parsed)
    expect(out).toContain('A study of paper[J].')
    expect(out).toContain('Journal of Science. 2020, 12(3), 45-60.')
  })

  it('formats APA with author-date and DOI resolver', () => {
    const out = formatApa(parsed)
    expect(out).toContain('(2020).')
    expect(out).toContain('https://doi.org/10.1000/xyz1234')
  })

  it('formats MLA with quoted title and container details', () => {
    const out = formatMla(parsed)
    expect(out).toContain('"A study of paper."')
    expect(out).toContain('vol. 12, no. 3, 2020, pp. 45-60.')
  })

  it('dispatches on the target style', () => {
    expect(formatCitation(parsed, 'gb7714')).toBe(formatGb7714(parsed))
    expect(formatCitation(parsed, 'apa')).toBe(formatApa(parsed))
    expect(formatCitation(parsed, 'mla')).toBe(formatMla(parsed))
  })
})

describe('format-utils', () => {
  it('nameParts splits comma and space forms', () => {
    expect(nameParts('Smith, John Paul')).toEqual({ family: 'Smith', given: 'John Paul' })
    expect(nameParts('John Paul Smith')).toEqual({ family: 'Smith', given: 'John Paul' })
    expect(nameParts('单名')).toEqual({ family: '单名', given: '' })
  })

  it('initials reduces a given name to bracketed initials', () => {
    expect(initials('John Paul')).toBe('J. P.')
    expect(initials('')).toBe('')
  })

  it('joinClauses drops empty clauses', () => {
    expect(joinClauses(', ', 'a', '', 'b', undefined)).toBe('a, b')
    expect(joinClauses(', ', '  ', undefined)).toBe('')
  })
})

/** A tiny paper used across checksum, manuscript, and processor tests. */
export function samplePaper(): {
  title?: string
  abstract?: string
  sections: readonly { kind: 'heading' | 'paragraph'; heading?: string; paragraphs: readonly string[] }[]
  citations: readonly Citation[]
  meta: Record<string, unknown>
} {
  return {
    title: 'A Title',
    abstract: 'The abstract.',
    sections: [
      { kind: 'heading', heading: 'Introduction', paragraphs: ['Due to the fact that it matters.'] },
    ],
    citations: [{ id: '1', raw: JOURNAL_RAW, kind: 'journal', authors: ['Smith, J.'], year: '2020', title: 'A study of paper', source: 'Journal of Science', volume: '12', issue: '3', pages: '45-60', doi: '10.1000/xyz1234', formatted: formatGb7714(parseCitation('1', JOURNAL_RAW)) }],
    meta: {},
  }
}
