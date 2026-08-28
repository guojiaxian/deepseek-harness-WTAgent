/**
 * `clean` step processor: missing values, ranges, dedupe, schema changes.
 *
 * Operations apply in a fixed order: drop columns, rename columns, coerce
 * column types, handle missing values, enforce numeric ranges, remove duplicate
 * rows, then trim string whitespace. Column references resolve against the
 * schema as each operation runs, so renames made earlier in the step take
 * effect for later rules.
 * @module @deepseek-ai/dsh-exploration
 */

import { carryMeta } from '../dataset.ts'
import { ExplorationError } from '../errors.ts'
import type { CellValue, CleanConfig, Column, Dataset, ProcessorResult } from '../types.ts'
import { asArray, asBoolean, asEnum, asNumber, asString, checkKeys, checkObject, stringArray } from './validate.ts'

/**
 * Validate a `clean` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): CleanConfig {
  const obj = checkObject(config, 'clean config')
  checkKeys(obj, ['missing', 'ranges', 'dedupe', 'dropColumns', 'renameColumns', 'trimStrings', 'columnTypes'], 'clean')
  const out: CleanConfig = {}

  if (obj.missing !== undefined) {
    const m = checkObject(obj.missing, 'clean.missing')
    checkKeys(m, ['action', 'value'], 'clean.missing')
    const action = asEnum(m.action, ['drop', 'fill', 'keep'], 'clean.missing.action')
    if (action === 'fill' && m.value === undefined) {
      throw new ExplorationError('clean.missing requires `value` when action is `fill`', { code: 'VALIDATION_ERROR' })
    }
    if (m.value !== undefined && !isCellValue(m.value)) {
      throw new ExplorationError('clean.missing.value must be a number, string, or boolean', { code: 'VALIDATION_ERROR' })
    }
    const missing: CleanConfig['missing'] = { action }
    if (m.value !== undefined) missing.value = m.value
    out.missing = missing
  }

  if (obj.ranges !== undefined) {
    out.ranges = asArray(obj.ranges, 'clean.ranges').map((entry, i) => {
      const e = checkObject(entry, `clean.ranges[${i}]`)
      checkKeys(e, ['column', 'min', 'max', 'action'], `clean.ranges[${i}]`)
      const column = asString(e.column, `clean.ranges[${i}].column`)
      const action = asEnum(e.action, ['clamp', 'drop', 'error'], `clean.ranges[${i}].action`)
      if (e.min === undefined && e.max === undefined) {
        throw new ExplorationError(`clean.ranges[${i}] requires "min" or "max"`, { code: 'VALIDATION_ERROR' })
      }
      const min = e.min === undefined ? undefined : asNumber(e.min, `clean.ranges[${i}].min`)
      const max = e.max === undefined ? undefined : asNumber(e.max, `clean.ranges[${i}].max`)
      if (min !== undefined && max !== undefined && min > max) {
        throw new ExplorationError(`clean.ranges[${i}] min must not exceed max`, { code: 'VALIDATION_ERROR' })
      }
      return { column, min, max, action } as NonNullable<CleanConfig['ranges']>[number]
    })
  }

  if (obj.dedupe !== undefined) {
    if (typeof obj.dedupe === 'boolean') {
      out.dedupe = obj.dedupe
    } else {
      const d = checkObject(obj.dedupe, 'clean.dedupe')
      checkKeys(d, ['columns'], 'clean.dedupe')
      out.dedupe = {
        ...(d.columns !== undefined ? { columns: stringArray(d.columns, 'clean.dedupe.columns') } : {}),
      }
    }
  }

  if (obj.dropColumns !== undefined) {
    out.dropColumns = stringArray(obj.dropColumns, 'clean.dropColumns')
  }

  if (obj.renameColumns !== undefined) {
    out.renameColumns = asArray(obj.renameColumns, 'clean.renameColumns').map((entry, i) => {
      const e = checkObject(entry, `clean.renameColumns[${i}]`)
      checkKeys(e, ['from', 'to'], `clean.renameColumns[${i}]`)
      return {
        from: asString(e.from, `clean.renameColumns[${i}].from`),
        to: asString(e.to, `clean.renameColumns[${i}].to`),
      }
    })
  }

  if (obj.trimStrings !== undefined) {
    out.trimStrings = asBoolean(obj.trimStrings, 'clean.trimStrings')
  }

  if (obj.columnTypes !== undefined) {
    out.columnTypes = asArray(obj.columnTypes, 'clean.columnTypes').map((entry, i) => {
      const e = checkObject(entry, `clean.columnTypes[${i}]`)
      checkKeys(e, ['column', 'type'], `clean.columnTypes[${i}]`)
      const type = asEnum(e.type, ['number', 'string', 'boolean'], `clean.columnTypes[${i}].type`)
      return { column: asString(e.column, `clean.columnTypes[${i}].column`), type }
    })
  }

  return out
}

/**
 * Run a `clean` step.
 * @param dataset - input dataset.
 * @param config - validated clean config.
 * @returns the cleaned dataset plus audit notes.
 */
export function run(dataset: Dataset, config: CleanConfig): ProcessorResult {
  let columns: Column[] = dataset.columns.map(col => ({ ...col }))
  let rows: CellValue[][] = dataset.rows.map(row => [...row])
  const notes: string[] = []
  const findColumn = (name: string, what: string): number => {
    const index = columns.findIndex(col => col.name === name)
    if (index < 0) {
      throw new ExplorationError(`${what}: unknown column "${name}"`, { code: 'VALIDATION_ERROR' })
    }
    return index
  }

  // 1. Drop columns.
  if (config.dropColumns !== undefined && config.dropColumns.length > 0) {
    for (const name of config.dropColumns) findColumn(name, 'clean.dropColumns')
    const drop = new Set(config.dropColumns)
    const keep: number[] = []
    columns = columns.filter((col, c) => {
      if (drop.has(col.name)) return false
      keep.push(c)
      return true
    })
    rows = rows.map(row => keep.map(i => row[i] ?? null))
    notes.push(`dropped columns: ${[...drop].join(', ')}`)
  }

  // 2. Rename columns.
  if (config.renameColumns !== undefined && config.renameColumns.length > 0) {
    const map = new Map<string, string>()
    for (const { from, to } of config.renameColumns) {
      findColumn(from, 'clean.renameColumns')
      if (map.has(from)) {
        throw new ExplorationError(`clean.renameColumns: duplicate rename of "${from}"`, { code: 'VALIDATION_ERROR' })
      }
      map.set(from, to)
    }
    columns = columns.map(col => (map.has(col.name) ? { ...col, name: map.get(col.name) as string } : col))
    const seen = new Set<string>()
    for (const col of columns) {
      if (seen.has(col.name)) {
        throw new ExplorationError(`clean.renameColumns: rename produces duplicate column "${col.name}"`, {
          code: 'VALIDATION_ERROR',
        })
      }
      seen.add(col.name)
    }
    notes.push(`renamed columns: ${[...map.entries()].map(([f, t]) => `${f}→${t}`).join(', ')}`)
  }

  // 3. Coerce column types.
  if (config.columnTypes !== undefined && config.columnTypes.length > 0) {
    for (const rule of config.columnTypes) {
      const index = findColumn(rule.column, 'clean.columnTypes')
      let changed = 0
      rows = rows.map((row) => {
        const cell = row[index] ?? null
        if (cell === null) return row
        let coerced: CellValue
        if (rule.type === 'number') {
          if (typeof cell === 'number') return row
          if (typeof cell === 'boolean') coerced = cell ? 1 : 0
          else {
            const v = Number(cell.trim())
            if (!Number.isFinite(v)) {
              throw new ExplorationError(`clean.columnTypes: cannot coerce "${cell}" to number in "${rule.column}"`, {
                code: 'DATA_ERROR',
              })
            }
            coerced = v
          }
        } else if (rule.type === 'boolean') {
          if (typeof cell === 'boolean') return row
          if (typeof cell === 'number') coerced = cell !== 0
          else {
            const s = cell.trim().toLowerCase()
            if (s === 'true' || s === '1') coerced = true
            else if (s === 'false' || s === '0') coerced = false
            else {
              throw new ExplorationError(`clean.columnTypes: cannot coerce "${cell}" to boolean in "${rule.column}"`, {
                code: 'DATA_ERROR',
              })
            }
          }
        } else {
          coerced = String(cell)
        }
        changed++
        const next = [...row]
        next[index] = coerced
        return next
      })
      columns[index] = { ...(columns[index] as Column), type: rule.type }
      notes.push(`coerced column "${rule.column}" to ${rule.type} (${changed} cells)`)
    }
  }

  // 4. Missing-value policy.
  if (config.missing !== undefined && config.missing.action !== 'keep') {
    if (config.missing.action === 'drop') {
      const before = rows.length
      rows = rows.filter(row => !row.some(cell => cell === null))
      if (before !== rows.length) notes.push(`dropped ${before - rows.length} rows with missing values`)
    } else {
      const value = config.missing.value as CellValue
      let filled = 0
      rows = rows.map((row) => {
        let count = 0
        const next = row.map((cell) => {
          if (cell === null) {
            count++
            return value
          }
          return cell
        })
        filled += count
        return count === 0 ? row : next
      })
      if (filled > 0) notes.push(`filled ${filled} missing cells with ${JSON.stringify(value)}`)
    }
  }

  // 5. Numeric range rules.
  if (config.ranges !== undefined && config.ranges.length > 0) {
    for (const rule of config.ranges) {
      const index = findColumn(rule.column, 'clean.ranges')
      if ((columns[index] as Column).type !== 'number') {
        throw new ExplorationError(`clean.ranges: column "${rule.column}" is not numeric`, { code: 'VALIDATION_ERROR' })
      }
      const { min, max } = rule
      let clamped = 0
      let dropped = 0
      const next: CellValue[][] = []
      for (const row of rows) {
        const v = row[index]
        if (typeof v !== 'number') {
          next.push(row)
          continue
        }
        const violated = (min !== undefined && v < min) || (max !== undefined && v > max)
        if (rule.action === 'drop') {
          if (violated) {
            dropped++
            continue
          }
          next.push(row)
        } else if (rule.action === 'error') {
          if (violated) {
            throw new ExplorationError(
              `clean.ranges: value ${v} out of range [${min ?? '-∞'}, ${max ?? '+∞'}] in "${rule.column}"`,
              { code: 'DATA_ERROR' },
            )
          }
          next.push(row)
        } else {
          let out = v
          if (min !== undefined && out < min) out = min
          if (max !== undefined && out > max) out = max
          if (out === v) {
            next.push(row)
          } else {
            clamped++
            const clone = [...row]
            clone[index] = out
            next.push(clone)
          }
        }
      }
      rows = next
      if (clamped > 0) notes.push(`clamped ${clamped} out-of-range values in "${rule.column}"`)
      if (dropped > 0) notes.push(`dropped ${dropped} rows out of range in "${rule.column}"`)
    }
  }

  // 6. Remove duplicate rows.
  if (config.dedupe) {
    const keyColumns = typeof config.dedupe === 'object' ? config.dedupe.columns : undefined
    let keyIndexes: number[] | undefined
    if (keyColumns !== undefined && keyColumns.length > 0) {
      keyIndexes = keyColumns.map(name => findColumn(name, 'clean.dedupe.columns'))
    }
    const before = rows.length
    const seen = new Set<string>()
    rows = rows.filter((row) => {
      const key = keyIndexes === undefined
        ? JSON.stringify(row)
        : keyIndexes.map(i => `${typeof row[i]}:${String(row[i])}`).join('\u0000')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (before !== rows.length) notes.push(`removed ${before - rows.length} duplicate rows`)
  }

  // 7. Trim string whitespace.
  if (config.trimStrings) {
    let trimmed = 0
    rows = rows.map((row) => {
      let count = 0
      const next = row.map((cell) => {
        if (typeof cell === 'string' && cell !== cell.trim()) {
          count++
          return cell.trim()
        }
        return cell
      })
      trimmed += count
      return count === 0 ? row : next
    })
    if (trimmed > 0) notes.push(`trimmed whitespace from ${trimmed} string cells`)
  }

  return { dataset: { columns, rows, meta: carryMeta(dataset.meta, rows.length) }, notes }
}

/** Whether a value is a legal cell value. */
function isCellValue(value: unknown): value is CellValue {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
}
