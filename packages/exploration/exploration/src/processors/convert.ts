/**
 * `convert` step processor: unit conversion, depth↔TWT, column selection.
 *
 * Unit rules convert one column's cells through the {@link units} table,
 * updating the column's declared unit. Depth↔time conversion uses the seismic
 * two-way-time relation `t = 2d/v`; `outputUnit` names the time column's unit
 * in both directions (output for `depth-to-time`, input for `time-to-depth`).
 * @module @deepseek-ai/dsh-exploration
 */

import { carryMeta, findColumn } from '../dataset.ts'
import { ExplorationError } from '../errors.ts'
import type { CellValue, Column, ConvertConfig, Dataset, ProcessorResult } from '../types.ts'
import { convert as convertUnit } from '../units.ts'
import { asEnum, asNumber, asString, checkKeys, checkObject, stringArray } from './validate.ts'

/**
 * Validate a `convert` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): ConvertConfig {
  const obj = checkObject(config, 'convert config')
  checkKeys(obj, ['units', 'depthTime', 'selectColumns'], 'convert')
  const out: ConvertConfig = {}

  if (obj.units !== undefined) {
    out.units = (obj.units as unknown[]).map((entry, i) => {
      const e = checkObject(entry, `convert.units[${i}]`)
      checkKeys(e, ['column', 'from', 'to'], `convert.units[${i}]`)
      return {
        column: asString(e.column, `convert.units[${i}].column`),
        from: asString(e.from, `convert.units[${i}].from`),
        to: asString(e.to, `convert.units[${i}].to`),
      }
    })
  }

  if (obj.depthTime !== undefined) {
    const d = checkObject(obj.depthTime, 'convert.depthTime')
    checkKeys(d, ['mode', 'depthColumn', 'timeColumn', 'velocity', 'outputUnit'], 'convert.depthTime')
    const mode = asEnum(d.mode, ['depth-to-time', 'time-to-depth'], 'convert.depthTime.mode')
    const velocity = asNumber(d.velocity, 'convert.depthTime.velocity')
    if (velocity <= 0) {
      throw new ExplorationError('convert.depthTime.velocity must be positive', { code: 'VALIDATION_ERROR' })
    }
    const outputUnit = d.outputUnit === undefined
      ? undefined
      : asEnum(d.outputUnit, ['ms', 's'], 'convert.depthTime.outputUnit')
    out.depthTime = {
      mode,
      depthColumn: asString(d.depthColumn, 'convert.depthTime.depthColumn'),
      timeColumn: asString(d.timeColumn, 'convert.depthTime.timeColumn'),
      velocity,
      ...(outputUnit !== undefined ? { outputUnit } : {}),
    }
  }

  if (obj.selectColumns !== undefined) {
    out.selectColumns = stringArray(obj.selectColumns, 'convert.selectColumns')
  }

  return out
}

/**
 * Run a `convert` step.
 * @param dataset - input dataset.
 * @param config - validated convert config.
 * @returns the converted dataset plus audit notes.
 */
export function run(dataset: Dataset, config: ConvertConfig): ProcessorResult {
  let columns: Column[] = dataset.columns.map(col => ({ ...col }))
  let rows: CellValue[][] = dataset.rows.map(row => [...row])
  const notes: string[] = []

  // 1. Keep only the selected columns, in order.
  if (config.selectColumns !== undefined && config.selectColumns.length > 0) {
    const order = config.selectColumns.map(name => findColumn(columns, name, 'convert.selectColumns'))
    columns = order.map(i => columns[i] as Column)
    rows = rows.map(row => order.map(i => row[i] ?? null))
    notes.push(`selected columns: ${config.selectColumns.join(', ')}`)
  }

  // 2. Unit conversions.
  if (config.units !== undefined && config.units.length > 0) {
    for (const rule of config.units) {
      const index = findColumn(columns, rule.column, 'convert.units')
      if ((columns[index] as Column).type !== 'number') {
        throw new ExplorationError(`convert.units: column "${rule.column}" is not numeric`, { code: 'VALIDATION_ERROR' })
      }
      let changed = 0
      rows = rows.map((row) => {
        const value = row[index]
        if (typeof value !== 'number') return row
        const converted = convertUnit(value, rule.from, rule.to)
        if (converted === undefined) {
          throw new ExplorationError(`convert.units: unknown unit "${rule.from}" or "${rule.to}"`, {
            code: 'VALIDATION_ERROR',
          })
        }
        changed++
        const next = [...row]
        next[index] = converted
        return next
      })
      columns[index] = { ...(columns[index] as Column), unit: rule.to }
      notes.push(`converted "${rule.column}" ${rule.from}→${rule.to} (${changed} values)`)
    }
  }

  // 3. Depth ↔ two-way-time.
  if (config.depthTime !== undefined) {
    const { mode, depthColumn, timeColumn, velocity } = config.depthTime
    const timeUnit = config.depthTime.outputUnit ?? 'ms'
    if (mode === 'depth-to-time') {
      const depthIndex = findColumn(columns, depthColumn, 'convert.depthTime')
      if ((columns[depthIndex] as Column).type !== 'number') {
        throw new ExplorationError('convert.depthTime: depth column must be numeric', { code: 'VALIDATION_ERROR' })
      }
      let timeIndex = columns.findIndex(col => col.name === timeColumn)
      if (timeIndex < 0) {
        timeIndex = columns.length
        columns.push({ name: timeColumn, type: 'number', unit: timeUnit, role: 'time' })
      }
      rows = rows.map((row) => {
        const padded = row.length < timeIndex + 1
          ? [...row, ...new Array<CellValue>(timeIndex + 1 - row.length).fill(null)]
          : row
        const depth = padded[depthIndex]
        if (typeof depth !== 'number') return padded
        const next = [...padded]
        next[timeIndex] = (2 * depth / velocity) * (timeUnit === 'ms' ? 1000 : 1)
        return next
      })
      notes.push(`converted depth→time: t = 2d/v with v = ${velocity} m/s (${timeColumn} in ${timeUnit})`)
    } else {
      const timeIndex = findColumn(columns, timeColumn, 'convert.depthTime')
      if ((columns[timeIndex] as Column).type !== 'number') {
        throw new ExplorationError('convert.depthTime: time column must be numeric', { code: 'VALIDATION_ERROR' })
      }
      let depthIndex = columns.findIndex(col => col.name === depthColumn)
      if (depthIndex < 0) {
        depthIndex = columns.length
        columns.push({ name: depthColumn, type: 'number', unit: 'm', role: 'depth' })
      }
      rows = rows.map((row) => {
        const padded = row.length < depthIndex + 1
          ? [...row, ...new Array<CellValue>(depthIndex + 1 - row.length).fill(null)]
          : row
        const twt = padded[timeIndex]
        if (typeof twt !== 'number') return padded
        const seconds = twt * (timeUnit === 'ms' ? 1 / 1000 : 1)
        const next = [...padded]
        next[depthIndex] = velocity * seconds / 2
        return next
      })
      notes.push(`converted time→depth: d = vt/2 with v = ${velocity} m/s (${timeColumn} in ${timeUnit})`)
    }
  }

  return { dataset: { columns, rows, meta: carryMeta(dataset.meta, rows.length) }, notes }
}
