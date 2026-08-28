/**
 * JSON format reader.
 *
 * Accepts either a fully-shaped {@link Dataset} (columns/rows/meta passthrough)
 * or an array of row objects `{ columnName: value }`, the natural interchange
 * form for structured data. Column types are inferred from the cell values; a
 * mixed-type column degrades to `string`.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from '../errors.ts'
import type { CellType, CellValue, Column, Dataset } from '../types.ts'

/** Whether a JSON value is a legal cell value (null, number, string, boolean). */
function isCellValue(value: unknown): value is CellValue {
  return value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Infer the logical cell type of one column from its non-null values. */
function inferType(values: readonly CellValue[]): CellType {
  let number = true
  let boolean = true
  let sawValue = false
  for (const v of values) {
    if (v === null) continue
    sawValue = true
    if (typeof v !== 'number' || !Number.isFinite(v)) number = false
    if (typeof v !== 'boolean') boolean = false
  }
  if (!sawValue) return 'unknown'
  if (number) return 'number'
  if (boolean) return 'boolean'
  return 'string'
}

/**
 * Build a dataset from a JSON value: a Dataset-shaped object is validated and
 * returned; an array of row objects becomes a dataset with columns from the
 * union of object keys, in first-seen order.
 * @param input - parsed JSON value.
 * @returns the tabular dataset.
 */
export function jsonToDataset(input: unknown): Dataset {
  if (Array.isArray(input)) {
    return rowsToDataset(input)
  }
  if (isPlainObject(input) && Array.isArray(input.columns) && Array.isArray(input.rows)) {
    return passthroughDataset(input as unknown as Dataset)
  }
  throw new ExplorationError('JSON input must be a dataset object or an array of row objects', {
    code: 'PARSE_ERROR',
  })
}

/** Validate a dataset-shaped object and return it with a guaranteed meta object. */
function passthroughDataset(input: Dataset): Dataset {
  if (!input.columns.every(col => isPlainObject(col) && typeof col.name === 'string')) {
    throw new ExplorationError('JSON dataset columns must be objects with a string `name`', { code: 'PARSE_ERROR' })
  }
  if (!input.rows.every(row => Array.isArray(row))) {
    throw new ExplorationError('JSON dataset rows must be arrays', { code: 'PARSE_ERROR' })
  }
  for (const row of input.rows) {
    for (const cell of row) {
      if (!isCellValue(cell)) {
        throw new ExplorationError('JSON dataset cells must be null, number, string, or boolean', { code: 'PARSE_ERROR' })
      }
    }
  }
  return {
    columns: input.columns.map(col => ({ ...col })),
    rows: input.rows.map((row: readonly CellValue[]): CellValue[] => [...row]),
    meta: isPlainObject(input.meta) ? { ...input.meta } : {},
  }
}

/** Build a dataset from an array of row objects. */
function rowsToDataset(rows: unknown[]): Dataset {
  const objects: Record<string, unknown>[] = []
  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new ExplorationError('JSON rows must be objects', { code: 'PARSE_ERROR' })
    }
    objects.push(row)
  }

  // Column names in first-seen order across all rows.
  const columns: Column[] = []
  const seen = new Set<string>()
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push({ name: key, type: 'unknown' })
      }
    }
  }

  // Collect cell values per column; a row missing the key pads the column with null.
  const perColumn: CellValue[][] = columns.map(() => [])
  for (const obj of objects) {
    for (let c = 0; c < columns.length; c++) {
      const name = (columns[c] as Column).name
      const raw = obj[name]
      if (raw === undefined) {
        perColumn[c]?.push(null)
        continue
      }
      if (!isCellValue(raw)) {
        throw new ExplorationError(`JSON cell "${name}" must be null, number, string, or boolean`, {
          code: 'PARSE_ERROR',
        })
      }
      perColumn[c]?.push(raw)
    }
  }

  const typedColumns = columns.map((col, c) => ({ ...col, type: inferType(perColumn[c] as CellValue[]) }))
  const valueRows: CellValue[][] = objects.map(obj =>
    columns.map((col) => {
      const raw = obj[col.name] as CellValue | undefined
      return raw === undefined ? null : raw
    }),
  )
  return { columns: typedColumns, rows: valueRows, meta: {} }
}
