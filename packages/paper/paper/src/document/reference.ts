/**
 * Shared reference projection for the document renderers.
 *
 * A cited entry is emitted verbatim unless the `cite` processor already
 * produced a formatted string, in which case the formatted line wins.
 * @module @deepseek-ai/dsh-paper
 */

/**
 * Project a scholarly reference line: formatted text if present, else the raw entry.
 * @param citation - the cited entry to project.
 * @returns the formatted reference, falling back to the raw entry text.
 */
export function referenceText(citation: Readonly<{ readonly formatted?: string; readonly raw: string }>): string {
  return citation.formatted ?? citation.raw
}
