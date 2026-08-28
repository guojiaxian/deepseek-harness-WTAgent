/**
 * `cite` step processor: 参考文献格式自动化整理与规范化 (reference formatting).
 *
 * Re-formats every parsed {@link Citation} into a target style — GB/T 7714,
 * APA, or MLA — through the shared citation dispatcher, optionally sorting
 * entries by author + year afterwards. The `maxCitations` budget caps how many
 * references are formatted; entries beyond it are passed through unchanged.
 * @module @deepseek-ai/dsh-paper
 */

import { carryMeta, withMeta } from '../manuscript.ts'
import { formatCitation } from '../citation/index.ts'
import { parseCitation } from '../citation/parser.ts'
import type { Citation, CiteConfig, CitationStyle, Limits, Paper, ProcessorResult } from '../types.ts'
import { asBoolean, asEnum, asNumber, checkKeys, checkObject } from './validate.ts'

const STYLES: readonly CitationStyle[] = ['gb7714', 'apa', 'mla']

/**
 * Validate a `cite` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): CiteConfig {
  const obj = checkObject(config, 'cite config')
  checkKeys(obj, ['style', 'sort', 'maxCitations'], 'cite')
  return {
    style: asEnum(obj.style, STYLES, 'cite.style'),
    ...(obj.sort !== undefined ? { sort: asBoolean(obj.sort, 'cite.sort') } : {}),
    ...(obj.maxCitations !== undefined ? { maxCitations: asNumber(obj.maxCitations, 'cite.maxCitations') } : {}),
  }
}

/**
 * Run a `cite` step.
 * @param paper - input paper.
 * @param config - validated cite config.
 * @param limits - resource limits; `maxCitations` caps formatted entries.
 * @returns the paper with formatted citations plus audit notes.
 */
export function run(paper: Paper, config: CiteConfig, limits: Limits): ProcessorResult {
  const maxCitations = Math.floor(Math.min(config.maxCitations ?? limits.maxCitations, limits.maxCitations))
  const style = config.style

  let citations = paper.citations.map((citation, i) => {
    if (i >= maxCitations) return citation
    const parsed = parseCitation(citation.id, citation.raw)
    return { ...parsed, formatted: formatCitation(parsed, style) }
  })
  if (config.sort === true) {
    citations = [...citations].sort(compareCitation)
  }

  const meta = carryMeta(paper.meta)
  const styled: Paper = { ...paper, citations }
  const formatted = withMeta(styled, meta)
  const notes = [
    `formatted ${Math.min(citations.length, maxCitations)} of ${citations.length} references in ${style}${config.sort === true ? ', sorted by author/year' : ''}`,
  ]
  return { paper: formatted, notes }
}

/** Order citations by author surname then year, falling back to id. */
function compareCitation(a: Citation, b: Citation): number {
  const byAuthor = (a.authors[0] ?? a.id).localeCompare(b.authors[0] ?? b.id)
  if (byAuthor !== 0) return byAuthor
  const byYear = a.year.localeCompare(b.year)
  if (byYear !== 0) return byYear
  return a.id.localeCompare(b.id)
}

/** Re-export the style union for consumers of the `cite` processor. */
export type { CitationStyle } from '../types.ts'
