/**
 * Reference text parsing.
 *
 * The parser reads structured {@link InputCitation} text into {@link Citation}
 * components for the style formatters. It is deliberately heuristic: it extracts
 * the fields the formatters need (authors, year, title, source, volume, issue,
 * pages, DOI, URL) and leaves every optional field undefined when the text does
 * not carry it, so a partially-described reference still formats. Author names
 * are separated by `;`, `,` (before the year), ` and `, or `&`; each author is
 * kept as `Family, Given` or `Given Family`. The year may be parenthesised
 * (`(2020)`) or bare; the title clause follows the year and the source clause
 * follows the title.
 * @module @deepseek-ai/dsh-paper
 */

import type { Citation, ReferenceSourceKind } from '../types.ts'

/** A governed identifier: `[J]`/`[M]`/`[C]`/`[D]`/`[EB/OL]` (GB/T 7714). */
const KIND_MARKERS: ReadonlyArray<[ReferenceSourceKind, RegExp]> = [
  ['journal', /\[[Jj]\]/],
  ['book', /\[[Mm]\]/],
  ['conference', /\[[Cc]\]/],
  ['thesis', /\[[Dd]\]/],
  ['web', /\[EB\/OL\]/i],
]

const DOI_RE = /doi:\s*(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i
const URL_RE = /https?:\/\/[^\s\]]+/
const YEAR_RE = /(?:^|\()(\d{4})(?:\)|,|\.|\s)/
const VOL_ISSUE_RE = /(\d{1,4})\s*\(\s*(\d{1,3})\s*\)/
const PAGES_RE = /(\d{1,4})\s*[-–]\s*(\d{1,4})/

/**
 * Parse a raw reference string into components.
 * @param id - stable in-document reference id.
 * @param text - raw, unformatted reference text.
 * @returns the parsed citation.
 */
export function parseCitation(id: string, text: string): Citation {
  const raw = text.trim()
  const doiMatch = raw.match(DOI_RE)
  const urlMatch = raw.match(URL_RE)
  const doi = doiMatch?.[1]
  const url = urlMatch?.[0]

  let body = raw
  if (urlMatch !== null) body = body.replace(urlMatch[0], ' ')
  if (doiMatch !== null) body = body.replace(/doi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i, ' ')
  body = body.replace(/\[(?:EB\/OL|[JMC][J]?|[DdMmCc])\]/g, ' ').replace(/^\[[^\]]*\][\s.]*/, '')
  body = body.replace(/\s+/g, ' ')

  const kind = detectKind(raw)

  const yearMatch = body.match(YEAR_RE)
  const yearText = yearMatch?.[0]
  const year = yearMatch?.[1]
  const yearIndex = yearText === undefined ? -1 : body.indexOf(yearText) + yearText.length

  // Authors: the clause before the year; join on `;`, ` and ` and `&`.
  const authorText = yearText === undefined ? '' : body.slice(0, body.lastIndexOf(yearText))
  const authors = yearText === undefined
    ? []
    : authorText.replace(/[;.]\s*$/, '')
      .split(/\s*(?:;| and |&)\s*/i)
      .map(s => s.trim())
      .filter(s => s !== '' && !/^\W+$/.test(s))

  // Title / source: the clauses after the year.
  const tail = yearText === undefined ? '' : body.slice(yearIndex).replace(/^[.,\s]+/, '')
  const tailClauses = tail.split(/\.\s+/).map(s => s.trim()).filter(s => s !== '')
  const first = tailClauses[0]
  const title = first === undefined ? '' : first
  const sourceClause = tailClauses[1]
  const source = sourceClause?.split(',')[0]?.trim()
  const publisher = sourceClause?.split(':')[1]?.trim()

  const volumeIssue = body.match(VOL_ISSUE_RE) ?? undefined
  const pagesMatch = body.match(PAGES_RE) ?? undefined

  return {
    id,
    kind,
    raw,
    authors,
    year: year ?? '',
    title,
    ...(source !== undefined && source !== '' ? { source } : {}),
    ...(volumeIssue !== undefined ? { volume: volumeIssue[1], issue: volumeIssue[2] } : {}),
    ...(pagesMatch !== undefined ? { pages: `${pagesMatch[1]}-${pagesMatch[2]}` } : {}),
    ...(publisher !== undefined && publisher !== '' ? { publisher: publisher } : {}),
    ...(doi !== undefined ? { doi } : {}),
    ...(url !== undefined ? { url } : {}),
  }
}

/**
 * Detect the governed source kind, from markers first then lexical heuristics.
 * @param raw - the unparsed citation text to classify.
 * @returns the detected general reference kind.
 */
export function detectKind(raw: string): ReferenceSourceKind {
  for (const [kind, re] of KIND_MARKERS) {
    if (re.test(raw)) return kind
  }
  if (/Proceedings|Conference|Symposium/i.test(raw)) return 'conference'
  if (/Dissertation|thesis/i.test(raw)) return 'thesis'
  if (/https?:\/\//i.test(raw)) return 'web'
  if (/\bJournal\b|\bIEEE\b|\bLetters\b|Review|Advances|, \d{1,4}\(\d{1,3}\)/i.test(raw)) return 'journal'
  return 'book'
}
