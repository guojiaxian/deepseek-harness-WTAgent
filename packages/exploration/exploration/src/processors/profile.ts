/**
 * `profile` step processor: render a seismic section and attach it to the
 * dataset meta.
 *
 * The step is a pure view over an already-validated dataset: it builds a 2-D
 * seismic section (SEG-Y long format `trace`/`sampleIndex`/`value` or short
 * format `trace` + `sample_*` columns), rasterizes it with the chosen color
 * map, and stores PNG and/or SVG renders under `meta.profile`. A dataset
 * without seismic columns, rows, or finite amplitudes raises
 * `INCOMPLETE_DATA`, which fails the pipeline run loud and records the reason
 * on the run record.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from '../errors.ts'
import { palette } from '../render/colormap.ts'
import { encodePng, toBase64 } from '../render/png.ts'
import { buildSection, rasterize } from '../render/section.ts'
import { svgFromSection } from '../render/svg.ts'
import type { Dataset, ProfileConfig, ProfileOutput, ProcessorResult } from '../types.ts'
import { asArray, asEnum, asPositiveInt, asString, checkKeys, checkObject } from './validate.ts'

/** Default raster width in pixels. */
const DEFAULT_WIDTH = 640
/** Default raster height in pixels. */
const DEFAULT_HEIGHT = 480
/** Maximum raster dimension in pixels. */
const MAX_DIMENSION = 1024
/** Default output formats. */
const DEFAULT_FORMATS: readonly ('svg' | 'png')[] = ['svg', 'png']
/** Default color map. */
const DEFAULT_COLOR_MAP = 'seismic'

/**
 * Validate a `profile` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): ProfileConfig {
  const obj = checkObject(config, 'profile config')
  checkKeys(obj, ['formats', 'width', 'height', 'colorMap', 'title'], 'profile')
  const out: ProfileConfig = {}
  if (obj.formats !== undefined) {
    const formats = asArray(obj.formats, 'profile.formats')
    if (formats.length === 0) {
      throw new ExplorationError('profile.formats must not be empty', { code: 'VALIDATION_ERROR' })
    }
    out.formats = formats.map((entry, i) => asEnum(entry, ['svg', 'png'], `profile.formats[${i}]`))
  }
  if (obj.width !== undefined) out.width = asDimension(obj.width, 'profile.width')
  if (obj.height !== undefined) out.height = asDimension(obj.height, 'profile.height')
  if (obj.colorMap !== undefined) out.colorMap = asEnum(obj.colorMap, ['seismic', 'grayscale', 'jet'], 'profile.colorMap')
  if (obj.title !== undefined) out.title = asString(obj.title, 'profile.title')
  return out
}

/**
 * Run a `profile` step.
 * @param dataset - input dataset to render.
 * @param config - validated profile config.
 * @returns the dataset with `meta.profile` attached plus audit notes.
 */
export function run(dataset: Dataset, config: ProfileConfig): ProcessorResult {
  const section = buildSection(dataset)
  const formats = config.formats ?? DEFAULT_FORMATS
  const width = config.width ?? DEFAULT_WIDTH
  const height = config.height ?? DEFAULT_HEIGHT
  const colorMap = config.colorMap ?? DEFAULT_COLOR_MAP
  const pal = palette(colorMap)
  let svg: string | undefined
  let png: string | undefined
  const notes: string[] = []
  for (const format of formats) {
    if (format === 'svg') {
      svg = svgFromSection(section, pal, width, height, config.title)
    } else {
      png = toBase64(encodePng(width, height, rasterize(section, width, height), pal))
    }
    notes.push(`rendered ${format} profile (${width}x${height}, ${colorMap}, ${section.traceCount} traces x ${section.sampleCount} samples)`)
  }
  const output: ProfileOutput = {
    formats,
    width,
    height,
    colorMap,
    kind: 'seismic',
    traceCount: section.traceCount,
    sampleCount: section.sampleCount,
    ...(config.title !== undefined ? { title: config.title } : {}),
    ...(svg !== undefined ? { svg } : {}),
    ...(png !== undefined ? { png } : {}),
  }
  const meta: Record<string, unknown> = {}
  for (const key of Object.keys(dataset.meta)) {
    if (key !== 'rowCount' && key !== 'provenance') meta[key] = dataset.meta[key]
  }
  meta.rowCount = dataset.rows.length
  meta.profile = output
  return { dataset: { columns: dataset.columns, rows: dataset.rows, meta }, notes }
}

/** Validate one raster dimension: a positive integer of at most {@link MAX_DIMENSION} pixels. */
function asDimension(value: unknown, what: string): number {
  const n = asPositiveInt(value, what)
  if (n > MAX_DIMENSION) {
    throw new ExplorationError(`${what} must not exceed ${MAX_DIMENSION}`, { code: 'VALIDATION_ERROR' })
  }
  return n
}
