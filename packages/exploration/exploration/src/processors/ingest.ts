/**
 * `ingest` step processor: raw exploration input → dataset.
 *
 * The only processor that does not consume a dataset; it dispatches to the
 * format readers, enforces the input byte budget, and stamps provenance on the
 * resulting dataset's meta.
 * @module @deepseek-ai/dsh-exploration
 */

import { carryMeta } from '../dataset.ts'
import { ExplorationError } from '../errors.ts'
import { ingestData } from '../format/index.ts'
import type { IngestConfig, Limits, ProcessingInput, ProcessorResult } from '../types.ts'
import { asBoolean, asPositiveInt, asString, checkKeys, checkObject } from './validate.ts'

/**
 * Validate an `ingest` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): IngestConfig {
  const obj = checkObject(config, 'ingest config')
  checkKeys(obj, ['delimiter', 'hasHeader', 'trim', 'inferTypes', 'longFormat', 'sampleLimit'], 'ingest')
  const out: IngestConfig = {}
  if (obj.delimiter !== undefined) {
    const delimiter = asString(obj.delimiter, 'ingest.delimiter')
    if (delimiter.length !== 1) {
      throw new ExplorationError('ingest.delimiter must be a single character', { code: 'VALIDATION_ERROR' })
    }
    out.delimiter = delimiter
  }
  if (obj.hasHeader !== undefined) out.hasHeader = asBoolean(obj.hasHeader, 'ingest.hasHeader')
  if (obj.trim !== undefined) out.trim = asBoolean(obj.trim, 'ingest.trim')
  if (obj.inferTypes !== undefined) out.inferTypes = asBoolean(obj.inferTypes, 'ingest.inferTypes')
  if (obj.longFormat !== undefined) out.longFormat = asBoolean(obj.longFormat, 'ingest.longFormat')
  if (obj.sampleLimit !== undefined) out.sampleLimit = asPositiveInt(obj.sampleLimit, 'ingest.sampleLimit')
  return out
}

/**
 * Run an `ingest` step.
 * @param input - raw input to parse.
 * @param config - validated ingest config.
 * @param limits - resource limits; `maxInputBytes` is enforced here.
 * @returns the parsed dataset plus provenance notes.
 */
export function run(input: ProcessingInput, config: IngestConfig, limits: Limits): ProcessorResult {
  const byteLength = typeof input.data === 'string'
    ? new TextEncoder().encode(input.data).byteLength
    : input.data.byteLength
  if (byteLength > limits.maxInputBytes) {
    throw new ExplorationError(
      `input of ${byteLength} bytes exceeds the ${limits.maxInputBytes}-byte limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  const dataset = ingestData(input, config)
  const meta = carryMeta(dataset.meta, dataset.rows.length)
  if (input.source !== undefined) {
    (meta as Record<string, unknown>).source = input.source
  }
  const shape = `${dataset.rows.length} rows x ${dataset.columns.length} columns`
  const notes = [
    `ingested ${dataset.meta.source === undefined ? input.source ?? 'inline' : dataset.meta.source} as ${input.format} (${shape})`,
  ]
  return { dataset: { columns: dataset.columns, rows: dataset.rows, meta }, notes }
}
