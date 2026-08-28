/**
 * Color map palettes for seismic section rendering.
 *
 * Every palette is a 256-entry RGB ramp interpolated linearly between named
 * stops. `seismic` is a blue→white→red diverging ramp suited to amplitude
 * sections (zero amplitude maps to the white midpoint), `grayscale` is a
 * linear black→white ramp, and `jet` is the classic six-stop rainbow ramp.
 * @module @deepseek-ai/dsh-exploration
 */

/** An RGB color tuple with 8-bit channels. */
export type RGB = readonly [number, number, number]

/** Named color maps accepted by the `profile` processor. */
export type ColorMapName = 'seismic' | 'grayscale' | 'jet'

/** One color map stop: a position in [0, 1] and its RGB color. */
type Stop = readonly [position: number, color: RGB]

/** Named stop tables; the first stop sits at 0 and the last at 1. */
const STOPS: Readonly<Record<ColorMapName, readonly Stop[]>> = {
  grayscale: [
    [0, [0, 0, 0]],
    [1, [255, 255, 255]],
  ],
  seismic: [
    [0, [0, 0, 88]],
    [0.25, [0, 0, 255]],
    [0.5, [255, 255, 255]],
    [0.75, [255, 0, 0]],
    [1, [88, 0, 0]],
  ],
  jet: [
    [0, [0, 0, 128]],
    [0.125, [0, 0, 255]],
    [0.375, [0, 255, 255]],
    [0.625, [255, 255, 0]],
    [0.875, [255, 0, 0]],
    [1, [128, 0, 0]],
  ],
}

/** Number of entries in a rendered palette. */
const PALETTE_SIZE = 256

/**
 * Build a 256-entry palette for a named color map, interpolating linearly
 * between the stop positions.
 * @param name - color map name.
 * @returns 256 RGB tuples; index 0 is the low end and 255 the high end.
 */
export function palette(name: ColorMapName): RGB[] {
  const stops = STOPS[name]
  const out: RGB[] = []
  for (let i = 0; i < PALETTE_SIZE; i++) {
    out.push(interpolate(stops, i / (PALETTE_SIZE - 1)))
  }
  return out
}

/**
 * Render one RGB tuple as a `#rrggbb` hex string.
 * @param rgb - color to format.
 * @returns the lowercase hex string.
 */
export function rgbToHex(rgb: RGB): string {
  const hex = (channel: number): string => channel.toString(16).padStart(2, '0')
  return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`
}

/** Linear interpolation between the two stops bracketing `position`. */
function interpolate(stops: readonly Stop[], position: number): RGB {
  let low = stops[0] as Stop
  for (let i = 1; i < stops.length; i++) {
    const high = stops[i] as Stop
    if (position <= high[0]) {
      const t = (position - low[0]) / (high[0] - low[0])
      return [
        Math.round(low[1][0] + (high[1][0] - low[1][0]) * t),
        Math.round(low[1][1] + (high[1][1] - low[1][1]) * t),
        Math.round(low[1][2] + (high[1][2] - low[1][2]) * t),
      ]
    }
    low = high
  }
  /* v8 ignore next 1 -- palette() only samples positions in [0, 1], so the loop always returns a bracket */
  return low[1]
}
