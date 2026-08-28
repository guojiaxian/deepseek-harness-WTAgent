/**
 * `rename` step: compute the uniform directory name of each station.
 *
 * Rule (mirrors `cds_files_rename.py`): a `C`-prefixed name strips the leading
 * `C` (`C0756_260818` → `0756_260818`); anything else keeps its first 4 glyphs
 * (`0756_260818` → `0756`). A target already claimed by an earlier station is
 * skipped (guarded) so a rename never silently overwrites another directory.
 * @module @deepseek-ai/dsh-consistency
 */

import type { ProcessorResult, RenameConfig, Station, Workflow } from '../types.ts'
import { asString, checkKeys, checkObject } from './validate.ts'

/**
 * Compute the uniform rename target of a directory name.
 * @param sourceName - source directory name.
 * @returns the target name per the rename rule.
 */
export function computeTargetName(sourceName: string): string {
  if (sourceName.startsWith('C')) return asString(sourceName.slice(1), 'station name')
  return asString(sourceName.slice(0, 4), 'station name')
}

/** Validate the rename step config; it carries no tunables. */
export function validate(config: unknown): RenameConfig {
  const obj = checkObject(config, 'rename config')
  checkKeys(obj, [], 'rename config')
  return {}
}

/**
 * Run the rename step over the workflow's stations.
 * @param workflow - current workflow.
 * @param config - validated rename config (unused; rule is fixed).
 * @returns the workflow plus audit notes.
 */
export function run(workflow: Workflow, config: RenameConfig): ProcessorResult {
  void config
  const claimed = new Set<string>()
  const stations: Station[] = []
  const notes: string[] = []
  for (const station of workflow.stations) {
    const computed = computeTargetName(station.sourceName)
    if (computed === station.sourceName) {
      stations.push(station)
      claimed.add(station.sourceName)
      continue
    }
    if (claimed.has(computed)) {
      stations.push({ ...station, targetName: station.sourceName, renameApplied: false })
      notes.push(`skip ${station.sourceName} -> ${computed} (target already occupied)`)
      continue
    }
    claimed.add(computed)
    stations.push({ ...station, targetName: computed, renameApplied: true })
    notes.push(`${station.sourceName} -> ${computed}`)
  }
  return { workflow: { ...workflow, stations }, notes }
}
