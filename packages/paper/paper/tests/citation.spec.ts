import { describe, expect, it } from 'vitest'
import { initials, joinClauses, nameParts } from '../src/citation/index.ts'
import * as gb7714 from '../src/citation/gb7714.ts'
import * as apa from '../src/citation/apa.ts'
import * as mla from '../src/citation/mla.ts'
import type { Citation, ReferenceSourceKind } from '../src/types.ts'

/** Base helper: a citation with every optional field omit; tests spread overrides. */
function cit(kind: ReferenceSourceKind, overrides: Partial<Citation> = {}): Citation {
  return { id: '1', kind, raw: '', authors: [], year: '', title: '', ...overrides } as Citation
}

describe('format-utils', () => {
  it('nameParts splits both the comma and word orders', () => {
    expect(nameParts('Smith, John Paul')).toEqual({ family: 'Smith', given: 'John Paul' })
    expect(nameParts('John Paul Smith')).toEqual({ family: 'Smith', given: 'John Paul' })
    expect(nameParts('单一')).toEqual({ family: '单一', given: '' })
    expect(nameParts('   ')).toEqual({ family: '', given: '' })
  })

  it('initials reduces given names to bracketed initials', () => {
    expect(initials('John Paul')).toBe('J. P.')
    expect(initials('')).toBe('')
    expect(initials('mary')).toBe('M.')
  })

  it('joinClauses drops empty and undefined clauses', () => {
    expect(joinClauses(', ', 'a', undefined, '', 'b')).toBe('a, b')
    expect(joinClauses(', ')).toBe('')
    expect(joinClauses('. ', '   ')).toBe('')
  })
})

describe('GB/T 7714 formatter', () => {
  it('formats a journal with author, volume/issue, and year', () => {
    const c = cit('journal', {
      authors: ['Smith, John'], year: '2020', title: 'A study of paper',
      source: 'Journal of Science', volume: '12', issue: '3', pages: '45-60',
    })
    expect(gb7714.formatCitation(c)).toBe('Smith, John. A study of paper[J]. Journal of Science. 2020, 12(3), 45-60.')
  })

  it('renders a bare volume without an issue', () => {
    const out = gb7714.formatCitation(cit('journal', { authors: ['A'], year: '2020', title: 'T', source: 'S', volume: '12' }))
    expect(out).toBe('A. T[J]. S. 2020, 12.')
  })

  it('formats Chinese and given-less authors', () => {
    const chinese = gb7714.formatCitation(cit('book', { authors: ['张三'], year: '2010', title: '论文题目', publisher: '科学出版社' }))
    expect(chinese).toContain('论文题目[M]')
    const bare = gb7714.formatCitation(cit('book', { authors: ['Confucius'], year: '2010', title: 'T', publisher: 'P' }))
    expect(bare).toContain('T[M]')
  })

  it('truncates more than three authors with et al / 等', () => {
    const latin = gb7714.formatCitation(cit('journal', { authors: ['A, One', 'B, Two', 'C, Three', 'D, Four'], title: 'T', source: 'S', pages: '1-2' }))
    expect(latin).toContain('et al')
    const han = gb7714.formatCitation(cit('journal', { authors: ['甲', '乙', '丙', '丁'], title: 'T', source: 'S' }))
    expect(han).toContain('等')
  })

  it('formats empty and singleton author lists', () => {
    expect(gb7714.formatCitation(cit('book', { title: 'T', publisher: 'P' }))).toContain('[M]')
    expect(gb7714.formatCitation(cit('book', { authors: ['One'], title: 'T', publisher: 'P' }))).toContain('One. T[M]')
  })

  it('drops the volume clause when absent and the year when empty', () => {
    const noVol = gb7714.formatCitation(cit('journal', { authors: ['A'], title: 'T', source: 'S' }))
    expect(noVol).not.toContain('(')
    const noYear = gb7714.formatCitation(cit('journal', { authors: ['A'], title: 'T', source: 'S', pages: '1-2' }))
    expect(noYear).toContain('S. 1-2.')
  })

  it('covers conference, thesis, and web kinds including url preference', () => {
    const conference = gb7714.formatCitation(cit('conference', { authors: ['A'], title: 'T', publisher: 'Proc' }))
    expect(conference).toContain('[C]')
    const thesis = gb7714.formatCitation(cit('thesis', { authors: ['A'], year: '2010', title: 'T', publisher: 'Uni' }))
    expect(thesis).toContain('[D]')
    const web = gb7714.formatCitation(cit('web', { authors: ['A'], year: '2020', title: 'T', source: 'Site', url: 'https://example.com' }))
    expect(web).toContain('[EB/OL]')
    expect(web).toContain('https://example.com')
    const webNoUrl = gb7714.formatCitation(cit('web', { authors: ['A'], title: 'T', source: 'Site' }))
    expect(webNoUrl).toContain('Site')
  })
})

describe('APA formatter', () => {
  it('joins authors with an ampersand and renders the DOI as a URL', () => {
    const c = cit('journal', {
      authors: ['Smith, John', 'Doe, Jane'], year: '2020', title: 'A study of paper',
      source: 'Journal of Science', volume: '12', issue: '3', pages: '45-60',
      doi: '10.1000/test',
    })
    const out = apa.formatCitation(c)
    expect(out).toContain('Smith, J., & Doe, J.')
    expect(out).toContain('https://doi.org/10.1000/test')
  })

  it('handles single-author, given-less, and empty authors', () => {
    expect(apa.formatCitation(cit('book', { authors: ['Smith'], year: '2020', title: 'T', publisher: 'P' })))
      .toContain('Smith (2020).')
    expect(apa.formatCitation(cit('book', { authors: ['Smith, John'], year: '2020', title: 'T', publisher: 'P' })))
      .toContain('Smith, J.')
    const noAuthors = apa.formatCitation(cit('book', { year: '2020', title: 'T', publisher: 'P' }))
    expect(noAuthors).toContain('(2020).')
  })

  it('emits no access note and no year when those are absent', () => {
    const out = apa.formatCitation(cit('journal', { authors: ['A'], title: 'T', source: 'S' }))
    expect(out).not.toContain('undefined')
    expect(out).not.toMatch(/http/)
  })

  it('covers book, conference, thesis, and web kinds', () => {
    const book = apa.formatCitation(cit('book', { authors: ['A'], year: '2010', title: 'B', publisher: 'Press', url: 'https://x.y' }))
    expect(book).toContain('Press.')
    const confWithPg = apa.formatCitation(cit('conference', { authors: ['A'], year: '2010', title: 'C', source: 'Proc', pages: '1-4' }))
    expect(confWithPg).toContain('(pp. 1-4)')
    const confNoPg = apa.formatCitation(cit('conference', { authors: ['A'], year: '2010', title: 'C' }))
    expect(confNoPg).not.toContain('pp.')
    const confUrl = apa.formatCitation(cit('conference', { authors: ['A'], year: '2010', title: 'C', url: 'https://c.v' }))
    expect(confUrl).toContain('https://c.v')
    const thesis = apa.formatCitation(cit('thesis', { authors: ['A'], year: '2010', title: 'Th', publisher: 'Uni' }))
    expect(thesis).toContain('Doctoral dissertation')
    const thesisNoPub = apa.formatCitation(cit('thesis', { authors: ['A'], year: '2010', title: 'Th' }))
    expect(thesisNoPub).toContain('Doctoral dissertation')
    const web = apa.formatCitation(cit('web', { authors: ['A'], year: '2010', title: 'W', source: 'Site' }))
    expect(web).toContain('Site.')
    const webNoSource = apa.formatCitation(cit('web', { authors: ['A'], year: '2010', title: 'W' }))
    expect(webNoSource).toContain('W.')
  })
})

describe('MLA formatter', () => {
  it('inverts the first author and prefixes later authors', () => {
    const c = cit('journal', {
      authors: ['Smith, John', 'Doe, Jane'], year: '2020', title: 'A study of paper',
      source: 'Journal of Science', volume: '12', issue: '3', pages: '45-60',
    })
    const out = mla.formatCitation(c)
    expect(out).toContain('Smith, John, and Jane Doe.')
    expect(out).toContain('vol. 12, no. 3')
  })

  it('handles given-less authors and empty author list', () => {
    expect(mla.formatCitation(cit('book', { authors: ['Confucius'], year: '2010', title: 'T', publisher: 'P' })))
      .toContain('Confucius.')
    const nonFirst = mla.formatCitation(cit('book', { authors: ['One', 'Two'], year: '2010', title: 'T', publisher: 'P' }))
    expect(nonFirst).toContain('One, and Two.')
    const empty = mla.formatCitation(cit('book', { year: '2010', title: 'T', publisher: 'P' }))
    expect(empty).toContain('T.')
  })

  it('uses dash placeholders when volume or issue is missing', () => {
    const out = mla.formatCitation(cit('journal', { authors: ['A'], year: '2010', title: 'T', source: 'S', pages: '1-2' }))
    expect(out).toContain('vol. —')
    expect(out).toContain('no. —')
  })

  it('covers conference, thesis, and web kinds', () => {
    const conf = mla.formatCitation(cit('conference', { authors: ['A'], year: '2010', title: 'C', source: 'Proc', pages: '1-4' }))
    expect(conf).toContain('Proc')
    const thesisPub = mla.formatCitation(cit('thesis', { authors: ['A'], year: '2010', title: 'Th', publisher: 'Uni' }))
    expect(thesisPub).toContain('Uni')
    const thesisSrc = mla.formatCitation(cit('thesis', { authors: ['A'], year: '2010', title: 'Th', source: 'Repo' }))
    expect(thesisSrc).toContain('Repo')
    const thesisNone = mla.formatCitation(cit('thesis', { authors: ['A'], year: '2010', title: 'Th' }))
    expect(thesisNone).toContain('Th')
    const web = mla.formatCitation(cit('web', { authors: ['A'], year: '2010', title: 'W', source: 'Site', url: 'https://e.com' }))
    expect(web).toContain('https://e.com')
    const webNoSource = mla.formatCitation(cit('web', { authors: ['A'], year: '2010', title: 'W' }))
    expect(webNoSource).toContain('W')
  })

  it('omits the year when empty', () => {
    expect(mla.formatCitation(cit('book', { authors: ['A'], title: 'T', publisher: 'P' }))).toContain('P, .')
  })
})
