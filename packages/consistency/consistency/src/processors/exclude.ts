/**
 * `exclude` step: analyze measured per-station data offsets and report which
 * stations need to be excluded.
 *
 * After plotting, the preset measures each station's DC baseline offset / static
 * displacement with obspy and hands the magnitudes to this processor (through
 * the workflow's meta.offsets or as the dedicated tool's argument). Any station
 * whose absolute offset reaches the configured threshold is flagged in the
 * workflow's `exclusions` list as a device to mark unusable. The processor is
 * deliberately analysis-only: it never mutates plot batches or data — removing
 * the abnormal device from the array is a manual operator action, so the engine
 * only produces the "which station to exclude" report for the human to act on.
 * @module @deepseek-ai/dsh-consistency
 */

import type {
  ExcludeConfig, Exclusion, OffsetMetric, ProcessorResult,
  StationOffset, Workflow,
} from '../types.ts'
import { asEnum, asNonNegative, asString, checkKeys, checkObject } from './validate.ts'

const METRICS: readonly OffsetMetric[] = ['samples', 'dc-offset', 'amplitude']

/** Validate the exclude step config. */
export function validate(config: unknown): ExcludeConfig {
  const obj = checkObject(config, 'exclude config')
  checkKeys(obj, ['threshold', 'metric', 'arrivalLabel'], 'exclude config')
  const out: ExcludeConfig = { threshold: asNonNegative(obj.threshold, 'exclude config.threshold') }
  if (obj.metric !== undefined) out.metric = asEnum(obj.metric, METRICS, 'exclude config.metric')
  if (obj.arrivalLabel !== undefined) out.arrivalLabel = asString(obj.arrivalLabel, 'exclude config.arrivalLabel')
  return out
}

/**
 * Run the exclude step: judge measured offsets against the threshold and report
 * which stations to exclude. Plot batches are left untouched — the actual device
 * removal is a manual operator action.
 * @param workflow - current workflow (carries plot batches; offsets come from the
 * third argument or fall back to workflow.meta.offsets).
 * @param config - validated exclude config (threshold, metric, optional slice).
 * @param offsets - measured per-station offset magnitudes; defaults to the
 * workflow's recorded meta.offsets when omitted.
 * @returns the workflow with the exclusion report appended, plus notes.
 */
export function run(
  workflow: Workflow,
  config: ExcludeConfig,
  offsets: readonly StationOffset[] = workflow.meta.offsets ?? [],
): ProcessorResult {
  if (offsets.length === 0) {
    return { workflow, notes: ['no measured offsets; exclude skipped'] }
  }
  const threshold = config.threshold
  const metric = config.metric ?? 'samples'

  const exclusions: Exclusion[] = []
  for (const entry of offsets) {
    const magnitude = Math.abs(entry.value)
    if (magnitude >= threshold) {
      exclusions.push({
        station: entry.station,
        offset: entry.value,
        threshold,
        metric,
        reason: `${metric} offset ${entry.value} reaches the ${threshold} threshold`,
        ...(config.arrivalLabel !== undefined ? { arrivalLabel: config.arrivalLabel } : {}),
      })
    }
  }
  if (exclusions.length === 0) {
    return { workflow, notes: [`no station offset reached the ${threshold} threshold (${metric})`] }
  }

  const meta: Record<string, unknown> = { ...workflow.meta }
  if (workflow.meta.offsets !== offsets) meta.offsets = offsets
  const report = exclusions.map(e => e.station)
  return {
    workflow: {
      ...workflow,
      exclusions: [...workflow.exclusions, ...exclusions],
      meta,
    },
    notes: [
      `excluding ${report.length} station(s) for the operator: offset >= ${threshold} (${metric}): ${report.join(', ')}; plot batches unchanged, removal is manual`,
    ],
  }
}
