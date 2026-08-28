/**
 * `ingest` step processor: raw manuscript text → paper.
 *
 * Parses plain-text or Markdown manuscripts into a {@link Paper}: Markdown ATX
 * headings (`#`, `##`, …) become section headings, a leading title heading and
 * an `Abstract`/`摘要` section are lifted into dedicated fields, and citation
 * lines are parsed into {@link Citation} components. The input byte budget and
 * section/paragraph/citation budgets are enforced here.
 * @module @deepseek-ai/dsh-paper
 */

import { carryMeta, withMeta } from '../manuscript.ts'
import { PaperError } from '../errors.ts'
import { parseCitation } from '../citation/parser.ts'
import type {
  InputCitation, IngestConfig, Limits, Paper, PaperSection, ProcessingInput, ProcessorResult,
} from '../types.ts'
import { asBoolean, asString, checkKeys, checkObject } from './validate.ts'

const ABSTRACT_HEADINGS = ['abstract', '摘要', 'abstract（摘要）', 'abstract（英文摘要）']
const MARKDOWN_HEADING = /^(#{1,6})\s+\S/

/**
 * Validate an `ingest` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): IngestConfig {
  const obj = checkObject(config, 'ingest config')
  checkKeys(obj, ['markdownHeadings', 'detectTitle', 'sectionPattern'], 'ingest')
  return {
    ...(obj.markdownHeadings !== undefined ? { markdownHeadings: asBoolean(obj.markdownHeadings, 'ingest.markdownHeadings') } : {}),
    ...(obj.detectTitle !== undefined ? { detectTitle: asBoolean(obj.detectTitle, 'ingest.detectTitle') } : {}),
    ...(obj.sectionPattern !== undefined ? { sectionPattern: asString(obj.sectionPattern, 'ingest.sectionPattern') } : {}),
  }
}

/**
 * Run an `ingest` step.
 * @param input - raw manuscript text to parse.
 * @param config - validated ingest config.
 * @param limits - resource limits; all budgets are enforced here.
 * @returns the parsed paper plus provenance notes.
 */
export function run(input: ProcessingInput, config: IngestConfig, limits: Limits): ProcessorResult {
  const format = input.format.trim().toLowerCase()
  if (format !== 'text' && format !== 'markdown') {
    throw new PaperError(`unsupported input format "${input.format}"`, { code: 'UNSUPPORTED_FORMAT' })
  }
  const byteLength = new TextEncoder().encode(input.data).byteLength
  if (byteLength > limits.maxInputBytes) {
    throw new PaperError(
      `input of ${byteLength} bytes exceeds the ${limits.maxInputBytes}-byte limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }

  const parsed = parseManuscript(input.data, config, format === 'markdown')
  enforceSectionLimits(parsed, limits)

  const meta = carryMeta({})
  if (input.source !== undefined) {
    (meta as Record<string, unknown>).source = input.source
  }
  const notes = [
    `ingested ${input.source ?? 'inline'} as ${format}: ${parsed.sections.length} sections, ${parsed.citations.length} references`,
  ]
  const base: Paper = {
    sections: parsed.sections,
    citations: parsed.citations.map(input => parseCitation(input.id, input.text)),
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.abstract !== undefined ? { abstract: parsed.abstract } : {}),
    meta: {},
  }
  const paper = withMeta(base, meta)
  return { paper, notes }
}

/** Escape regex metacharacters in a user-supplied section pattern. */
function compileSectionPattern(pattern: string | undefined, markdown: boolean): RegExp | undefined {
  if (pattern !== undefined) {
    return new RegExp(pattern)
  }
  return markdown ? MARKDOWN_HEADING : undefined
}

/** Whether a trimmed line starts a new citation entry. */
function isCitationStart(line: string): boolean {
  return /^\[(?:@?[A-Za-z0-9_\-. ]+|\d+)\]/.test(line)
}

/** Whether a trimmed heading names the references/list-of-works section. */
function isReferencesHeading(line: string): boolean {
  return /^(references|bibliography|works cited|参考文献|参考文献表)/i.test(line)
}

/**
 * Extract a displayed heading text. Markdown ATX headings lose their `#`
 * markers; custom section patterns lose the leading match (`1. `).
 */
function headingText(line: string, pattern: RegExp): string {
  if (/^#{1,6}\s/.test(line)) {
    return line.replace(/^#{1,6}\s*/, '').trim()
  }
  // The call site guarantees `pattern` matches, so the exec result is non-null.
  const prefix = pattern.exec(line) as RegExpExecArray
  return line.slice(prefix[0].length).trim()
}

/** Parse manuscript text into title/abstract/sections/citations. */
function parseManuscript(data: string, config: IngestConfig, isMarkdown: boolean): {
  title?: string
  abstract?: string
  sections: readonly PaperSection[]
  citations: readonly InputCitation[]
} {
  const markdown = config.markdownHeadings ?? isMarkdown
  const detectTitle = config.detectTitle ?? true
  const pattern = compileSectionPattern(config.sectionPattern, markdown)

  const sections: PaperSection[] = []
  const citations: InputCitation[] = []
  let title: string | undefined
  let abstract: string | undefined
  let citationId: string | undefined
  let citationLines: string[] = []
  let inReferences = false
  let activeAbstract = false

  function flushCitation(): void {
    if (citationId !== undefined && citationLines.length > 0) {
      citations.push({ id: citationId, text: citationLines.map(s => s.trim()).join(' ') })
    }
    citationId = undefined
    citationLines = []
  }

  function appendParagraph(text: string): void {
    const last = sections.at(-1)
    if (last === undefined) {
      sections.push({ kind: 'paragraph', paragraphs: [text] })
    } else {
      sections[sections.length - 1] = { ...last, paragraphs: [...last.paragraphs, text] }
    }
  }

  function isAbstractHeading(heading: string): boolean {
    return ABSTRACT_HEADINGS.includes(heading.trim().toLowerCase())
  }

  for (const raw of data.split(/\r?\n/)) {
    const line = raw.trim()
    if (inReferences) {
      if (isCitationStart(line)) {
        flushCitation()
        citationId = line.match(/^\[([^\]]+)\]/)?.[1]
        citationLines = [line.replace(/^\[[^\]]+\][\s.:]*/, '')]
      } else if (line === '') {
        flushCitation()
      } else if (citationId !== undefined) {
        citationLines.push(line)
      }
      continue
    }
    if (line === '') {
      flushCitation()
      continue
    }
    if (isReferencesHeading(line)) {
      flushCitation()
      inReferences = true
      continue
    }
    if (isCitationStart(line)) {
      flushCitation()
      citationId = line.match(/^\[([^\]]+)\]/)?.[1]
      citationLines = [line.replace(/^\[[^\]]+\][\s.:]*/, '')]
      continue
    }
    if (pattern !== undefined && pattern.test(line)) {
      flushCitation()
      const text = headingText(line, pattern)
      const singleHash = /^#{1}\s/.test(line)
      if (isReferencesHeading(text)) {
        inReferences = true
        continue
      }
      if (detectTitle && title === undefined && singleHash) {
        title = text
        activeAbstract = false
        continue
      }
      const hashRun = /^(#{1,6})/.test(line) ? line.match(/^#+/)?.[0] : undefined
      const level = hashRun === undefined ? undefined : hashRun.length
      sections.push({
        kind: 'heading',
        heading: text,
        paragraphs: [],
        ...(level !== undefined ? { level } : {}),
      })
      activeAbstract = isAbstractHeading(text)
      continue
    }
    // A plain-text manuscript uses its first non-empty line as the title.
    if (detectTitle && title === undefined && pattern === undefined && sections.length === 0) {
      title = line
      activeAbstract = false
      continue
    }
    if (activeAbstract) {
      abstract = [abstract, line].filter(Boolean).join('\n')
      continue
    }
    flushCitation()
    appendParagraph(line)
  }
  flushCitation()

  const abstractSection = sections.find(s => isAbstractHeading(s.heading ?? ''))
  const finalAbstract = abstract ?? (abstractSection !== undefined ? abstractSection.paragraphs.join('\n') : undefined)
  const body = sections.filter(s => !isAbstractHeading(s.heading ?? ''))

  return {
    ...(detectTitle && title !== undefined ? { title } : {}),
    ...(finalAbstract !== undefined ? { abstract: finalAbstract } : {}),
    sections: body,
    citations,
  }
}

/** Enforce section, paragraph, and citation budgets after parsing. */
function enforceSectionLimits(
  parsed: { sections: readonly PaperSection[]; citations: readonly InputCitation[] },
  limits: Limits,
): void {
  if (parsed.citations.length > limits.maxCitations) {
    throw new PaperError(
      `parsed ${parsed.citations.length} citations exceeds the ${limits.maxCitations}-citation limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  if (parsed.sections.length > limits.maxSections) {
    throw new PaperError(
      `parsed ${parsed.sections.length} sections exceeds the ${limits.maxSections}-section limit`,
      { code: 'LIMIT_EXCEEDED' },
    )
  }
  for (const section of parsed.sections) {
    if (section.paragraphs.length > limits.maxParagraphs) {
      throw new PaperError(
        `section "${section.heading ?? ''}" has ${section.paragraphs.length} paragraphs exceeding the ${limits.maxParagraphs}-paragraph limit`,
        { code: 'LIMIT_EXCEEDED' },
      )
    }
  }
}
