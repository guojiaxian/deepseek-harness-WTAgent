/**
 * Citation formatting dispatch.
 *
 * Re-exports the reference parser and the three style formatters, plus a
 * `formatCitation(citation, style)` dispatcher that resolves a target style to
 * its formatter. Unknown styles fail loud rather than defaulting, so a
 * mistyped `cite` config can never silently produce the wrong style.
 * @module @deepseek-ai/dsh-paper
 */

import type { Citation, CitationStyle } from '../types.ts'
import * as apa from './apa.ts'
import * as gb7714 from './gb7714.ts'
import * as mla from './mla.ts'

export { parseCitation, detectKind } from './parser.ts'
export { formatCitation as formatGb7714 } from './gb7714.ts'
export { formatCitation as formatApa } from './apa.ts'
export { formatCitation as formatMla } from './mla.ts'

export * from './parser.ts'
export * from './format-utils.ts'

/**
 * Format a parsed citation in a target style.
 * @param citation - parsed citation components.
 * @param style - the citation style to format for.
 * @returns the formatted reference entry.
 */
export function formatCitation(citation: Citation, style: CitationStyle): string {
  switch (style) {
    case 'gb7714':
      return gb7714.formatCitation(citation)
    case 'apa':
      return apa.formatCitation(citation)
    case 'mla':
      return mla.formatCitation(citation)
  }
}
