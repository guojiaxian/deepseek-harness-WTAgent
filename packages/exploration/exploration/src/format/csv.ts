/**
 * CSV format reader (RFC 4180 subset) and column/type builder.
 *
 * The parser handles quoted fields, `""` escapes, CRLF and LF line endings, and
 * fields spanning multiple lines inside quotes. The dataset builder derives
 * unique column names, pads ragged rows to a common width, and infers per-column
 * logical cell types from the actual cell values.
 * @module @deepseek-ai/dsh-exploration
 */

import type { CellType, CellValue, Column, Dataset } from '../types.ts'

/** Options controlling raw CSV tokenization. */
export interface CsvParseOptions {
  /** Field delimiter; default `,`. */
  readonly delimiter?: string
  /** Trim surrounding whitespace from unquoted fields and header names; default true. */
  readonly trim?: boolean
}

/** Options controlling CSV-to-dataset construction. */
export interface CsvDatasetOptions extends CsvParseOptions {
  /** Whether the first line names the columns; default true. */
  readonly hasHeader?: boolean
  /** Infer per-column logical cell types; default true. */
  readonly inferTypes?: boolean
}

/** Decimal-number grammar; rejects hex, `NaN`, and `Infinity`. */
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** ISO-8601 date/datetime grammar, with optional timezone. */
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Parse CSV text into a raw string table (RFC 4180). Empty fields are `''`;
 * trailing empty lines are dropped.
 * @param text - CSV source text.
 * @param options - tokenization options.
 * @returns the parsed rows.
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === delimiter) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (options.trim) {
    return rows.map(r => r.map(cell => cell.trim()))
  }
  return rows
}

/** Whether the cell parses as a decimal number. */
function isNumber(cell: string): boolean {
  return NUMBER_RE.test(cell)
}

/** Whether the cell is `true` or `false` (case-insensitive). */
function isBoolean(cell: string): boolean {
  return cell === 'true' || cell === 'false'
}

/** Whether the cell matches the ISO-8601 date/datetime grammar. */
function isDatetime(cell: string): boolean {
  return DATETIME_RE.test(cell)
}

/**
 * Build a dataset from a raw CSV table. Determines the column count from the
 * widest row, names columns from the header (or generated `column_<i>` names),
 * deduplicates column names with `_2`/`_3` suffixes, pads ragged rows with null
 * cells, and optionally infers per-column types.
 * @param rows - raw string rows (header row first when `hasHeader`).
 * @param options - dataset construction options.
 * @returns the tabular dataset with an empty meta object.
 */
export function csvToDataset(rows: readonly (readonly string[])[], options: CsvDatasetOptions = {}): Dataset {
  const hasHeader = options.hasHeader ?? true
  const inferTypes = options.inferTypes ?? true
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataStart = hasHeader ? 1 : 0
  const headerRow = hasHeader && rows.length > 0 ? (rows[0] as readonly string[]) : []

  const columns: Column[] = []
  const names = new Set<string>()
  for (let c = 0; c < width; c++) {
    const base = c < headerRow.length && headerRow[c] !== undefined && headerRow[c] !== ''
      ? (headerRow[c] as string)
      : `column_${c}`
    let name = base
    let suffix = 2
    while (names.has(name)) {
      name = `${base}_${suffix}`
      suffix++
    }
    names.add(name)
    columns.push({ name, type: 'unknown' })
  }

  // Cell values with null for empty cells.
  const cells = rows.slice(dataStart).map((row) => {
    const out: (string | null)[] = []
    for (let c = 0; c < width; c++) {
      const cell = row[c]
      out.push(cell === undefined || cell === '' ? null : cell)
    }
    return out
  })

  // Per-column logical type from the non-null cells.
  const types: CellType[] = columns.map(() => 'unknown')
  if (inferTypes) {
    for (let c = 0; c < width; c++) {
      let number = true
      let boolean = true
      let datetime = true
      let sawValue = false
      for (const row of cells) {
        const cell = row[c]
        if (cell == null) continue
        sawValue = true
        if (!isNumber(cell)) number = false
        if (!isBoolean(cell)) boolean = false
        if (!isDatetime(cell)) datetime = false
      }
      if (!sawValue) types[c] = 'unknown'
      else if (number) types[c] = 'number'
      else if (boolean) types[c] = 'boolean'
      else if (datetime) types[c] = 'datetime'
      else types[c] = 'string'
    }
  }

  // Coerce typed cells; untyped columns keep raw strings.
  const valueRows: CellValue[][] = cells.map((row) => {
    const out: CellValue[] = []
    for (let c = 0; c < width; c++) {
      const cell = row[c]
      const type = types[c] as CellType
      if (cell == null) out.push(null)
      else if (type === 'number') out.push(Number(cell))
      else if (type === 'boolean') out.push(cell === 'true')
      else if (type === 'datetime') out.push(cell)
      else out.push(cell)
    }
    return out
  })

  return {
    columns: columns.map((col, c) => ({ ...col, type: types[c] as CellType })),
    rows: valueRows,
    meta: {},
  }
}
