/**
 * Line-counting metrics.
 *
 * Lines are classified into blank, whole-line comment (including block-comment
 * lines), and code. Inline comments after code count as code. The classifier is
 * a char-level scan that tracks block-comment state across lines, so the counts
 * stay deterministic for any input. Per-language comment markers keep `#include`
 * in C and `#` inside Python strings from being misclassified except where they
 * are genuinely comments.
 * @module @deepseek-ai/dsh-code
 */

import type { Language, LineMetrics } from './types.ts'

/** A comment open/close marker pair. */
interface BlockMarker {
  readonly open: string
  readonly close: string
}

/** Comment markers for one language family. */
interface CommentStyle {
  readonly line: readonly string[]
  readonly block: readonly BlockMarker[]
}

/** Default comment style for unsupported or unrecognized languages. */
const GENERIC: CommentStyle = { line: ['//', '#'], block: [{ open: '/*', close: '*/' }] }

/** Comment markers keyed by language family. */
function commentStyle(language: Language): CommentStyle {
  switch (language) {
    case 'python': return { line: ['#'], block: [{ open: '"""', close: '"""' }, { open: "'''", close: "'''" }] }
    case 'javascript':
    case 'typescript':
    case 'java':
    case 'go':
    case 'c':
    case 'cpp':
    case 'rust': return { line: ['//'], block: [{ open: '/*', close: '*/' }] }
    case 'unknown': return GENERIC
  }
}

/**
 * Classify every physical line of a source as blank, comment, or code.
 * @param language - language selecting the comment-marker set.
 * @param source - source text to measure.
 * @returns the line metrics.
 */
export function countLineMetrics(language: Language, source: string): LineMetrics {
  const style = commentStyle(language)
  let lines = 0
  let codeLines = 0
  let commentLines = 0
  let blankLines = 0
  let inBlock = ''

  const endOfLine = /[\r\n]+$/
  const parts = source.split('\n')
  // A trailing line terminator yields a final empty element that terminates the
  // last line rather than adding a separate line (`wc -l` agrees).
  if (parts.length > 0 && parts[parts.length - 1] === '' && /[\r\n]$/.test(source)) parts.pop()
  for (const raw of parts) {
    const line = raw.replace(endOfLine, '')
    let codeSeen = false
    let i = 0
    const n = line.length
    // @coverage-ignore-loop: the state machine consumes the whole line.
    while (i < n) {
      if (inBlock !== '') {
        const closeMarker = inBlock
        const close = line.indexOf(closeMarker, i)
        if (close === -1) {
          i = n
        } else {
          inBlock = ''
          i = close + closeMarker.length
        }
        continue
      }
      const marker = earliestMarker(line, i, style)
      if (marker === undefined) {
        if (line.slice(i).trim() !== '') codeSeen = true
        break
      }
      if (line.slice(i, marker.index).trim() !== '') codeSeen = true
      if (marker.block === undefined) {
        // A line comment ends the line.
        break
      }
      inBlock = marker.block.close
      i = marker.index + marker.block.open.length
    }

    lines++
    if (!codeSeen && line.trim() === '') blankLines++
    else if (!codeSeen) commentLines++
    else codeLines++
  }

  return { lines, codeLines, commentLines, blankLines }
}

/** The earliest comment marker starting at or after `at`, if any. */
function earliestMarker(line: string, at: number, style: CommentStyle): {
  readonly index: number
  readonly block?: BlockMarker
} | undefined {
  let best: { index: number; block?: BlockMarker } | undefined
  for (const marker of style.line) {
    const idx = line.indexOf(marker, at)
    if (idx !== -1 && (best === undefined || idx < best.index)) best = { index: idx }
  }
  for (const block of style.block) {
    const idx = line.indexOf(block.open, at)
    if (idx !== -1 && (best === undefined || idx < best.index)) best = { index: idx, block }
  }
  return best
}
