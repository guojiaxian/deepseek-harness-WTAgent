/**
 * Canonical workflow fingerprinting for traceability.
 *
 * Every pipeline step records the sha256 of its input workflow so an operator can
 * prove which input produced which output. Project, roots, stations, arrivals and
 * plot batches keep their declared order; meta keys are sorted so two workflows
 * with identical logical content hash identically regardless of meta-key
 * insertion order.
 * @module @deepseek-ai/dsh-consistency
 */

import { createHash } from 'node:crypto'
import type { Workflow } from './types.ts'

/**
 * Compute the canonical sha256 of a workflow.
 * @param workflow - workflow to fingerprint.
 * @returns lowercase hex sha256 digest.
 */
export function checksumWorkflow(workflow: Workflow): string {
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(workflow.meta).sort()) {
    meta[key] = workflow.meta[key]
  }
  const canonical = JSON.stringify({
    project: workflow.project,
    baseDir: workflow.baseDir,
    inputRoot: workflow.inputRoot,
    outputSacRoot: workflow.outputSacRoot,
    outputCutRoot: workflow.outputCutRoot,
    outputFigRoot: workflow.outputFigRoot,
    converterC: workflow.converterC,
    converterE: workflow.converterE,
    channel: workflow.channel,
    cutBefore: workflow.cutBefore,
    cutAfter: workflow.cutAfter,
    timezoneOffsetHours: workflow.timezoneOffsetHours,
    batchSize: workflow.batchSize,
    stations: workflow.stations,
    arrivals: workflow.arrivals,
    plotBatches: workflow.plotBatches,
    exclusions: workflow.exclusions,
    meta,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Compute the sha256 of a raw input buffer, used for the input fingerprint of a
 * pipeline run.
 * @param data - raw input bytes.
 * @returns lowercase hex sha256 digest.
 */
export function checksumBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
