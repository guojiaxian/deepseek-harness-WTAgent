/**
 * Exploration unit system.
 *
 * Every unit is an affine transform of a base unit: `base = (value + offset) *
 * factor`. Conversions compose two transforms through the base, so temperature
 * (with non-zero offsets) and plain linear units share one code path. Unknown
 * units yield `undefined`; the caller decides whether that is a validation
 * failure.
 * @module @deepseek-ai/dsh-exploration
 */

/** One unit as an affine transform of its base unit. */
export interface UnitDef {
  /** Base-unit scale: `base = (value + offset) * factor`. */
  readonly factor: number
  /** Base-unit shift: `base = (value + offset) * factor`. */
  readonly offset: number
}

const UNITS: Readonly<Record<string, UnitDef>> = {
  // Length (base metre).
  m: { factor: 1, offset: 0 },
  km: { factor: 1000, offset: 0 },
  cm: { factor: 0.01, offset: 0 },
  mm: { factor: 0.001, offset: 0 },
  ft: { factor: 0.3048, offset: 0 },
  in: { factor: 0.0254, offset: 0 },
  // Time (base second).
  s: { factor: 1, offset: 0 },
  ms: { factor: 0.001, offset: 0 },
  us: { factor: 1e-6, offset: 0 },
  min: { factor: 60, offset: 0 },
  h: { factor: 3600, offset: 0 },
  d: { factor: 86400, offset: 0 },
  // Velocity (base m/s).
  'm/s': { factor: 1, offset: 0 },
  'km/s': { factor: 1000, offset: 0 },
  'ft/s': { factor: 0.3048, offset: 0 },
  // Density (base kg/m3).
  'g/cm3': { factor: 1000, offset: 0 },
  'kg/m3': { factor: 1, offset: 0 },
  // Frequency (base Hz).
  Hz: { factor: 1, offset: 0 },
  kHz: { factor: 1000, offset: 0 },
  MHz: { factor: 1e6, offset: 0 },
  // Temperature (base kelvin).
  C: { factor: 1, offset: 273.15 },
  F: { factor: 5 / 9, offset: 459.67 },
  K: { factor: 1, offset: 0 },
}

/**
 * Resolve a unit to its base-unit transform.
 * @param unit - unit symbol (e.g. `m`, `g/cm3`, `ms`).
 * @returns the transform, or `undefined` for an unknown unit.
 */
export function resolveUnit(unit: string): UnitDef | undefined {
  return UNITS[unit]
}

/**
 * Convert a value between two units.
 * @param value - value in the source unit.
 * @param from - source unit symbol.
 * @param to - target unit symbol.
 * @returns the converted value, or `undefined` when either unit is unknown.
 */
export function convert(value: number, from: string, to: string): number | undefined {
  const fromDef = resolveUnit(from)
  const toDef = resolveUnit(to)
  if (fromDef === undefined || toDef === undefined) return undefined
  const base = (value + fromDef.offset) * fromDef.factor
  return base / toDef.factor - toDef.offset
}
