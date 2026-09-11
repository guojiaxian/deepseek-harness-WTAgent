/**
 * Shared validation helpers.
 *
 * Processor entry points enforce a strict, loud contract: unknown keys, wrong
 * types, and out-of-range values all raise `VALIDATION_ERROR` so a malformed
 * request fails before touching any data.
 * @module @deepseek-ai/dsh-bidding
 */

import { BiddingError } from './errors.ts'

/**
 * Coerce a value to a plain object; `undefined` becomes `{}`.
 * @param value - config value.
 * @param what - human-readable config name for error messages.
 * @returns the plain object.
 */
export function asObject(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BiddingError(`${what} must be an object`, { code: 'VALIDATION_ERROR' })
  }
  return value as Record<string, unknown>
}

/**
 * Reject unknown keys on an already-validated object.
 * @param obj - validated config object.
 * @param allowed - the permitted key names.
 * @param what - human-readable config name for error messages.
 */
export function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new BiddingError(`unknown ${what} option "${key}"`, { code: 'VALIDATION_ERROR' })
    }
  }
}

/**
 * Assert a value is a boolean.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the boolean.
 */
export function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BiddingError(`${what} must be a boolean`, { code: 'VALIDATION_ERROR' })
  }
  return value
}

/**
 * Assert a value is a finite number.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the number.
 */
export function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BiddingError(`${what} must be a finite number`, { code: 'VALIDATION_ERROR' })
  }
  return value
}

/**
 * Assert a value is a non-empty string.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the string.
 */
export function asString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BiddingError(`${what} must be a non-empty string`, { code: 'VALIDATION_ERROR' })
  }
  return value
}

/**
 * Assert a value is an array.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the array.
 */
export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new BiddingError(`${what} must be an array`, { code: 'VALIDATION_ERROR' })
  }
  return value
}

/**
 * Assert a value is one of an enum of string literals.
 * @param value - value to check.
 * @param values - the permitted literals.
 * @param what - human-readable option name.
 * @returns the matched literal.
 */
export function asEnum<T extends string>(value: unknown, values: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new BiddingError(`${what} must be one of ${values.join(', ')}`, { code: 'VALIDATION_ERROR' })
  }
  return value as T
}

/**
 * Assert a value is an optional string (possibly undefined), rejecting empty
 * strings.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the string or undefined.
 */
export function asOptionalString(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BiddingError(`${what} must be a non-empty string when provided`, { code: 'VALIDATION_ERROR' })
  }
  return value
}

/**
 * Assert a value is an optional finite number (possibly undefined).
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the number or undefined.
 */
export function asOptionalNumber(value: unknown, what: string): number | undefined {
  if (value === undefined) return undefined
  return asNumber(value, what)
}
