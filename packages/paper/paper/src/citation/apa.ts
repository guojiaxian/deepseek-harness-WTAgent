/**
 * APA (7th edition) author–date reference formatting.
 *
 * Transforms a parsed {@link Citation} into an APA reference entry. Authors
 * format as `Family, G., & Family, G.` (the ampersand before the final author);
 * a DOI is rendered as its resolver URL when present. Optional components are
 * emitted only when present.
 * @module @deepseek-ai/dsh-paper
 */

import type { Citation } from '../types.ts'
import { initials, joinClauses, nameParts } from './format-utils.ts'

/** Format one author as `Family, G. G.`. */
function formatAuthor(name: string): string {
  const { family, given } = nameParts(name)
  const init = initials(given)
  return init === '' ? family : `${family}, ${init}`
}

function joinAuthors(citation: Citation): string {
  const names = citation.authors.map(formatAuthor)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0] as string
  return `${names.slice(0, -1).join(', ')}, & ${names.at(-1) as string}`
}

/** Render the volume/issue clause as `12(3)` when a volume is present. */
function volumeIssueClause(citation: Citation): string | undefined {
  if (citation.volume === undefined) return undefined
  return citation.issue === undefined ? citation.volume : `${citation.volume}(${citation.issue})`
}

/** Append a DOI/URL access note as a trailing sentence when present. */
function accessSuffix(url: string | undefined): string {
  return url === undefined ? '' : ` ${url}`
}

/**
 * Format a citation in APA 7th edition.
 * @param citation - parsed citation components.
 * @returns the formatted reference entry.
 */
export function formatCitation(citation: Citation): string {
  const authors = joinAuthors(citation)
  const year = citation.year === '' ? undefined : `(${citation.year})`
  const ref = joinClauses(' ', authors === '' ? undefined : authors, year === undefined ? undefined : `${year}.`)
  const doiUrl = citation.doi !== undefined ? `https://doi.org/${citation.doi}` : citation.url

  switch (citation.kind) {
    case 'journal': {
      const venue = joinClauses(', ', citation.source, volumeIssueClause(citation), citation.pages)
      return joinClauses(' ', `${ref} ${citation.title}.`, venue === '' ? undefined : `${venue}.`) + accessSuffix(doiUrl)
    }
    case 'book': {
      const imprint = joinClauses('. ', citation.publisher)
      return joinClauses(' ', `${ref} ${citation.title}.`, imprint === '' ? undefined : `${imprint}.`) + accessSuffix(doiUrl)
    }
    case 'conference': {
      const venue = joinClauses('. ', citation.source)
      const pages = citation.pages === undefined ? undefined : `(pp. ${citation.pages})`
      return joinClauses(' ', `${ref} ${citation.title}.`, venue === '' ? undefined : `${venue}.`, pages) + accessSuffix(doiUrl)
    }
    case 'thesis':
      return joinClauses(' ', `${ref} ${citation.title} (Doctoral dissertation).`, citation.publisher === undefined ? undefined : `${citation.publisher}.`)
    case 'web': {
      const venue = joinClauses('. ', citation.source)
      return joinClauses(' ', `${ref} ${citation.title}.`, venue === '' ? undefined : `${venue}.`) + accessSuffix(doiUrl)
    }
  }
}
