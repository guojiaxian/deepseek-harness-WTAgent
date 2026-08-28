/**
 * `ingest` step: build a workflow from the interchange JSON payload.
 *
 * The agent preset collects the raw arrival directories, their seed files and
 * the `datetime.dat` arrival lines through `tool-fs`/`tool-bash`, then hands
 * them to this processor as a compact JSON document. The processor only decides
 * the *domain* shape (roots, converters, timing, station/seed classification);
 * real I/O stays with the preset tools.
 * @module @deepseek-ai/dsh-consistency
 */

import { ConsistencyError } from '../errors.ts'
import type { IngestConfig, Limits, ProcessingInput, ProcessorResult, SeedFile, SeedKind, Station, Workflow } from '../types.ts'
import { asArray, asNonNegative, asPositiveInt, asString, checkKeys, checkObject } from './validate.ts'

/** Wrapped `${what}` of the ingest payload key at a nested path. */
type Path = string

/** Raw interchange payload of the ingest step. */
export interface IngestPayload {
  /** Project label, e.g. `0756_260818`. */
  project: string
  /** Optional override object merged below the step config. */
  config?: Record<string, unknown>
  /** Station directories with optional seed file names. */
  stations?: { name: string; seeds?: string[] }[]
  /** Raw `datetime.dat` arrival lines (北京时间), parsed by the cut step. */
  arrivalLines?: unknown
}

/**
 * Derive the seed kind from its file name prefix: `C` → `C`, `E` → `E`, else
 * `other`. The prefix selects the mseed2sac converter.
 * @param name - seed (mini-SEED) file name.
 * @returns the seed kind.
 */
export function classifySeed(name: string): SeedKind {
  if (name.startsWith('C')) return 'C'
  if (name.startsWith('E')) return 'E'
  return 'other'
}

/**
 * Build a {@link SeedFile} from a raw file name.
 * @param name - seed file name.
 * @returns the classified seed file.
 */
export function toSeedFile(name: string): SeedFile {
  return { name, kind: classifySeed(name) }
}

/**
 * Build a {@link Station} from the ingest payload entry; the rename target is
 * not yet known, so it mirrors the source name until the rename step runs.
 * @param sourceName - source directory name, e.g. `C0756_260818`.
 * @param seeds - optional raw seed file names.
 * @returns the station.
 */
export function buildStation(sourceName: string, seeds: readonly string[]): Station {
  return {
    sourceName,
    targetName: sourceName,
    renameApplied: false,
    seedFiles: seeds.map(toSeedFile),
  }
}

/** Validated, defaulted ingest config. */
interface ResolvedIngestConfig {
  baseDir: string
  inputRoot: string
  outputSacRoot: string
  outputCutRoot: string
  outputFigRoot: string
  converterC: string | null
  converterE: string | null
  channel: string
  cutBefore: number
  cutAfter: number
  timezoneOffsetHours: number
  batchSize: number
}

/** Merge payload config below step config and apply defaults. */
function resolveConfig(step: IngestConfig, payload: IngestPayload | undefined): ResolvedIngestConfig {
  const merged: Record<string, unknown> = { ...(payload?.config ?? {}) }
  for (const key of ['baseDir', 'inputRoot', 'outputSacRoot', 'outputCutRoot', 'outputFigRoot',
    'converterC', 'converterE', 'channel', 'cutBefore', 'cutAfter', 'timezoneOffsetHours',
    'batchSize'] as const) {
    const value = (step as Record<string, unknown>)[key] ?? merged[key]
    if (value !== undefined) merged[key] = value
  }
  const baseDir = asString(merged.baseDir ?? '.', 'config.baseDir')
  const inputRoot = asString(merged.inputRoot ?? 'raw_data', 'config.inputRoot')
  const outputSacRoot = asString(merged.outputSacRoot ?? 'sac', 'config.outputSacRoot')
  const outputCutRoot = asString(merged.outputCutRoot ?? 'cut_wave', 'config.outputCutRoot')
  const outputFigRoot = asString(merged.outputFigRoot ?? 'fig_time_wave', 'config.outputFigRoot')
  const converterC = merged.converterC === null || merged.converterC === undefined
    ? maybeString(merged.converterC, 'config.converterC')
    : asString(merged.converterC, 'config.converterC')
  const converterE = merged.converterE === null || merged.converterE === undefined
    ? maybeString(merged.converterE, 'config.converterE')
    : asString(merged.converterE, 'config.converterE')
  const channel = asString(merged.channel ?? 'Z', 'config.channel')
  const cutBefore = asNonNegative(merged.cutBefore ?? 1, 'config.cutBefore')
  const cutAfter = asNonNegative(merged.cutAfter ?? 2, 'config.cutAfter')
  const timezoneOffsetHours = asNonNegative(merged.timezoneOffsetHours ?? 8, 'config.timezoneOffsetHours')
  const batchSize = asPositiveInt(merged.batchSize ?? 40, 'config.batchSize')
  return {
    baseDir, inputRoot, outputSacRoot, outputCutRoot, outputFigRoot,
    converterC, converterE, channel, cutBefore, cutAfter, timezoneOffsetHours, batchSize,
  }
}

/** Normalize an optional converter command (null/'' → null). */
function maybeString(value: unknown, what: Path): string | null {
  if (value === null || value === undefined || value === '') return null
  return asString(value, what)
}

/** Validate the ingest step config. */
export function validate(config: unknown): IngestConfig {
  const obj = checkObject(config, 'ingest config')
  checkKeys(obj, [
    'baseDir', 'inputRoot', 'outputSacRoot', 'outputCutRoot', 'outputFigRoot',
    'converterC', 'converterE', 'channel', 'cutBefore', 'cutAfter', 'timezoneOffsetHours',
    'batchSize',
  ], 'ingest config')
  const out: IngestConfig = {}
  for (const key of ['baseDir', 'inputRoot', 'outputSacRoot', 'outputCutRoot', 'outputFigRoot',
    'converterC', 'converterE', 'channel'] as const) {
    if (obj[key] !== undefined) {
      const value = obj[key]
      if (value === null && (key === 'converterC' || key === 'converterE')) {
        ;(out as Record<string, unknown>)[key] = null
      } else {
        (out as Record<string, unknown>)[key] = asString(value as string, `ingest config.${key}`)
      }
    }
  }
  for (const key of ['cutBefore', 'cutAfter', 'timezoneOffsetHours'] as const) {
    if (obj[key] !== undefined) (out as Record<string, unknown>)[key] = asNonNegative(obj[key] as number, `ingest config.${key}`)
  }
  if (obj.batchSize !== undefined) out.batchSize = asPositiveInt(obj.batchSize, 'ingest config.batchSize')
  return out
}

/**
 * Parse a station entry from the payload.
 * @param raw - raw station entry.
 * @param index - payload station index.
 * @returns the station.
 */
function parseStation(raw: unknown, index: number): Station {
  const obj = checkObject(raw, `payload.stations[${index}]`)
  checkKeys(obj, ['name', 'seeds'], `payload.stations[${index}]`)
  const name = asString(obj.name, `payload.stations[${index}].name`)
  const seeds: string[] = []
  if (obj.seeds !== undefined) {
    seeds.push(...asArray(obj.seeds, `payload.stations[${index}].seeds`).map(
      (entry, i) => asString(entry, `payload.stations[${index}].seeds[${i}]`),
    ))
  }
  return buildStation(name, seeds)
}

/**
 * Run the ingest step: parse the interchange JSON into a workflow.
 * @param input - raw payload consumed by this step.
 * @param config - validated ingest config.
 * @param limits - resource limits (input byte budget).
 * @returns the workflow plus audit notes.
 */
export function run(input: ProcessingInput, config: IngestConfig, limits: Limits): ProcessorResult {
  const text = toText(input.data)
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > limits.maxInputBytes) {
    throw new ConsistencyError(
      `ingest input of ${bytes.byteLength} bytes exceeds the ${limits.maxInputBytes}-byte limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  const payload = parsePayload(text)
  const resolved = resolveConfig(config, payload)
  const stations = payload.stations?.map((entry, i) => parseStation(entry, i)) ?? []
  const arrivalLines = payload.arrivalLines === undefined ? [] : stringArray(payload.arrivalLines, 'payload.arrivalLines')
  const meta: Record<string, unknown> = {}
  if (arrivalLines.length > 0) meta.rawArrivalLines = arrivalLines
  if (input.source !== undefined) meta.source = input.source

  const workflow: Workflow = {
    project: payload.project,
    baseDir: resolved.baseDir,
    inputRoot: resolved.inputRoot,
    outputSacRoot: resolved.outputSacRoot,
    outputCutRoot: resolved.outputCutRoot,
    outputFigRoot: resolved.outputFigRoot,
    converterC: resolved.converterC,
    converterE: resolved.converterE,
    channel: resolved.channel,
    cutBefore: resolved.cutBefore,
    cutAfter: resolved.cutAfter,
    timezoneOffsetHours: resolved.timezoneOffsetHours,
    batchSize: resolved.batchSize,
    stations,
    arrivals: [],
    plotBatches: [],
    exclusions: [],
    meta,
  }
  const notes = [
    `parsed ${stations.length} stations, ${arrivalLines.length} arrival lines`,
    input.source !== undefined ? `source ${input.source}` : '',
  ].filter(Boolean)
  return { workflow, notes }
}

/** Parse the interchange JSON payload. */
function parsePayload(text: string): IngestPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ConsistencyError(
      `ingest input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'PARSE_ERROR' },
    )
  }
  const obj = checkObject(parsed, 'payload')
  checkKeys(obj, ['project', 'config', 'stations', 'arrivalLines'], 'payload')
  const project = asString(obj.project, 'payload.project')
  const payload: IngestPayload = { project }
  if (obj.config !== undefined) payload.config = checkObject(obj.config, 'payload.config')
  if (obj.stations !== undefined) {
    payload.stations = asArray(obj.stations, 'payload.stations').map(
      (entry, i) => checkObject(entry, `payload.stations[${i}]`),
    ) as { name: string; seeds?: string[] }[]
  }
  if (obj.arrivalLines !== undefined) payload.arrivalLines = obj.arrivalLines
  return payload
}

/** Normalize text input. */
function toText(data: Uint8Array | string): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data)
}

/** Coerce payload.arrivalLines into a string array. */
function stringArray(value: unknown, what: string): string[] {
  return asArray(value, what).map((entry, i) => asString(entry, `${what}[${i}]`))
}
