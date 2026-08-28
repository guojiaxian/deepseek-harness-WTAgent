/**
 * `cut` step: turn raw `datetime.dat` arrival lines (北京时间) into UTC arrival
 * windows.
 *
 * Each line is parsed as a 北京时间 wall-clock instant, shifted by the workflow
 * timezone offset (default −8 h) to UTC, and paired with the cut window
 * `[cutBefore, cutAfter]`. The `label` (`YYYY-MM-DDTHHMMSS`) names the per-arrival
 * output directory and the cut file names; the actual obspy slicing is delegated
 * to the preset's `tool-bash`.
 * @module @deepseek-ai/dsh-consistency
 */

import { ConsistencyError } from '../errors.ts'
import type { Arrival, CutConfig, ProcessorResult, Workflow } from '../types.ts'
import { asNonNegative, checkKeys, checkObject } from './validate.ts'

/** Seconds/fractional parser result for one arrival line. */
interface ParsedInstant {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Zero-pad a date part to two glyphs. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Format a UTC instant as `YYYY-MM-DDTHHMMSS` (the obspy-style label). */
export function formatUtcLabel(ms: number): string {
  const d = new Date(ms)
  return [
    d.getUTCFullYear(),
    '-', pad2(d.getUTCMonth() + 1), '-', pad2(d.getUTCDate()),
    'T', pad2(d.getUTCHours()), pad2(d.getUTCMinutes()), pad2(d.getUTCSeconds()),
  ].join('')
}

/** Parse an arrival line into its wall-clock fields; throws on malformed input. */
function parseInstant(line: string, index: number): ParsedInstant {
  const spaced = line.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d+))?)?)?$/)
  const compact = line.match(/^(\d{4})(\d{2})(\d{2})[ T]?(\d{2})(\d{2})(\d{2})$/)
  const m = spaced ?? compact
  if (m === null) {
    throw new ConsistencyError(
      `unanable to parse arrival line #${index + 1} "${line}"`,
      { code: 'PARSE_ERROR' },
    )
  }
  return {
    year: Number(m[1] as string),
    month: Number(m[2] as string),
    day: Number(m[3] as string),
    hour: m[4] === undefined ? 0 : Number(m[4]),
    minute: m[5] === undefined ? 0 : Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
  }
}

/** Validate the cut step config. */
export function validate(config: unknown): CutConfig {
  const obj = checkObject(config, 'cut config')
  checkKeys(obj, ['cutBefore', 'cutAfter', 'timezoneOffsetHours', 'outputCutRoot'], 'cut config')
  const out: CutConfig = {}
  for (const key of ['cutBefore', 'cutAfter', 'timezoneOffsetHours'] as const) {
    if (obj[key] !== undefined) out[key] = asNonNegative(obj[key] as number, `cut config.${key}`)
  }
  if (obj.outputCutRoot !== undefined) out.outputCutRoot = String(obj.outputCutRoot)
  return out
}

/**
 * Build one arrival from a raw line.
 * @param line - raw arrival line (北京时间).
 * @param index - line index for error messages.
 * @param offsetHours - hours subtracted to reach UTC.
 * @param before - seconds to keep before the arrival.
 * @param after - seconds to keep after the arrival.
 * @returns the arrival window.
 */
export function buildArrival(line: string, index: number, offsetHours: number, before: number, after: number): Arrival {
  const fields = parseInstant(line, index)
  const localEpochMs = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second)
  const utcMs = localEpochMs - offsetHours * 3600 * 1000
  return {
    line,
    utc: new Date(utcMs).toISOString(),
    label: formatUtcLabel(utcMs),
    cutBefore: before,
    cutAfter: after,
  }
}

/**
 * Run the cut step: parse arrival lines into UTC windows.
 * @param workflow - current workflow (carries raw arrival lines in meta).
 * @param config - validated cut config (window and offset overrides).
 * @returns the workflow with arrivals populated, plus notes.
 */
export function run(workflow: Workflow, config: CutConfig): ProcessorResult {
  const raw = workflow.meta.rawArrivalLines ?? []
  if (raw.length === 0) {
    return { workflow, notes: ['no arrival lines; cut skipped'] }
  }
  const offset = config.timezoneOffsetHours ?? workflow.timezoneOffsetHours
  const before = config.cutBefore ?? workflow.cutBefore
  const after = config.cutAfter ?? workflow.cutAfter
  const outputCutRoot = config.outputCutRoot ?? workflow.outputCutRoot
  const arrivals: Arrival[] = raw.map((line, index) => buildArrival(line, index, offset, before, after))
  return {
    workflow: { ...workflow, arrivals, outputCutRoot },
    notes: [`parsed ${arrivals.length} arrivals from Beijing time to UTC`],
  }
}
