/**
 * `format` step processor: 学术论文格式标准化校正 (format standardization).
 *
 * Normalizes manuscript presentation: numbers heading sections by level
 * (`1`, `1.1`, `2`), collapses stray whitespace and spacing, converts
 * ambiguous straight quotes to typographic pairs, and ensures narrative
 * citation markers terminate with a period. Changes are reported as structured
 * {@link FormatFinding} entries capped by `maxFindings`.
 * @module @deepseek-ai/dsh-paper
 */

import { carryMeta, withMeta } from '../manuscript.ts'
import type { FormatConfig, FormatFinding, Limits, PaperSection, Paper, ProcessorResult } from '../types.ts'
import { asBoolean, asNumber, checkKeys, checkObject } from './validate.ts'

/**
 * Validate a `format` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): FormatConfig {
  const obj = checkObject(config, 'format config')
  checkKeys(obj, ['numberedHeadings', 'spacing', 'typographicQuotes', 'citationMarks', 'maxFindings'], 'format')
  return {
    ...(obj.numberedHeadings !== undefined ? { numberedHeadings: asBoolean(obj.numberedHeadings, 'format.numberedHeadings') } : {}),
    ...(obj.spacing !== undefined ? { spacing: asBoolean(obj.spacing, 'format.spacing') } : {}),
    ...(obj.typographicQuotes !== undefined ? { typographicQuotes: asBoolean(obj.typographicQuotes, 'format.typographicQuotes') } : {}),
    ...(obj.citationMarks !== undefined ? { citationMarks: asBoolean(obj.citationMarks, 'format.citationMarks') } : {}),
    ...(obj.maxFindings !== undefined ? { maxFindings: asNumber(obj.maxFindings, 'format.maxFindings') } : {}),
  }
}

/**
 * Run a `format` step.
 * @param paper - input paper.
 * @param config - validated format config.
 * @param limits - resource limits; `maxFindings` caps retained findings.
 * @returns the formatted paper plus audit notes.
 */
export function run(paper: Paper, config: FormatConfig, limits: Limits): ProcessorResult {
  const numbered = config.numberedHeadings ?? true
  const spacing = config.spacing ?? true
  const quotes = config.typographicQuotes ?? true
  const citationMarks = config.citationMarks ?? true
  const maxFindings = Math.floor(Math.min(config.maxFindings ?? limits.maxFindings, limits.maxFindings))
  const findings: FormatFinding[] = []

  const sections = numbered
    ? numberHeadings(paper.sections)
    : paper.sections.map(s => ({ ...s }))

  const normalized = sections.map((section) => {
    const body = section.paragraphs.map((paragraph) => {
      let text = paragraph
      if (spacing) text = normalizeSpacing(text)
      if (quotes) text = typographic(text)
      if (citationMarks) text = ensureCitationPeriod(text)
      return text
    })
    const head = section.heading !== undefined && spacing
      ? section.heading.replace(/[ \t\u00a0]+/g, ' ').trim()
      : section.heading
    return {
      kind: section.kind,
      ...(head !== undefined ? { heading: head } : {}),
      ...(section.level !== undefined ? { level: section.level } : {}),
      paragraphs: body,
    }
  })

  if (quotes) {
    const quoteCount = countQuotes(paper.sections)
    if (quoteCount > 0) addFinding(findings, 'format.quotes', `converted ${quoteCount} straight quote${quoteCount === 1 ? '' : 's'} to typographic`, maxFindings)
  }
  if (numbered) {
    const headingCount = normalized.filter(s => s.heading !== undefined && s.kind === 'heading').length
    if (headingCount > 0) addFinding(findings, 'format.numbering', `numbered ${headingCount} heading${headingCount === 1 ? '' : 's'}`, maxFindings)
  }

  const meta = carryMeta(paper.meta)
  if (findings.length > 0) meta.findings = findings
  const formatted = withMeta({ ...paper, sections: normalized }, meta)
  const notes = findings.length > 0
    ? [`formatted ${findings.length} aspect${findings.length === 1 ? '' : 's'}`]
    : ['no format changes applied']
  return { paper: formatted, notes }
}

/** Renumber heading sections by level, producing dotted numbers like `1`, `1.1`. */
function numberHeadings(sections: readonly PaperSection[]): PaperSection[] {
  const counters: number[] = []
  return sections.map((section) => {
    if (section.kind !== 'heading' || section.heading === undefined) return { ...section }
    const level = Math.max(section.level ?? 1, 1)
    const index = level - 1
    // Truncate deeper counters above this level, then bump this level's counter.
    counters.length = level
    counters[index] = (counters[index] ?? 0) + 1
    const number = counters.join('.')
    return {
      kind: 'heading',
      heading: `${number} ${section.heading}`,
      ...(section.level !== undefined ? { level: section.level } : {}),
      paragraphs: section.paragraphs,
    }
  })
}

/** Collapse runs of whitespace and ensure one space after sentence punctuation. */
function normalizeSpacing(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*([.,;:!?])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Convert paired straight quotes into typographic alternatives. */
function typographic(text: string): string {
  let out = ''
  let doubleOpen = true
  let singleOpen = true
  for (let i = 0; i < text.length; i += 1) {
    // `text[i]` is `string | undefined` under noUncheckedIndexedAccess, but the
    // loop bound guarantees a character; the cast bridges for string arithmetic.
    const char = text[i] as string
    if (char === '"') {
      out += doubleOpen ? '\u201C' : '\u201D'
      doubleOpen = !doubleOpen
    } else if (char === "'") {
      const prev = text[i - 1]
      const next = text[i + 1]
      if (prev !== undefined && next !== undefined && isWordChar(prev) && isWordChar(next)) {
        // A word-internal apostrophe (it's) is always a right single quote.
        out += '\u2019'
      } else {
        out += singleOpen ? '\u2018' : '\u2019'
        singleOpen = !singleOpen
      }
    } else {
      out += char
    }
  }
  return out
}

/** Whether a character is a word character for apostrophe detection. */
function isWordChar(char: string): boolean {
  return /[A-Za-z0-9]/.test(char)
}

/** Ensure an inline citation marker at the end of a paragraph is followed by a period. */
function ensureCitationPeriod(text: string): string {
  if (/\[[^\]]+\]$/.test(text) && !/[.!?]$/.test(text)) {
    return `${text}.`
  }
  return text
}

/** Count straight-quote characters across all paragraphs for the finding. */
function countQuotes(sections: readonly PaperSection[]): number {
  let count = 0
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      for (const char of paragraph) {
        if (char === '"' || char === "'") count += 1
      }
    }
  }
  return count
}

/** Append a format finding, truncating to the retained budget. */
function addFinding(list: FormatFinding[], rule: string, message: string, max: number): void {
  if (list.length >= max) return
  list.push({ rule, message })
}
