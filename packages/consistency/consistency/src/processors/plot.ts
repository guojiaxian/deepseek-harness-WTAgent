/**
 * `plot` step: partition stations into plot batches for every arrival.
 *
 * Mirrors `plot_cut_test_wave_sac_v2.py`: each arrival directory renders all
 * stations stacked on one canvas, grouped in batches of `batchSize` (default 40).
 * Stations sort numerically by their leading integer; figure height is dynamic —
 * offsets are `(n-1-i)*1.5` for the `n` stations actually in a batch, so the last
 * partial batch is more compact instead of leaving blank space; the Y label is
 * `WT.<station[:4]>`. The actual matplotlib rendering is delegated to the preset's
 * `tool-bash`.
 * @module @deepseek-ai/dsh-consistency
 */

import type { PlotBatch, PlotConfig, ProcessorResult, Workflow } from '../types.ts'
import { asPositiveInt, asString, checkKeys, checkObject } from './validate.ts'

/** Default vertical spacing between stacked traces (matches the python). */
const Y_SPACING = 1.5

/** Extract the leading integer of a station name, or NaN when absent. */
function leadingNumber(name: string): number {
  const m = name.match(/^\d+/)
  return m === null ? Number.NaN : Number(m[0] as string)
}

/** Sort station names numerically by leading integer, lexicographic otherwise. */
function sortStations(names: readonly string[]): readonly string[] {
  return [...names].sort((a, b) => {
    const na = leadingNumber(a)
    const nb = leadingNumber(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
}

/** Validate the plot step config. */
export function validate(config: unknown): PlotConfig {
  const obj = checkObject(config, 'plot config')
  checkKeys(obj, ['outputFigRoot', 'channel', 'batchSize'], 'plot config')
  const out: PlotConfig = {}
  if (obj.outputFigRoot !== undefined) out.outputFigRoot = asString(obj.outputFigRoot, 'plot config.outputFigRoot')
  if (obj.channel !== undefined) out.channel = asString(obj.channel, 'plot config.channel')
  if (obj.batchSize !== undefined) out.batchSize = asPositiveInt(obj.batchSize, 'plot config.batchSize')
  return out
}

/**
 * Run the plot step: build the plotting batches.
 * @param workflow - current workflow (carries arrivals and stations).
 * @param config - validated plot config (root, channel, batch size overrides).
 * @returns the workflow with plot batches populated, plus notes.
 */
export function run(workflow: Workflow, config: PlotConfig): ProcessorResult {
  if (workflow.arrivals.length === 0 || workflow.stations.length === 0) {
    return { workflow, notes: ['no arrivals or stations; plot skipped'] }
  }
  const batchSize = config.batchSize ?? workflow.batchSize
  const outputFigRoot = config.outputFigRoot ?? workflow.outputFigRoot
  const channel = config.channel ?? workflow.channel
  const unique = [...new Set(workflow.stations.map(station => station.targetName))]
  const sorted = sortStations(unique)
  if (sorted.length === 0) {
    return { workflow, notes: ['no stations to plot; plot skipped'] }
  }
  const plotBatches: PlotBatch[] = []
  for (const arrival of workflow.arrivals) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const chunk = sorted.slice(i, i + batchSize)
      // dynamic height: offsets/ymax derive from the actual batch size so the
      // figure height matches the number of stations actually plotted (the last
      // partial batch is more compact instead of leaving blank space).
      const offsets = chunk.map((_, idx) => (chunk.length - 1 - idx) * Y_SPACING)
      plotBatches.push({
        arrivalLabel: arrival.label,
        batchIndex: i / batchSize,
        stations: chunk,
        yLabels: chunk.map(name => `WT.${name.slice(0, 4)}`),
        offsets,
        yMax: chunk.length * Y_SPACING,
        ySpacing: Y_SPACING,
      })
    }
  }
  const meta: Record<string, unknown> = { ...workflow.meta }
  meta.plotSettings = {
    channel,
    batchSize,
    outputFigRoot,
    // All batch figures share one flat directory (no per-arrival subfolders);
    // the arrival label is embedded in the file name to avoid collisions.
    fileNamePattern: 'wave_z_<arrivalLabel>_batch<N>.png',
    combinedImage: 'combined_wave_all_z.png',
  }
  return {
    workflow: { ...workflow, plotBatches, outputFigRoot, meta },
    notes: [`planned ${plotBatches.length} plot batches over ${sorted.length} stations x ${workflow.arrivals.length} arrivals`],
  }
}
