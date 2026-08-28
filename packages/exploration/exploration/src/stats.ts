/**
 * Numeric statistics used by the extract and detect processors.
 *
 * Every function returns `null` for empty inputs so callers can distinguish "no
 * data" from a real value. Non-finite numbers are ignored rather than treated as
 * samples. Standard deviation is the sample form (Bessel's correction, ddof 1),
 * the geophysical convention for a measured trace or log column.
 * @module @deepseek-ai/dsh-exploration
 */

/** @returns the finite samples of `values`, preserving order. */
function finite(values: readonly (number | null | undefined)[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}

/**
 * Arithmetic mean of the finite samples.
 * @param values - numeric samples.
 * @returns the mean, or `null` when there are no finite samples.
 */
export function mean(values: readonly number[]): number | null {
  const samples = finite(values)
  if (samples.length === 0) return null
  let sum = 0
  for (const v of samples) sum += v
  return sum / samples.length
}

/**
 * Sample standard deviation (ddof 1) of the finite samples.
 * @param values - numeric samples.
 * @returns the standard deviation, or `null` with fewer than two finite samples.
 */
export function std(values: readonly number[]): number | null {
  const samples = finite(values)
  if (samples.length < 2) return null
  const avg = mean(samples) as number
  let sumSq = 0
  for (const v of samples) sumSq += (v - avg) ** 2
  return Math.sqrt(sumSq / (samples.length - 1))
}

/**
 * Median of the finite samples.
 * @param values - numeric samples.
 * @returns the median, or `null` when there are no finite samples.
 */
export function median(values: readonly number[]): number | null {
  const samples = finite(values)
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] as number
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/**
 * Linear-interpolation quantile of the finite samples, the R-7 estimator.
 * @param values - numeric samples.
 * @param q - quantile in [0, 1].
 * @returns the quantile, or `null` when there are no finite samples.
 */
export function quantile(values: readonly number[], q: number): number | null {
  const samples = finite(values)
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const h = (sorted.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  if (lo === hi) return sorted[lo] as number
  const frac = h - lo
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac
}

/**
 * Interquartile range (Q3 - Q1) of the finite samples.
 * @param values - numeric samples.
 * @returns the IQR, or `null` when there are no finite samples.
 */
export function iqr(values: readonly number[]): number | null {
  const q1 = quantile(values, 0.25)
  const q3 = quantile(values, 0.75)
  if (q1 === null || q3 === null) return null
  return q3 - q1
}

/**
 * Z-score of one value against a sample set.
 * @param value - value to score.
 * @param values - reference samples.
 * @returns the z-score, or `null` when the sample standard deviation is zero or undefined.
 */
export function zscore(value: number, values: readonly number[]): number | null {
  const avg = mean(values)
  const sd = std(values)
  if (avg === null || sd === null || sd === 0) return null
  return (value - avg) / sd
}

/**
 * Minimum of the finite samples.
 * @param values - numeric samples.
 * @returns the minimum, or `null` when there are no finite samples.
 */
export function min(values: readonly number[]): number | null {
  const samples = finite(values)
  if (samples.length === 0) return null
  let out = Infinity
  for (const v of samples) if (v < out) out = v
  return out
}

/**
 * Maximum of the finite samples.
 * @param values - numeric samples.
 * @returns the maximum, or `null` when there are no finite samples.
 */
export function max(values: readonly number[]): number | null {
  const samples = finite(values)
  if (samples.length === 0) return null
  let out = -Infinity
  for (const v of samples) if (v > out) out = v
  return out
}

/**
 * Median absolute deviation of the finite samples around their median.
 * @param values - numeric samples.
 * @returns the MAD, or `null` when there are no finite samples.
 */
export function mad(values: readonly number[]): number | null {
  const samples = finite(values)
  const med = median(samples)
  if (med === null) return null
  return median(samples.map(v => Math.abs(v - med)))
}
