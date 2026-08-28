/**
 * MLA (9th edition) author–page reference formatting.
 *
 * Transforms a parsed {@link Citation} into an MLA works-cited entry. The first
 * author is inverted as `Family, Given`; subsequent authors render as full
 * `, and Given Family`. Article titles are quoted, source/container names are
 * bare, and a trailing URL is appended for web references. Optional components
 * are emitted only when present.
 * @module @deepseek-ai/dsh-paper
 */

import type { Citation } from '../types.ts'
import { nameParts } from './format-utils.ts'

/** Format one author per MLA: invert the first author, prefix later ones. */
function formatAuthor(name: string, index: number): string {
  const { family, given } = nameParts(name)
  if (index === 0) return given === '' ? family : `${family}, ${given}`
  return given === '' ? `and ${family}` : `and ${given} ${family}`
}

function formatAuthors(citation: Citation): string {
  const names = citation.authors.map((name, i) => formatAuthor(name, i))
  return names.length === 0 ? '' : `${names.join(', ')}. `
}

/**
 * Format a citation in MLA 9th edition.
 * @param citation - parsed citation components.
 * @returns the formatted reference entry.
 */
export function formatCitation(citation: Citation): string {
  const authors = formatAuthors(citation)
  const head = `${authors}"${citation.title}." `
  const year = citation.year === '' ? '' : citation.year

  switch (citation.kind) {
    case 'journal':
      return `${head}${citation.source ?? ''}, vol. ${citation.volume ?? '—'}, no. ${citation.issue ?? '—'}, ${year}, pp. ${citation.pages}.`
    case 'book':
      return `${authors}${citation.title}. ${citation.publisher ?? ''}, ${year}.`
    case 'conference':
      return `${head}${citation.source ?? ''}, ${year}, pp. ${citation.pages}.`
    case 'thesis':
      return `${head}${citation.source ?? citation.publisher ?? ''}, ${year}.`
    case 'web':
      return `${head}${citation.source ?? ''}, ${year}, ${citation.url ?? ''}.`
  }
}
