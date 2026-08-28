/**
 * Canonical dataset fingerprinting for traceability.
 *
 * Every pipeline step records the sha256 of its input dataset so an operator can
 * prove which input produced which output. Columns and rows keep their declared
 * order; meta keys are sorted so two datasets with identical logical content
 * hash identically regardless of meta-key insertion order.
 * @module @deepseek-ai/dsh-exploration
 */

import { createHash } from 'node:crypto'
import type { Dataset } from './types.ts'

/**
 * Compute the canonical sha256 of a dataset.
 * @param dataset - dataset to fingerprint.
 * @returns lowercase hex sha256 digest.
 */
export function checksumDataset(dataset: Dataset): string {
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(dataset.meta).sort()) {
    meta[key] = dataset.meta[key]
  }
  const canonical = JSON.stringify({
    columns: dataset.columns,
    rows: dataset.rows,
    meta,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Compute the sha256 of a raw input buffer, used for the input fingerprint of a
 * pipeline run.
 * @param data - raw input bytes.
 * @returns lowercase hex sha256 digest.
 */
export function checksumBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
