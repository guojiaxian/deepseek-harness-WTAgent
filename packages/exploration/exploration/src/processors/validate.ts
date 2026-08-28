/**
 * Shared config validation helpers.
 *
 * Processor `validate()` entry points enforce a strict, loud contract: unknown
 * keys, wrong types, and out-of-range values all raise
 * `VALIDATION_ERROR` so a misconfigured pipeline fails before touching data.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from '../errors.ts'

/**
 * Coerce a config value to a plain object; `undefined` becomes `{}`.
 * @param value - config value.
 * @param what - human-readable config name for error messages.
 * @returns the plain object.
 */
export function checkObject(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExplorationError(`${what} must be an object`, { code: 'VALIDATION_ERROR' })
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
      throw new ExplorationError(`unknown ${what} option "${key}"`, { code: 'VALIDATION_ERROR' })
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
    throw new ExplorationError(`${what} must be a boolean`, { code: 'VALIDATION_ERROR' })
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
    throw new ExplorationError(`${what} must be a finite number`, { code: 'VALIDATION_ERROR' })
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
    throw new ExplorationError(`${what} must be a non-empty string`, { code: 'VALIDATION_ERROR' })
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
    throw new ExplorationError(`${what} must be an array`, { code: 'VALIDATION_ERROR' })
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
    throw new ExplorationError(`${what} must be one of ${values.join(', ')}`, { code: 'VALIDATION_ERROR' })
  }
  return value as T
}

/**
 * Assert a value is an array of non-empty strings.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the string array.
 */
export function stringArray(value: unknown, what: string): string[] {
  return asArray(value, what).map((entry, i) => asString(entry, `${what}[${i}]`))
}

/**
 * Assert a value is a positive integer.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the number.
 */
export function asPositiveInt(value: unknown, what: string): number {
  const n = asNumber(value, what)
  if (!Number.isInteger(n) || n < 1) {
    throw new ExplorationError(`${what} must be a positive integer`, { code: 'VALIDATION_ERROR' })
  }
  return n
}
