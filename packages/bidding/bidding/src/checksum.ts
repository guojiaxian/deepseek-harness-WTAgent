/**
 * Canonical fingerprinting for bidding engine artifacts.
 * @module @deepseek-ai/dsh-bidding
 */

import { createHash } from 'node:crypto'

/**
 * Compute the sha256 of raw bytes.
 * @param data - raw bytes.
 * @returns lowercase hex sha256 digest.
 */
export function checksumBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Compute the sha256 of a UTF-8 string.
 * @param text - the string to fingerprint.
 * @returns lowercase hex sha256 digest.
 */
export function checksumText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
