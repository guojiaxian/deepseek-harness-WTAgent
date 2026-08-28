/**
 * Shared reference formatting helpers.
 *
 * The three style formatters reuse name normalization (family/given split,
 * initials) and a clause joiner here so each style owns only its punctuation.
 * @module @deepseek-ai/dsh-paper
 */

/**
 * Split an author name into family and given parts, tolerating family, given
 * (`Smith, John`) and given family (`John Smith`) orders.
 * @param name - the author name to split.
 * @returns the family and given parts; either may be empty.
 */
export function nameParts(name: string): { family: string; given: string } {
  const comma = name.indexOf(',')
  if (comma >= 0) {
    return { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() }
  }
  const tokens = name.trim().split(/\s+/).filter(token => token !== '')
  const family = tokens.pop() ?? ''
  return { family, given: tokens.join(' ') }
}

/**
 * Reduce a given name to bracketed initials, e.g. `John Paul` → `J. P.`.
 * @param given - the given-name string to reduce.
 * @returns the space-joined initials; `''` when `given` is empty.
 */
export function initials(given: string): string {
  return given.split(/\s+/).filter(Boolean).map(token => `${token.charAt(0).toUpperCase()}.`).join(' ')
}

/**
 * Join non-empty clauses with a separator, dropping empty parts.
 * @param separator - delimiter inserted between clauses.
 * @param clauses - optional clauses; empty ones are dropped.
 * @returns the joined string, or `''` when no clause is present.
 */
export function joinClauses(separator: string, ...clauses: Array<string | undefined>): string {
  return clauses.filter((clause): clause is string => clause !== undefined && clause.trim() !== '').join(separator)
}
