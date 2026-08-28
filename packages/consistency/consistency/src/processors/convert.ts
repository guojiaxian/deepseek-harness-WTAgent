/**
 * `convert` step: select the mseed2sac converter per seed kind and build the
 * conversion plan.
 *
 * Physical conversion (running the converter, writing `台站/*.SAC`) is delegated
 * to the preset's `tool-bash`/`tool-fs`. This processor only validates that every
 * `C`-kind seed has a `C` converter and every `E`-kind seed an `E` converter
 * (`INCOMPLETE_DATA` otherwise), classifies each seed, and records an ordered
 * conversion plan on the workflow meta for the agent to execute.
 * @module @deepseek-ai/dsh-consistency
 */

import { ConsistencyError } from '../errors.ts'
import type { ConvertConfig, ProcessorResult, SeedKind, Workflow } from '../types.ts'
import { checkKeys, checkObject } from './validate.ts'

/** One planned conversion action the agent executes with the converter tooling. */
export interface ConversionPlanEntry {
  /** Station target directory the SAC output lands under. */
  readonly station: string
  /** Seed file to convert. */
  readonly seed: string
  /** Seed kind that selects the converter. */
  readonly kind: SeedKind
  /** Resolved converter command for this seed (never null when planned). */
  readonly converter: string
}

/** Validate the convert step config. */
export function validate(config: unknown): ConvertConfig {
  const obj = checkObject(config, 'convert config')
  checkKeys(obj, ['converterC', 'converterE'], 'convert config')
  const out: ConvertConfig = {}
  for (const key of ['converterC', 'converterE'] as const) {
    if (obj[key] !== undefined) {
      out[key] = obj[key] === null ? null : String(obj[key])
    }
  }
  return out
}

/** Resolve the converter command for a seed kind, honoring the step override. */
function resolveConverter(
  kind: SeedKind,
  workflow: Workflow,
  config: ConvertConfig,
): string | null {
  if (kind === 'C') return config.converterC !== undefined ? config.converterC : workflow.converterC
  if (kind === 'E') return config.converterE !== undefined ? config.converterE : workflow.converterE
  return null
}

/**
 * Run the convert step: validate converters and build the conversion plan.
 * @param workflow - current workflow.
 * @param config - validated convert config (optional converter overrides).
 * @returns the workflow with the conversion plan on its meta, plus notes.
 */
export function run(workflow: Workflow, config: ConvertConfig): ProcessorResult {
  const plan: ConversionPlanEntry[] = []
  const skipped: string[] = []
  const missing: string[] = []
  for (const station of workflow.stations) {
    for (const seed of station.seedFiles) {
      const converter = resolveConverter(seed.kind, workflow, config)
      if (seed.kind === 'other') {
        skipped.push(`${station.targetName}/${seed.name}`)
        continue
      }
      if (converter === null) {
        missing.push(`${station.targetName}/${seed.name} (${seed.kind})`)
        continue
      }
      plan.push({ station: station.targetName, seed: seed.name, kind: seed.kind, converter })
    }
  }
  if (missing.length > 0) {
    throw new ConsistencyError(
      `no converter configured for seed(s): ${missing.join(', ')}`,
      { code: 'INCOMPLETE_DATA' },
    )
  }
  const meta: Record<string, unknown> = { ...workflow.meta }
  if (plan.length > 0) meta.conversionPlan = plan
  const notes = [`planned ${plan.length} conversions`]
  if (skipped.length > 0) notes.push(`${skipped.length} unselected-kind seeds skipped`)
  return { workflow: { ...workflow, meta }, notes }
}
