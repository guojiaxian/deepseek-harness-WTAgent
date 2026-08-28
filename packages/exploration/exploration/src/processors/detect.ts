/**
 * `detect` step processor: anomaly detection over numeric and tabular columns.
 *
 * Detections are audit-only: the dataset's columns and rows pass through
 * unchanged; findings are collected on the meta `anomalies` array as
 * {@link AnomalyRecord} values, capped by the caller's `maxAnomalyRecords`
 * limit so a runaway detector can never blow up a run's memory.
 * @module @deepseek-ai/dsh-exploration
 */

import { carryMeta, columnIndex } from '../dataset.ts'
import { ExplorationError } from '../errors.ts'
import { iqr as computeIqr, mad, median, quantile, zscore } from '../stats.ts'
import type { AnomalyRecord, Dataset, DetectConfig, Limits, ProcessorResult } from '../types.ts'
import { asArray, asNumber, asPositiveInt, asString, checkKeys, checkObject, stringArray } from './validate.ts'

/**
 * Validate a `detect` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): DetectConfig {
  const obj = checkObject(config, 'detect config')
  checkKeys(obj, ['zscore', 'iqr', 'threshold', 'spike', 'deadTrace', 'nulls'], 'detect')
  const out: DetectConfig = {}

  if (obj.zscore !== undefined) {
    out.zscore = asArray(obj.zscore, 'detect.zscore').map((entry, i) => {
      const e = checkObject(entry, `detect.zscore[${i}]`)
      checkKeys(e, ['column', 'threshold'], `detect.zscore[${i}]`)
      return {
        column: asString(e.column, `detect.zscore[${i}].column`),
        ...(e.threshold !== undefined ? { threshold: asNumber(e.threshold, `detect.zscore[${i}].threshold`) } : {}),
      }
    })
  }

  if (obj.iqr !== undefined) {
    out.iqr = asArray(obj.iqr, 'detect.iqr').map((entry, i) => {
      const e = checkObject(entry, `detect.iqr[${i}]`)
      checkKeys(e, ['column', 'k'], `detect.iqr[${i}]`)
      return {
        column: asString(e.column, `detect.iqr[${i}].column`),
        ...(e.k !== undefined ? { k: asNumber(e.k, `detect.iqr[${i}].k`) } : {}),
      }
    })
  }

  if (obj.threshold !== undefined) {
    out.threshold = asArray(obj.threshold, 'detect.threshold').map((entry, i) => {
      const e = checkObject(entry, `detect.threshold[${i}]`)
      checkKeys(e, ['column', 'min', 'max'], `detect.threshold[${i}]`)
      const min = e.min === undefined ? undefined : asNumber(e.min, `detect.threshold[${i}].min`)
      const max = e.max === undefined ? undefined : asNumber(e.max, `detect.threshold[${i}].max`)
      if (min === undefined && max === undefined) {
        throw new ExplorationError(`detect.threshold[${i}] requires "min" or "max"`, { code: 'VALIDATION_ERROR' })
      }
      if (min !== undefined && max !== undefined && min > max) {
        throw new ExplorationError(`detect.threshold[${i}] min must not exceed max`, { code: 'VALIDATION_ERROR' })
      }
      return { column: asString(e.column, `detect.threshold[${i}].column`), min, max } as NonNullable<DetectConfig['threshold']>[number]
    })
  }

  if (obj.spike !== undefined) {
    out.spike = asArray(obj.spike, 'detect.spike').map((entry, i) => {
      const e = checkObject(entry, `detect.spike[${i}]`)
      checkKeys(e, ['column', 'window', 'threshold'], `detect.spike[${i}]`)
      return {
        column: asString(e.column, `detect.spike[${i}].column`),
        ...(e.window !== undefined ? { window: asPositiveInt(e.window, `detect.spike[${i}].window`) } : {}),
        ...(e.threshold !== undefined ? { threshold: asNumber(e.threshold, `detect.spike[${i}].threshold`) } : {}),
      }
    })
  }

  if (obj.deadTrace !== undefined) {
    out.deadTrace = asArray(obj.deadTrace, 'detect.deadTrace').map((entry, i) => {
      const e = checkObject(entry, `detect.deadTrace[${i}]`)
      checkKeys(e, ['sampleColumns'], `detect.deadTrace[${i}]`)
      return {
        ...(e.sampleColumns !== undefined ? { sampleColumns: stringArray(e.sampleColumns, `detect.deadTrace[${i}].sampleColumns`) } : {}),
      }
    })
  }

  if (obj.nulls !== undefined) {
    out.nulls = asArray(obj.nulls, 'detect.nulls').map((entry, i) => {
      const e = checkObject(entry, `detect.nulls[${i}]`)
      checkKeys(e, ['columns'], `detect.nulls[${i}]`)
      return {
        ...(e.columns !== undefined ? { columns: stringArray(e.columns, `detect.nulls[${i}].columns`) } : {}),
      }
    })
  }

  return out
}

/**
 * Run a `detect` step.
 * @param dataset - input dataset.
 * @param config - validated detect config.
 * @param limits - resource limits; `maxAnomalyRecords` caps the findings list.
 * @returns the dataset with the meta `anomalies` array plus audit notes.
 */
export function run(dataset: Dataset, config: DetectConfig, limits: Limits): ProcessorResult {
  const anomalies: AnomalyRecord[] = []
  let dropped = 0
  const notes: string[] = []
  const push = (record: AnomalyRecord): void => {
    if (anomalies.length >= limits.maxAnomalyRecords) {
      dropped += 1
      return
    }
    anomalies.push(record)
  }

  const numericColumn = (name: string, what: string): number => {
    const index = columnIndex(dataset, name)
    if (index < 0) {
      throw new ExplorationError(`${what}: unknown column "${name}"`, { code: 'VALIDATION_ERROR' })
    }
    if ((dataset.columns[index] as { type: string }).type !== 'number') {
      throw new ExplorationError(`${what}: column "${name}" is not numeric`, { code: 'VALIDATION_ERROR' })
    }
    return index
  }
  const columnValues = (index: number): number[] => {
    const out: number[] = []
    for (const row of dataset.rows) {
      const v = row[index]
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
    }
    return out
  }

  // 1. Z-score outliers.
  if (config.zscore !== undefined && config.zscore.length > 0) {
    for (const rule of config.zscore) {
      const index = numericColumn(rule.column, 'detect.zscore')
      const values = columnValues(index)
      const threshold = rule.threshold ?? 3
      for (let r = 0; r < dataset.rows.length; r++) {
        const row = dataset.rows[r]
        /* v8 ignore next 2 -- columnValues() above throws on a non-array row, so !row is always false here */
        if (!row) continue
        const value = row[index]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        const z = zscore(value, values)
        if (z !== null && Math.abs(z) > threshold) {
          push({ column: rule.column, row: r, value, kind: 'zscore', detail: `|z|=${Math.abs(z).toFixed(3)} > ${threshold}` })
        }
      }
      notes.push(`z-score detection on "${rule.column}" (threshold ${threshold})`)
    }
  }

  // 2. IQR outliers.
  if (config.iqr !== undefined && config.iqr.length > 0) {
    for (const rule of config.iqr) {
      const index = numericColumn(rule.column, 'detect.iqr')
      const values = columnValues(index)
      const q1 = quantile(values, 0.25)
      const q3 = quantile(values, 0.75)
      const spread = computeIqr(values)
      const k = rule.k ?? 1.5
      if (q1 !== null && q3 !== null && spread !== null && spread > 0) {
        for (let r = 0; r < dataset.rows.length; r++) {
          const row = dataset.rows[r]
          /* v8 ignore next 2 -- columnValues() above throws on a non-array row, so !row is always false here */
          if (!row) continue
          const value = row[index]
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          if (value < q1 - k * spread || value > q3 + k * spread) {
            push({ column: rule.column, row: r, value, kind: 'iqr', detail: `outside [${q1 - k * spread}, ${q3 + k * spread}]` })
          }
        }
      }
      notes.push(`IQR detection on "${rule.column}" (k=${k})`)
    }
  }

  // 3. Hard-threshold outliers.
  if (config.threshold !== undefined && config.threshold.length > 0) {
    for (const rule of config.threshold) {
      const index = numericColumn(rule.column, 'detect.threshold')
      const min = rule.min
      const max = rule.max
      for (let r = 0; r < dataset.rows.length; r++) {
        const row = dataset.rows[r]
        if (!row) continue
        const value = row[index]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
          const range = `[${min ?? '-∞'}, ${max ?? '+∞'}]`
          push({ column: rule.column, row: r, value, kind: 'threshold', detail: `outside ${range}` })
        }
      }
      notes.push(`threshold detection on "${rule.column}"`)
    }
  }

  // 4. Short-window spikes against median absolute deviation.
  if (config.spike !== undefined && config.spike.length > 0) {
    for (const rule of config.spike) {
      const index = numericColumn(rule.column, 'detect.spike')
      const window = rule.window ?? 3
      const threshold = rule.threshold ?? 5
      const half = Math.floor(window / 2)
      for (let r = 0; r < dataset.rows.length; r++) {
        const row = dataset.rows[r]
        if (!row) continue
        const value = row[index]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        const neighbours: number[] = []
        for (let o = -half; o <= half; o++) {
          if (o === 0) continue
          const nr = r + o
          if (nr < 0 || nr >= dataset.rows.length) continue
          const nv = dataset.rows[nr]?.[index]
          if (typeof nv === 'number' && Number.isFinite(nv)) neighbours.push(nv)
        }
        if (neighbours.length === 0) continue
        const med = median(neighbours)
        /* v8 ignore next 2 -- neighbours is non-empty (checked above) and median of finite numbers is never null */
        if (med === null) continue
        const m = mad(neighbours)
        if (m === 0) {
          if (value !== med) {
            push({ column: rule.column, row: r, value, kind: 'spike', detail: `differs from flat local median ${med}` })
          }
        } else if (m !== null && Math.abs(value - med) > threshold * m) {
          push({
            column: rule.column,
            row: r,
            value,
            kind: 'spike',
            detail: `|v - med| = ${Math.abs(value - med).toFixed(3)} > ${threshold} * MAD`,
          })
        }
      }
      notes.push(`spike detection on "${rule.column}" (window ${window}, threshold ${threshold})`)
    }
  }

  // 5. Dead traces: a trace group whose sample columns are all constant.
  if (config.deadTrace !== undefined && config.deadTrace.length > 0) {
    const traceIndex = columnIndex(dataset, 'trace')
    for (const rule of config.deadTrace) {
      const sampleColumns = rule.sampleColumns ?? dataset.columns
        .map(col => col.name)
        .filter(name => name !== 'trace' && (dataset.columns[columnIndex(dataset, name)] as { type: string }).type === 'number')
      const sampleIndexes = sampleColumns.map((name) => {
        const index = columnIndex(dataset, name)
        if ((dataset.columns[index] as { type: string }).type !== 'number') {
          throw new ExplorationError(`detect.deadTrace: column "${name}" is not numeric`, { code: 'VALIDATION_ERROR' })
        }
        return index
      })
      const groups = new Map<string, number[]>()
      const order: number[] = []
      for (let r = 0; r < dataset.rows.length; r++) {
        const key = traceIndex < 0 ? `row:${r}` : String(dataset.rows[r]?.[traceIndex] ?? '')
        if (!groups.has(key)) {
          groups.set(key, [])
          order.push(r)
        }
        ;(groups.get(key) as number[]).push(r)
      }
      for (let g = 0; g < order.length; g++) {
        const firstRow = order[g] as number
        const key = traceIndex < 0 ? `row:${firstRow}` : String(dataset.rows[firstRow]?.[traceIndex] ?? '')
        const rows = groups.get(key) as number[]
        const seen = new Map<string, number>()
        for (const r of rows) {
          for (const c of sampleIndexes) {
            const v = dataset.rows[r]?.[c]
            if (typeof v !== 'number' || !Number.isFinite(v)) continue
            const signature = v
            if (!seen.has(String(signature))) seen.set(String(signature), r)
            // Count distinct numeric values: a constant trace yields exactly one.
          }
        }
        // A dead trace shows the same constant sample across at least two samples.
        const distinct = [...seen.entries()]
        if (distinct.length === 1) {
          const entry = distinct[0]
          /* v8 ignore next 2 -- guarded by distinct.length === 1, so distinct[0] is always defined */
          if (entry === undefined) continue
          const constant = Number(entry[0])
          const row = entry[1]
          if (rows.length * sampleIndexes.length >= 2) {
            push({
              column: sampleColumns.join(', '),
              row,
              value: constant,
              kind: 'deadTrace',
              detail: `trace ${key} is constant (${constant}) across ${rows.length} row(s)`,
            })
          }
        }
      }
      notes.push(`dead-trace detection over ${sampleColumns.join(', ')}`)
    }
  }

  // 6. Missing cells.
  if (config.nulls !== undefined && config.nulls.length > 0) {
    for (const rule of config.nulls) {
      const columns = rule.columns ?? dataset.columns.map(col => col.name)
      for (const name of columns) {
        const index = columnIndex(dataset, name)
        if (index < 0) {
          throw new ExplorationError(`detect.nulls: unknown column "${name}"`, { code: 'VALIDATION_ERROR' })
        }
      }
      const indexMap = new Map(columns.map(name => [name, columnIndex(dataset, name)]))
      for (let r = 0; r < dataset.rows.length; r++) {
        for (const name of columns) {
          const cell = dataset.rows[r]?.[indexMap.get(name) as number] ?? null
          if (cell === null) {
            push({ column: name, row: r, value: null, kind: 'null', detail: 'missing value' })
          }
        }
      }
      notes.push(`null detection over ${columns.length} column(s)`)
    }
  }

  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(dataset.meta)) {
    if (key !== 'rowCount' && key !== 'provenance') meta[key] = dataset.meta[key]
  }
  meta.rowCount = dataset.rows.length
  meta.anomalies = anomalies
  if (dropped > 0) {
    notes.push(`anomaly list truncated at ${limits.maxAnomalyRecords} records`)
  }

  return {
    dataset: { columns: dataset.columns, rows: dataset.rows, meta: carryMeta(meta, dataset.rows.length) },
    notes,
  }
}
