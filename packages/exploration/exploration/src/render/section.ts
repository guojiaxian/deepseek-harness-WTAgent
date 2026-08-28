/**
 * Seismic section model built from a tabular exploration dataset.
 *
 * A `profile` step renders a 2-D seismic section: traces on the horizontal
 * axis, samples (time/depth) on the vertical axis, amplitude as color. The
 * builder accepts both the SEG-Y long format (one row per sample with
 * `trace`, `sampleIndex`, `value`) and the short format (one row per trace
 * with `sample_<i>` columns); anything else is an incomplete dataset and
 * raises `INCOMPLETE_DATA`. Missing cells fill 0; the amplitude range used
 * for color normalization covers only the finite samples.
 * @module @deepseek-ai/dsh-exploration
 */

import { columnIndex } from '../dataset.ts'
import { ExplorationError } from '../errors.ts'
import type { Dataset } from '../types.ts'

/** A 2-D seismic section in sample-major, trace-minor layout. */
export interface SectionModel {
  /** Section kind; only seismic sections are produced. */
  readonly kind: 'seismic'
  /** Number of traces (horizontal axis). */
  readonly traceCount: number
  /** Number of samples per trace (vertical axis). */
  readonly sampleCount: number
  /** Minimum finite amplitude (color-map low end). */
  readonly min: number
  /** Maximum finite amplitude (color-map high end). */
  readonly max: number
  /** Amplitude grid indexed `sample * traceCount + trace`; missing cells hold 0. */
  readonly values: Float32Array
  /** Horizontal axis label. */
  readonly xLabel: string
  /** Vertical axis label. */
  readonly yLabel: string
}

/** One `sample_*` column of the short format. */
interface SampleColumn {
  readonly name: string
  readonly index: number
}

/**
 * Build a seismic section from a dataset, raising `INCOMPLETE_DATA` when the
 * dataset carries no seismic columns, no rows, or no finite amplitudes.
 * @param dataset - exploration dataset to render.
 * @returns the section model.
 */
export function buildSection(dataset: Dataset): SectionModel {
  const traceIdx = columnIndex(dataset, 'trace')
  const sampleIdx = columnIndex(dataset, 'sampleIndex')
  const valueIdx = columnIndex(dataset, 'value')
  if (traceIdx >= 0 && sampleIdx >= 0 && valueIdx >= 0) {
    return buildLongFormat(dataset, traceIdx, sampleIdx, valueIdx)
  }
  const samples = sampleColumns(dataset)
  if (traceIdx >= 0 && samples.length > 0) {
    return buildShortFormat(dataset, samples)
  }
  throw incomplete('dataset has no seismic columns (expected trace/value/sampleIndex or trace/sample_*)')
}

/**
 * Rasterize a section into a palette-index grid.
 * @param section - section to render.
 * @param width - output raster width in pixels.
 * @param height - output raster height in pixels.
 * @returns `width * height` palette indices in row-major order.
 */
export function rasterize(section: SectionModel, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  const range = section.max - section.min
  for (let y = 0; y < height; y++) {
    const sample = Math.min(section.sampleCount - 1, Math.floor((y / height) * section.sampleCount))
    for (let x = 0; x < width; x++) {
      const trace = Math.min(section.traceCount - 1, Math.floor((x / width) * section.traceCount))
      const value = section.values[sample * section.traceCount + trace] as number
      const normalized = range === 0 ? 0.5 : (value - section.min) / range
      out[y * width + x] = clampIndex(Math.round(normalized * 255))
    }
  }
  return out
}

/** Section from SEG-Y long format: one row per sample. */
function buildLongFormat(dataset: Dataset, traceIdx: number, sampleIdx: number, valueIdx: number): SectionModel {
  const traceToIndex = new Map<number, number>()
  const sampleToIndex = new Map<number, number>()
  const cells: Array<readonly [trace: number, sample: number, value: number]> = []
  let finite = 0
  let min = Infinity
  let max = -Infinity
  for (const row of dataset.rows) {
    const trace = row[traceIdx]
    const sample = row[sampleIdx]
    const value = row[valueIdx]
    if (!isFiniteNumber(trace) || !isFiniteNumber(sample) || trace < 0 || sample < 0) continue
    let t = traceToIndex.get(trace)
    if (t === undefined) {
      t = traceToIndex.size
      traceToIndex.set(trace, t)
    }
    let s = sampleToIndex.get(sample)
    if (s === undefined) {
      s = sampleToIndex.size
      sampleToIndex.set(sample, s)
    }
    if (isFiniteNumber(value)) {
      if (value < min) min = value
      if (value > max) max = value
      finite++
    }
    cells.push([t, s, isFiniteNumber(value) ? value : 0])
  }
  if (cells.length === 0) throw incomplete('dataset has no usable trace/sample rows')
  if (finite === 0) throw incomplete('dataset has no finite amplitude values')
  const traceCount = traceToIndex.size
  const sampleCount = sampleToIndex.size
  const values = new Float32Array(traceCount * sampleCount)
  for (const [t, s, value] of cells) {
    values[s * traceCount + t] = value
  }
  return {
    kind: 'seismic',
    traceCount,
    sampleCount,
    min,
    max,
    values,
    xLabel: 'trace',
    yLabel: 'sample',
  }
}

/** Section from SEG-Y short format: one row per trace with `sample_*` columns. */
function buildShortFormat(dataset: Dataset, samples: readonly SampleColumn[]): SectionModel {
  if (dataset.rows.length === 0) throw incomplete('dataset has no rows')
  const traceCount = dataset.rows.length
  const sampleCount = samples.length
  let finite = 0
  let min = Infinity
  let max = -Infinity
  const values = new Float32Array(traceCount * sampleCount)
  for (let t = 0; t < traceCount; t++) {
    const row = dataset.rows[t] as readonly unknown[]
    for (let s = 0; s < sampleCount; s++) {
      const value = row[(samples[s] as SampleColumn).index]
      if (isFiniteNumber(value)) {
        if (value < min) min = value
        if (value > max) max = value
        finite++
        values[s * traceCount + t] = value
      }
    }
  }
  if (finite === 0) throw incomplete('dataset has no finite amplitude values')
  return {
    kind: 'seismic',
    traceCount,
    sampleCount,
    min,
    max,
    values,
    xLabel: 'trace',
    yLabel: 'sample',
  }
}

/** The `sample_*` columns of a dataset, in column order. */
function sampleColumns(dataset: Dataset): SampleColumn[] {
  const out: SampleColumn[] = []
  dataset.columns.forEach((column, index) => {
    if (column.name.startsWith('sample_')) out.push({ name: column.name, index })
  })
  return out
}

/** Whether a cell is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Clamp a palette index to the 0..255 range. */
function clampIndex(index: number): number {
  return Math.max(0, Math.min(255, index))
}

/** An `INCOMPLETE_DATA` error for a profile-render failure. */
function incomplete(message: string): ExplorationError {
  return new ExplorationError(message, { code: 'INCOMPLETE_DATA' })
}
