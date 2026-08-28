/**
 * `extract` step processor: derived numeric columns and per-column statistics.
 *
 * The step is additive: it never removes or rewrites input columns. Descriptive
 * statistics land on the dataset meta under `statistics` (computed over the
 * numeric columns by default; `columns` restricts the set); rolling window and
 * RMS columns are appended to the table. Edge windows are null-padded rather
 * than shortened, keeping trace and geometry columns row-aligned: mean, min,
 * max and RMS use the in-range samples, while a rolling `std` over an
 * incomplete window yields `null`.
 * @module @deepseek-ai/dsh-exploration
 */

import { carryMeta, columnIndex } from '../dataset.ts'
import { ExplorationError } from '../errors.ts'
import { iqr as computeIqr, max, mean, median, min, std } from '../stats.ts'
import type { CellValue, Column, Dataset, ExtractConfig, ProcessorResult } from '../types.ts'
import { asArray, asEnum, asPositiveInt, asString, checkKeys, checkObject, stringArray } from './validate.ts'

/**
 * Validate an `extract` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): ExtractConfig {
  const obj = checkObject(config, 'extract config')
  checkKeys(obj, ['statistics', 'rolling', 'rms'], 'extract')
  const out: ExtractConfig = {}

  if (obj.statistics !== undefined) {
    const s = checkObject(obj.statistics, 'extract.statistics')
    checkKeys(s, ['columns'], 'extract.statistics')
    out.statistics = {
      ...(s.columns !== undefined ? { columns: stringArray(s.columns, 'extract.statistics.columns') } : {}),
    }
  }

  if (obj.rolling !== undefined) {
    out.rolling = asArray(obj.rolling, 'extract.rolling').map((entry, i) => {
      const e = checkObject(entry, `extract.rolling[${i}]`)
      checkKeys(e, ['column', 'window', 'operation', 'output'], `extract.rolling[${i}]`)
      const operation = asEnum(e.operation, ['mean', 'std', 'min', 'max'], `extract.rolling[${i}].operation`)
      return {
        column: asString(e.column, `extract.rolling[${i}].column`),
        window: asPositiveInt(e.window, `extract.rolling[${i}].window`),
        operation,
        output: asString(e.output, `extract.rolling[${i}].output`),
      }
    })
  }

  if (obj.rms !== undefined) {
    out.rms = asArray(obj.rms, 'extract.rms').map((entry, i) => {
      const e = checkObject(entry, `extract.rms[${i}]`)
      checkKeys(e, ['column', 'window', 'output'], `extract.rms[${i}]`)
      const column = asString(e.column, `extract.rms[${i}].column`)
      const window = asPositiveInt(e.window, `extract.rms[${i}].window`)
      return {
        column,
        window,
        ...(e.output !== undefined ? { output: asString(e.output, `extract.rms[${i}].output`) } : {}),
      }
    })
  }

  return out
}

/**
 * Run an `extract` step.
 * @param dataset - input dataset.
 * @param config - validated extract config.
 * @returns the dataset with statistics meta and new columns plus audit notes.
 */
export function run(dataset: Dataset, config: ExtractConfig): ProcessorResult {
  const columns: Column[] = dataset.columns.map(col => ({ ...col }))
  let rows: CellValue[][] = dataset.rows.map(row => [...row])
  const notes: string[] = []
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(dataset.meta)) {
    if (key !== 'rowCount' && key !== 'provenance') meta[key] = dataset.meta[key]
  }
  meta.rowCount = rows.length

  // 1. Per-column descriptive statistics, always computed; `columns` restricts the set.
  {
    const targets = config.statistics?.columns !== undefined
      ? config.statistics.columns
      : columns.filter(col => col.type === 'number').map(col => col.name)
    if (targets.length > 0) {
      const statistics: Record<string, unknown> = {}
      for (const name of targets) {
        const index = columnIndex(dataset, name)
        if (index < 0) {
          throw new ExplorationError(`extract.statistics: unknown column "${name}"`, { code: 'VALIDATION_ERROR' })
        }
        if ((columns[index] as Column).type !== 'number') {
          throw new ExplorationError(`extract.statistics: column "${name}" is not numeric`, { code: 'VALIDATION_ERROR' })
        }
        const values = dataset.rows
          .map(row => row[index])
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        const count = values.length
        const nulls = dataset.rows.length - count
        statistics[name] = {
          count,
          nulls,
          mean: mean(values),
          std: std(values),
          median: median(values),
          min: min(values),
          max: max(values),
          q1: quartile(values, 0.25),
          q3: quartile(values, 0.75),
          iqr: computeIqr(values),
        }
      }
      meta.statistics = statistics
      notes.push(`computed statistics for ${targets.length} numeric column(s)`)
    }
  }

  // 2. Rolling-window columns.
  if (config.rolling !== undefined && config.rolling.length > 0) {
    for (const rule of config.rolling) {
      const index = columnIndex(dataset, rule.column)
      if (index < 0) {
        throw new ExplorationError(`extract.rolling: unknown column "${rule.column}"`, { code: 'VALIDATION_ERROR' })
      }
      if ((columns[index] as Column).type !== 'number') {
        throw new ExplorationError(`extract.rolling: column "${rule.column}" is not numeric`, { code: 'VALIDATION_ERROR' })
      }
      columns.push({ name: rule.output, type: 'number', description: `rolling ${rule.operation} of ${rule.column} (window ${rule.window})` })
      rows = rows.map((row, r) => {
        const { values, complete } = windowOf(dataset, index, r, rule.window)
        const value = applyOperation(values, rule.operation, complete)
        const next = [...row]
        next.push(value)
        return next
      })
      notes.push(`added rolling column "${rule.output}" (${rule.operation}, window ${rule.window})`)
    }
  }

  // 3. Rolling RMS amplitude columns.
  if (config.rms !== undefined && config.rms.length > 0) {
    for (const rule of config.rms) {
      const index = columnIndex(dataset, rule.column)
      if (index < 0) {
        throw new ExplorationError(`extract.rms: unknown column "${rule.column}"`, { code: 'VALIDATION_ERROR' })
      }
      if ((columns[index] as Column).type !== 'number') {
        throw new ExplorationError(`extract.rms: column "${rule.column}" is not numeric`, { code: 'VALIDATION_ERROR' })
      }
      const output = rule.output ?? `${rule.column}_rms_${rule.window}`
      columns.push({ name: output, type: 'number', description: `RMS amplitude of ${rule.column} (window ${rule.window})` })
      rows = rows.map((row, r) => {
        const { values: windowValues } = windowOf(dataset, index, r, rule.window)
        const squares = windowValues.map(v => v * v)
        const rootMeanSquare = squares.length === 0 ? null : Math.sqrt(mean(squares) as number)
        const next = [...row]
        next.push(rootMeanSquare)
        return next
      })
      notes.push(`added RMS column "${output}" (window ${rule.window})`)
    }
  }

  return {
    dataset: { columns, rows, meta: carryMeta(meta, rows.length) },
    notes,
  }
}

/**
 * Values of a centered window around row `r`, with an edge-completeness flag.
 * @param dataset - dataset to read.
 * @param column - column index.
 * @param row - center row index.
 * @param window - window size (odd sizes center the sample; even sizes lean forward).
 * @returns the in-range finite values in row order and whether the full window lies in range.
 */
function windowOf(dataset: Dataset, column: number, row: number, window: number): { values: number[]; complete: boolean } {
  const half = Math.floor(window / 2)
  const start = row - half
  const values: number[] = []
  let complete = true
  for (let i = 0; i < window; i++) {
    const r = start + i
    if (r < 0 || r >= dataset.rows.length) {
      complete = false
      continue
    }
    const cell = (dataset.rows[r] as readonly CellValue[])[column]
    if (typeof cell === 'number' && Number.isFinite(cell)) values.push(cell)
  }
  return { values, complete }
}

/**
 * Apply one rolling operation over a window's finite values.
 * @param values - window values.
 * @param operation - statistic to compute.
 * @param complete - whether the full window lies within the dataset.
 * @returns the statistic, or `null` when no finite sample exists or a std window is incomplete.
 */
function applyOperation(values: number[], operation: 'mean' | 'std' | 'min' | 'max', complete: boolean): number | null {
  switch (operation) {
    case 'mean':
      return mean(values)
    case 'std':
      return complete ? std(values) : null
    case 'min':
      return min(values)
    case 'max':
      return max(values)
  }
}

/**
 * Quantile over finite values (R-7, shared by the statistics block).
 * @param values - finite numeric samples.
 * @param q - quantile in [0, 1].
 * @returns the quantile, or `null` on empty input.
 */
function quartile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const h = (sorted.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  if (lo === hi) return sorted[lo] as number
  const frac = h - lo
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac
}
