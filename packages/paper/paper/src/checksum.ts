/**
 * Canonical paper fingerprinting for traceability.
 *
 * Every pipeline step records the sha256 of its input paper so an operator can
 * prove which input produced which output. Sections and citations keep their
 * declared order; meta keys are sorted so two papers with identical logical
 * content hash identically regardless of meta-key insertion order.
 * @module @deepseek-ai/dsh-paper
 */

import { createHash } from 'node:crypto'
import type { Paper } from './types.ts'

/**
 * Compute the canonical sha256 of a paper.
 * @param paper - paper to fingerprint.
 * @returns lowercase hex sha256 digest.
 */
export function checksumPaper(paper: Paper): string {
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(paper.meta).sort()) {
    meta[key] = paper.meta[key]
  }
  const canonical = JSON.stringify({
    title: paper.title,
    abstract: paper.abstract,
    sections: paper.sections,
    citations: paper.citations,
    meta,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Compute the sha256 of raw input bytes, used for the input fingerprint of a
 * pipeline run.
 * @param data - raw input bytes.
 * @returns lowercase hex sha256 digest.
 */
export function checksumBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
