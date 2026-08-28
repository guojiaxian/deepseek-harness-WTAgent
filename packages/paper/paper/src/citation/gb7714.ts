/**
 * GB/T 7714-2015 numeric-style reference formatting.
 *
 * Transforms a parsed {@link Citation} into a GB/T 7714 reference entry. Author
 * lists join with `, ` and truncate to three authors followed by `等` (or
 * `et al.` for Latin names); every source kind carries its bracketed governed
 * identifier, and optional components are emitted only when present.
 * @module @deepseek-ai/dsh-paper
 */

import type { Citation } from '../types.ts'
import { joinClauses, nameParts } from './format-utils.ts'

const MARKERS: Record<Citation['kind'], string> = {
  journal: '[J]',
  book: '[M]',
  conference: '[C]',
  thesis: '[D]',
  web: '[EB/OL]',
}

/** Format one author as `Family, Given` (Latin) or `Given Family` (Chinese). */
function formatAuthor(name: string): string {
  const { family, given } = nameParts(name)
  if (given === '') return family
  return /[\u4e00-\u9fa5]/.test(name) ? `${given} ${family}` : `${family}, ${given}`
}

function joinAuthors(citation: Citation): string {
  const names = citation.authors.map(formatAuthor)
  if (names.length === 0) return ''
  const latin = !/[\u4e00-\u9fa5]/.test(names.join(''))
  const head = names.slice(0, 3).join(', ')
  const tail = names.length > 3 ? `, ${latin ? 'et al' : '等'}` : ''
  return `${head}${tail}. `
}

/** Render the volume/issue clause as `12(3)` when a volume is present. */
function volumeClause(citation: Citation): string | undefined {
  if (citation.volume === undefined) return undefined
  return citation.issue === undefined ? citation.volume : `${citation.volume}(${citation.issue})`
}

/**
 * Format a citation in GB/T 7714-2015.
 * @param citation - parsed citation components.
 * @returns the formatted reference entry.
 */
export function formatCitation(citation: Citation): string {
  const head = `${joinAuthors(citation)}${citation.title}${MARKERS[citation.kind]}.`
  switch (citation.kind) {
    case 'journal':
      return `${head} ${joinClauses('. ', citation.source, joinClauses(', ', citation.year || undefined, volumeClause(citation), citation.pages))}.`
    case 'book':
    case 'conference':
    case 'thesis':
      return `${head} ${joinClauses('. ', citation.publisher, citation.year || undefined)}.`
    case 'web':
      return `${head} ${joinClauses('. ', citation.url ?? citation.source, citation.year || undefined)}.`
  }
}
