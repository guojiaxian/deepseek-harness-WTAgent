/**
 * Input format dispatch.
 *
 * Maps a {@link ProcessingInput} (bytes or text plus a format name) to a
 * {@link Dataset} via the format readers. Format names are case-insensitive.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from '../errors.ts'
import type { Dataset, IngestConfig, ProcessingInput } from '../types.ts'
import { csvToDataset, parseCsv } from './csv.ts'
import type { CsvDatasetOptions, CsvParseOptions } from './csv.ts'
import { jsonToDataset } from './json.ts'
import { parseSegY } from './segy.ts'

/** Decode input bytes as UTF-8 text; strings pass through. */
function decodeText(data: Uint8Array | string): string {
  if (typeof data === 'string') return data
  return new TextDecoder().decode(data)
}

/**
 * Ingest raw exploration input into a dataset.
 * @param input - raw input: `csv`/`json` accept bytes or text, `segy` requires bytes.
 * @param config - ingest configuration.
 * @returns the parsed dataset with an empty meta object (meta enrichment happens in the ingest processor).
 */
export function ingestData(input: ProcessingInput, config: IngestConfig): Dataset {
  const format = input.format.trim().toLowerCase()
  switch (format) {
    case 'csv': {
      const parseOptions: CsvParseOptions = {
        ...(config.delimiter !== undefined ? { delimiter: config.delimiter } : {}),
        ...(config.trim !== undefined ? { trim: config.trim } : {}),
      }
      const datasetOptions: CsvDatasetOptions = {
        ...parseOptions,
        ...(config.hasHeader !== undefined ? { hasHeader: config.hasHeader } : {}),
        ...(config.inferTypes !== undefined ? { inferTypes: config.inferTypes } : {}),
      }
      return csvToDataset(parseCsv(decodeText(input.data), parseOptions), datasetOptions)
    }
    case 'json': {
      let value: unknown
      try {
        value = JSON.parse(decodeText(input.data))
      } catch (cause) {
        throw new ExplorationError(`invalid JSON input: ${(cause as Error).message}`, { code: 'PARSE_ERROR' })
      }
      return jsonToDataset(value)
    }
    case 'segy': {
      if (typeof input.data === 'string') {
        throw new ExplorationError('SEG-Y input must be raw bytes', { code: 'PARSE_ERROR' })
      }
      return parseSegY(input.data, {
        ...(config.longFormat !== undefined ? { longFormat: config.longFormat } : {}),
        ...(config.sampleLimit !== undefined ? { sampleLimit: config.sampleLimit } : {}),
      })
    }
    default:
      throw new ExplorationError(`unsupported input format "${input.format}"`, { code: 'UNSUPPORTED_FORMAT' })
  }
}
