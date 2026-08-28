/**
 * Manuscript helpers shared by the processors.
 *
 * Papers are immutable: processors build a fresh object, carrying meta forward
 * through the pipeline while refreshing derived summary keys. Section and
 * citation lookups fail loud on unknown indices so a mistyped pipeline config
 * cannot silently pass through.
 * @module @deepseek-ai/dsh-paper
 */

import { PaperError } from './errors.ts'
import type { Paper } from './types.ts'

/**
 * Rebuild paper meta carried forward by a step, preserving processor extension
 * keys while dropping pipeline-owned `provenance` (the pipeline re-appends it).
 * @param meta - previous paper meta.
 * @returns the carried meta.
 */
export function carryMeta(meta: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const carried: Record<string, unknown> = {}
  for (const key of Object.keys(meta)) {
    if (key !== 'provenance') carried[key] = meta[key]
  }
  return carried
}

/**
 * Rebuild a paper from a base and a new meta map, preserving title, abstract,
 * sections, and citations.
 * @param paper - previous paper.
 * @param meta - the meta to attach.
 * @returns the rebuilt paper.
 */
export function withMeta(paper: Paper, meta: Record<string, unknown>): Paper {
  return {
    ...(paper.title !== undefined ? { title: paper.title } : {}),
    ...(paper.abstract !== undefined ? { abstract: paper.abstract } : {}),
    sections: paper.sections,
    citations: paper.citations,
    meta,
  }
}

/**
 * Assert a section index is in range, failing loud otherwise.
 * @param paper - paper whose sections are indexed.
 * @param index - section index.
 * @param what - human-readable reference context for error messages.
 * @returns the section index.
 */
export function requireSection(paper: Paper, index: number, what: string): number {
  if (!Number.isInteger(index) || index < 0 || index >= paper.sections.length) {
    throw new PaperError(`${what}: section index ${index} out of range`, { code: 'INVALID_ARGUMENT' })
  }
  return index
}
