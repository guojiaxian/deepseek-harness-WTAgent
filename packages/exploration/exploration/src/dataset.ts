/**
 * Dataset helpers shared by the processors.
 *
 * Datasets are immutable: processors build a fresh object, carrying extension
 * meta forward through the pipeline while refreshing derived fields such as
 * `rowCount`. Column lookups fail loud on unknown names so a mistyped pipeline
 * config cannot silently pass through.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from './errors.ts'
import type { CellValue, Dataset, DatasetMeta } from './types.ts'

/**
 * Build the next dataset meta, preserving processor extension keys (e.g. SEG-Y
 * headers, statistics, anomalies) and dropping the pipeline-owned `provenance`
 * (the pipeline re-appends it per step).
 * @param meta - previous dataset meta.
 * @param rowCount - new row count.
 * @returns the carried meta.
 */
export function carryMeta(meta: DatasetMeta, rowCount: number): DatasetMeta {
  const carried: Record<string, unknown> = {}
  for (const key of Object.keys(meta)) {
    if (key !== 'rowCount' && key !== 'provenance') carried[key] = meta[key]
  }
  carried.rowCount = rowCount
  return carried
}

/**
 * Index of a column by name within a column list, failing loud on unknown names.
 * @param columns - columns to search.
 * @param name - column name.
 * @param what - human-readable reference context for error messages.
 * @returns the column index.
 */
export function findColumn(columns: readonly { name: string }[], name: string, what: string): number {
  const index = columns.findIndex(col => col.name === name)
  if (index < 0) {
    throw new ExplorationError(`${what}: unknown column "${name}"`, { code: 'VALIDATION_ERROR' })
  }
  return index
}

/**
 * Index of a column by name, or `-1` when absent.
 * @param dataset - dataset to search.
 * @param name - column name.
 * @returns the column index.
 */
export function columnIndex(dataset: Dataset, name: string): number {
  for (let c = 0; c < dataset.columns.length; c++) {
    if ((dataset.columns[c] as { name: string }).name === name) return c
  }
  return -1
}

/**
 * Resolve a column name to its index, failing loud on unknown columns.
 * @param dataset - dataset to search.
 * @param name - column name.
 * @param what - human-readable reference context for error messages.
 * @returns the column index.
 */
export function requireColumn(dataset: Dataset, name: string, what: string): number {
  const index = columnIndex(dataset, name)
  if (index < 0) {
    throw new ExplorationError(`${what}: unknown column "${name}"`, { code: 'VALIDATION_ERROR' })
  }
  return index
}

/**
 * Column values as an array (nulls preserved), resolving by name.
 * @param dataset - dataset to read.
 * @param name - column name.
 * @param what - human-readable reference context for error messages.
 * @returns the values in row order.
 */
export function columnValues(dataset: Dataset, name: string, what: string): CellValue[] {
  const index = requireColumn(dataset, name, what)
  return dataset.rows.map(row => row[index] ?? null)
}
