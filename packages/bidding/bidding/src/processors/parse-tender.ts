/**
 * Tender parsing: project a raw document block stream into a
 * {@link TenderDocument}.
 *
 * Chapter detection is dual-channel — Heading styles (or outline levels) take
 * precedence, CJK numbering patterns fill the gap — and every low-confidence
 * outcome lands in `warnings` for model-side fallback. Scoring items prefer the
 * scoring table inside a scoring-methods chapter and degrade to list mode;
 * fatal clauses are matched by disqualification/star/mandatory keywords.
 * @module @deepseek-ai/dsh-bidding
 */

import { checksumText } from '../checksum.ts'
import { BiddingError } from '../errors.ts'
import type {
  BidDraft, FatalClause, FatalClauseKind, Limits, ScoringCategory, ScoringItem, TenderDocument, TenderSection,
} from '../types.ts'
import type { RawBlock, RawDocument } from '../format/docx-read.ts'

/** Maximum characters of one chapter title accepted as a heading. */
const MAX_HEADING_CHARS = 60
/** Maximum characters of one summary. */
const SUMMARY_CHARS = 200
/** Maximum characters of one fatal clause excerpt. */
const CLAUSE_CHARS = 300
/** Maximum characters of one meta value. */
const META_CHARS = 120

/** One candidate heading recognized by either channel. */
interface HeadingCandidate {
  readonly level: number
  readonly number: string
  readonly title: string
}

/** Result of the CJK numbering pattern channel. */
interface NumberingMatch {
  readonly level: number
  readonly number: string
}

const CJK_NUM = '一二三四五六七八九十百千两'

/** Sentence-ending punctuation: a paragraph carrying it is body text, not a
 * pattern-channel heading title. */
const SENTENCE_END = /[。；？！，]/

/**
 * Match a CJK/arabic numbering prefix and derive its heading level.
 * @param text - the paragraph text.
 * @returns the numbering match, or undefined when the text carries none.
 */
function matchNumbering(text: string): NumberingMatch | undefined {
  const head = text.trim()
  if (head.length === 0 || head.length > MAX_HEADING_CHARS) return undefined
  let m = new RegExp(`^第([0-9]+|[${CJK_NUM}]+)([章篇])[\\s、.．]?\\s*(.*)$`).exec(head)
  if (m !== null) {
    return { level: 1, number: `第${m[1] ?? ''}${m[2] ?? ''}` }
  }
  m = new RegExp(`^([${CJK_NUM}]{1,3})[、.．:：]\\s*(.*)$`).exec(head)
  if (m !== null) {
    return { level: 1, number: m[1] ?? '' }
  }
  m = new RegExp(`^[（(]([${CJK_NUM}]{1,3})[)）]\\s*(.*)$`).exec(head)
  if (m !== null) {
    return { level: 2, number: `（${m[1] ?? ''}）` }
  }
  m = /^(\d+(?:\.\d+)*)(?:[、.．:：)\s]|$)/.exec(head)
  if (m !== null) {
    const dots = (m[1]?.match(/\./g) ?? []).length
    const level = Math.min(1 + Math.max(dots, 1), 4)
    return { level, number: m[1] ?? '' }
  }
  return undefined
}

/**
 * Strip one numbering prefix (and trailing separators) from a heading text.
 * Works on the whole numbering token, so multi-level prefixes like `2.1` are
 * removed in one pass instead of leaving the trailing level behind.
 * @param text - the full heading text.
 * @param number - the numbering token matched at the start of the text.
 * @returns the cleaned title, or the original text when nothing is left.
 */
function stripAfterNumber(text: string, number: string): string {
  return text.slice(number.length).trim().replace(/^[、.．:：)\s]+/, '').trim() || text
}

/**
 * Extract the heading from one paragraph block, dual-channel.
 * @param block - the paragraph block.
 * @returns the candidate, or undefined for body text.
 */
function headingOf(block: RawBlock): HeadingCandidate | undefined {
  if (block.kind !== 'paragraph') return undefined
  const text = block.text.trim()
  if (text === '') return undefined
  const styleLevel = styleHeadingLevel(block)
  const numbering = matchNumbering(text)
  if (styleLevel !== undefined) {
    const number = numbering?.number ?? ''
    const title = numbering !== undefined ? stripAfterNumber(text, numbering.number) : text
    return { level: styleLevel, number, title }
  }
  if (numbering !== undefined && text.length <= MAX_HEADING_CHARS) {
    const cleaned = stripAfterNumber(text, numbering.number)
    if (cleaned === '' || SENTENCE_END.test(cleaned)) return undefined
    return { level: numbering.level, number: numbering.number, title: cleaned }
  }
  return undefined
}

/**
 * Derive a heading level from the paragraph's style channel.
 * @param block - the paragraph block.
 * @returns the level, or undefined when the style is not a heading.
 */
function styleHeadingLevel(block: RawBlock & { kind: 'paragraph' }): number | undefined {
  if (block.outlineLevel !== undefined) return block.outlineLevel + 1
  const name = block.styleName ?? block.style ?? ''
  const heading = /^(?:heading|标题)\s*(\d)$/i.exec(name.trim())
  if (heading !== null) {
    const level = Number.parseInt(heading[1] ?? '', 10)
    if (Number.isInteger(level) && level >= 1 && level <= 6) return level
  }
  return undefined
}

/** Internal per-chapter block attribution (mutable while building). */
interface ChapterBlocks {
  /** The chapter section; frozen into the returned projection. */
  section: {
    id: string
    level: number
    number: string
    title: string
    summary: string
    charCount: number
    locator: string
  }
  paragraphs: string[]
  tables: (readonly (readonly string[])[])[]
}

/** Capped warning collector. */
class Warnings {
  private readonly items: string[] = []
  constructor(private readonly cap: number) {}

  add(item: string): void {
    if (this.items.length < this.cap) this.items.push(item)
  }

  get values(): readonly string[] {
    return this.items
  }
}

/**
 * Derive a scoring item category from its clause text.
 * @param text - clause + criteria text.
 * @returns the category.
 */
function scoringCategory(text: string): ScoringCategory {
  if (/价格|报价|下浮|费率/.test(text)) return 'price'
  // Qualification keywords win over commercial ones: scoring rows like
  // "类似业绩（合同业绩）" are qualification evidence even though they mention
  // contracts.
  if (/资质|资格|业绩|信用/.test(text)) return 'qualification'
  if (/商务|合同|付款|履约/.test(text)) return 'commercial'
  return 'technical'
}

/** Stable short id for a clause-ish string. */
function clauseId(text: string): string {
  return checksumText(text).slice(0, 12)
}

/**
 * Parse a numeric point value out of a cell.
 * @param cell - the cell text.
 * @returns the number, or undefined.
 */
function parsePoints(cell: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*分?/.exec(cell.trim())
  if (m === null) return undefined
  const value = Number.parseFloat(m[1] ?? '')
  return Number.isFinite(value) ? value : undefined
}

/**
 * Extract scoring items from tables under scoring-methods chapters.
 * @param tables - tables attributed to scoring chapters.
 * @param locator - chapter locator for items.
 * @param warnings - warning collector.
 * @param limits - resource limits.
 * @returns the scoring items.
 */
function scoringFromTables(
  tables: readonly (readonly (readonly string[])[])[],
  locator: string,
  warnings: Warnings,
  limits: Limits,
): ScoringItem[] {
  const items: ScoringItem[] = []
  for (const rows of tables) {
    if (rows.length === 0) continue
    // Locate clause and points columns in the header row.
    let clauseColumn = -1
    let pointsColumn = -1
    const header = rows[0] ?? []
    for (let index = 0; index < header.length; index++) {
      const cell = header[index] ?? ''
      if (clauseColumn === -1 && /(条款|项目|名称|内容|评审因素|评分因素|因素)/.test(cell)) clauseColumn = index
      if (pointsColumn === -1 && /(分值|得分|满分)/.test(cell)) pointsColumn = index
    }
    for (let row = 1; row < rows.length; row++) {
      const cells = rows[row] ?? []
      if (cells.every(cell => cell.trim() === '')) continue
      let clause: string
      let points: number | undefined
      if (clauseColumn >= 0 && clauseColumn < cells.length) {
        clause = cells[clauseColumn]?.trim() ?? ''
      } else {
        clause = cells[0]?.trim() ?? ''
      }
      if (pointsColumn >= 0 && pointsColumn < cells.length) {
        points = parsePoints(cells[pointsColumn] ?? '')
      } else {
        for (const cell of cells) {
          const candidate = parsePoints(cell)
          if (candidate !== undefined && cell.trim() !== clause) {
            points = candidate
            break
          }
        }
      }
      if (clause === '') continue
      const criteria = cells.map(cell => cell.trim()).filter(cell => cell !== '').join(' | ')
      items.push({
        id: clauseId(`${locator}|${clause}|${criteria}`),
        clause: clause.slice(0, 80),
        ...(points !== undefined ? { points } : {}),
        criteria: criteria.slice(0, 300),
        category: scoringCategory(`${clause} ${criteria}`),
        locator,
      })
      if (items.length >= limits.maxScoringItems) {
        warnings.add(`评分点数量已达上限 ${String(limits.maxScoringItems)}，其余评分表行未解析`)
        return items
      }
    }
  }
  return items
}

/**
 * Extract scoring items from list-style paragraphs.
 * @param paragraphs - paragraphs attributed to scoring chapters (or the whole
 * document when no scoring chapter was found).
 * @param locator - chapter locator for items.
 * @param warnings - warning collector.
 * @param limits - resource limits.
 * @returns the scoring items.
 */
function scoringFromList(
  paragraphs: readonly string[],
  locator: string,
  warnings: Warnings,
  limits: Limits,
): ScoringItem[] {
  const items: ScoringItem[] = []
  for (const paragraph of paragraphs) {
    const text = paragraph.trim()
    if (text === '' || text.length > CLAUSE_CHARS) continue
    if (!/\d+(?:\.\d+)?\s*分/.test(text)) continue
    const clause = text.slice(0, 80)
    items.push({
      id: clauseId(`${locator}|${clause}`),
      clause,
      criteria: text.slice(0, CLAUSE_CHARS),
      category: scoringCategory(text),
      locator,
    })
    if (items.length >= limits.maxScoringItems) {
      warnings.add(`评分点数量已达上限 ${String(limits.maxScoringItems)}，其余评分段落未解析`)
      return items
    }
  }
  return items
}

/**
 * Parse a raw document into a tender projection.
 * @param raw - the block stream of the .docx file.
 * @param limits - resource limits.
 * @returns the tender document projection.
 */
export function parseTender(raw: RawDocument, limits: Limits): TenderDocument {
  const warnings = new Warnings(limits.maxWarnings)
  const chapters: ChapterBlocks[] = []
  let current: ChapterBlocks | undefined

  // Pass one: attribute blocks to chapters.
  let styleLevelConflicts = 0
  for (const block of raw.blocks) {
    const heading = headingOf(block)
    if (heading !== undefined) {
      if (isTableOfContentsHeading(heading.title)) continue
      if (chapters.length >= limits.maxSections) {
        throw sectionCapError(limits)
      }
      if (block.kind === 'paragraph') {
        const style = styleHeadingLevel(block)
        const pattern = matchNumbering(block.text.trim())
        if (style !== undefined && pattern !== undefined && pattern.level !== style) {
          styleLevelConflicts++
          if (styleLevelConflicts <= 3) {
            warnings.add(`标题「${heading.title.slice(0, 30)}」样式与编号模式级别不一致，已采用样式级别 ${String(style)}`)
          }
        }
      }
      const section: TenderSection = {
        id: checksumText(`${heading.number}|${heading.title}`).slice(0, 12),
        level: heading.level,
        number: heading.number,
        title: heading.title.slice(0, 120),
        summary: '',
        charCount: 0,
        locator: `§${heading.number} ${heading.title}`.slice(0, 140),
      }
      current = { section, paragraphs: [], tables: [] }
      chapters.push(current)
      continue
    }
    if (current === undefined) continue
    if (block.kind === 'paragraph') {
      const text = block.text.trim()
      if (text !== '') {
        current.paragraphs.push(text)
        current.section.charCount += text.length
      }
    } else {
      current.tables.push(block.rows)
      for (const row of block.rows) {
        for (const cell of row) current.section.charCount += cell.length
      }
    }
  }
  // Fill summaries.
  for (const chapter of chapters) {
    chapter.section.summary = chapter.paragraphs.join(' ').slice(0, SUMMARY_CHARS)
  }

  // Scoring chapters: title matches scoring-methods keywords.
  const scoringChapters = chapters.filter(chapter => /评分|评标|打分|细则|评审/.test(chapter.section.title))
  const scoringItems: ScoringItem[] = []
  for (const chapter of scoringChapters) {
    scoringItems.push(...scoringFromTables(chapter.tables, chapter.section.locator, warnings, limits))
  }
  if (scoringItems.length === 0) {
    if (scoringChapters.length > 0) {
      const listItems = scoringChapters.flatMap(chapter =>
        scoringFromList(chapter.paragraphs, chapter.section.locator, warnings, limits))
      if (listItems.length === 0) {
        warnings.add('找到评分办法章节但未解析出评分点，请人工核对评分表')
      } else {
        scoringItems.push(...listItems)
      }
    } else {
      warnings.add('未找到评分办法章节（章节标题不含「评分/评标/细则/评审」），评分点可能缺失')
      // Fallback: scan the whole document list-style.
      const all = raw.blocks.filter(block => block.kind === 'paragraph').map(block => block.text)
      scoringItems.push(...scoringFromList(all, '全文扫描', warnings, limits))
    }
  }

  // Fatal clauses: full-document scan with chapter attribution.
  const fatalClauses: FatalClause[] = []
  const pushFatal = (text: string, kind: FatalClauseKind, locator: string): void => {
    if (fatalClauses.length >= limits.maxFatalClauses) return
    const clause = text.slice(0, CLAUSE_CHARS)
    fatalClauses.push({ id: clauseId(clause), clause, locator, kind })
  }
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      const kind = fatalKind(paragraph)
      if (kind !== undefined) pushFatal(paragraph, kind, chapter.section.locator)
    }
  }
  if (fatalClauses.length === 0) {
    warnings.add('未识别到废标/否决/星号条款，请人工确认实质性要求')
  }

  // Format requirements.
  const formatRequirements: string[] = []
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      if (/(装订|密封|签署|签字|盖章|份数|格式要求|排版|页码)/.test(paragraph) && /(投标文件|响应文件|标书)/.test(paragraph)) {
        if (formatRequirements.length < limits.maxFormatRequirements) {
          formatRequirements.push(paragraph.slice(0, CLAUSE_CHARS))
        }
      }
    }
  }

  const allText = raw.blocks
    .map(block => block.kind === 'paragraph' ? block.text : block.rows.map(row => row.join(' ')).join('\n'))
    .join('\n')
  return {
    meta: extractMeta(allText),
    sections: chapters.map(chapter => chapter.section),
    scoring: scoringItems,
    fatalClauses,
    formatRequirements,
    warnings: warnings.values,
  }
}

/**
 * Build the section-count limit error.
 * @param limits - resource limits.
 * @returns the error to raise.
 */
function sectionCapError(limits: Limits): BiddingError {
  return new BiddingError(`tender section count exceeds ${String(limits.maxSections)}`, {
    code: 'LIMIT_EXCEEDED',
    details: { measured: limits.maxSections, cap: limits.maxSections, recovery: 'raise maxSections or split the document' },
  })
}

/**
 * Classify one paragraph as a fatal clause kind.
 * @param paragraph - the paragraph text.
 * @returns the kind, or undefined when neutral.
 */
function fatalKind(paragraph: string): FatalClauseKind | undefined {
  if (/(废标|否决投标|否决其投标|无效投标|无效标|不予受理|按废标处理|视为放弃)/.test(paragraph)) return 'disqualification'
  if (paragraph.includes('※') || paragraph.includes('★') || /星号条款/.test(paragraph)) return 'star'
  if (/实质性(要求|响应|条款)/.test(paragraph) && paragraph.length <= CLAUSE_CHARS) return 'mandatory'
  return undefined
}

/**
 * Extract key facts from the full document text (first match wins).
 * @param text - the full document text.
 * @returns the best-effort meta.
 */
function extractMeta(text: string): TenderDocument['meta'] {
  const first = (pattern: RegExp, cap = META_CHARS): string | undefined => {
    const m = pattern.exec(text)
    if (m === null) return undefined
    const value = (m[1] ?? '').trim()
    return value === '' ? undefined : value.slice(0, cap)
  }
  const qualification: string[] = []
  for (const line of text.split('\n')) {
    if (/(资质等级|资格要求|资质要求)/.test(line) && line.trim().length <= CLAUSE_CHARS) {
      if (qualification.length < 5) qualification.push(line.trim().slice(0, META_CHARS))
    }
  }
  const deliverables: string[] = []
  for (const line of text.split('\n')) {
    if (/(交付时间|交货期|工期|服务期|交付期)/.test(line) && line.trim().length <= CLAUSE_CHARS) {
      if (deliverables.length < 5) deliverables.push(line.trim().slice(0, META_CHARS))
    }
  }
  const projectName = first(/(?:项目名称|工程名称)[：:]\s*([^\n：:]{2,})/)
  const tenderNo = first(/(?:招标编号|采购编号|项目编号|标段编号|招标项目编号)[：:]\s*([A-Za-z0-9\-—_/]{3,60})/)
  const purchaser = first(/(?:采购人|招标人|采购单位|招标单位)[：:]\s*([^\n：:]{2,80})/)
  const agency = first(/(?:代理机构|采购代理机构|招标代理机构)[：:]\s*([^\n：:]{2,80})/)
  const deadline = first(/(?:投标|递交|提交|响应)文件.{0,8}(?:截止时间|截止|时间)[：:]?\s*([0-9年月日时分:：\-/ ]{6,30})/)
  const openAt = first(/开标时间[：:]?\s*([0-9年月日时分:：\-/ ]{6,30})/)
  const bond = first(/(?:投标保证金|保证金)[：:]\s*([^\n，。；]{1,60})/)
  const contact = first(/联系人[：:]\s*([^\n：:]{2,40})/)
  return {
    ...(projectName !== undefined ? { projectName } : {}),
    ...(tenderNo !== undefined ? { tenderNo } : {}),
    ...(purchaser !== undefined ? { purchaser } : {}),
    ...(agency !== undefined ? { agency } : {}),
    ...(deadline !== undefined ? { deadline } : {}),
    ...(openAt !== undefined ? { openAt } : {}),
    ...(bond !== undefined ? { bond } : {}),
    ...(contact !== undefined ? { contact } : {}),
    ...(qualification.length > 0 ? { qualification } : {}),
    ...(deliverables.length > 0 ? { deliverables } : {}),
  }
}

/**
 * Render the raw document (plus meta header) as a Markdown sidecar.
 * @param raw - the block stream of the .docx file.
 * @param tender - the parsed projection (meta header).
 * @returns the full-text Markdown.
 */
export function renderTenderMarkdown(raw: RawDocument, tender: TenderDocument): string {
  const lines: string[] = ['# 招标文件全文提取']
  const meta = tender.meta
  if (meta.projectName !== undefined) lines.push(`- 项目名称：${meta.projectName}`)
  if (meta.tenderNo !== undefined) lines.push(`- 招标编号：${meta.tenderNo}`)
  if (meta.purchaser !== undefined) lines.push(`- 采购人：${meta.purchaser}`)
  if (meta.agency !== undefined) lines.push(`- 代理机构：${meta.agency}`)
  if (meta.deadline !== undefined) lines.push(`- 截止时间：${meta.deadline}`)
  lines.push('')
  for (const block of raw.blocks) {
    if (block.kind === 'paragraph') {
      lines.push(block.text)
    } else {
      for (const row of block.rows) {
        lines.push(`| ${row.join(' | ')} |`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

/**
 * Whether a heading is the generated table-of-contents page (rendered bids
 * always carry one; a tender's real chapters never collide with it).
 * @param title - the heading title.
 * @returns true when the heading is the TOC heading.
 */
function isTableOfContentsHeading(title: string): boolean {
  return title.replace(/\s+/g, '') === '目录'
}

/** Mutable builder of one bid section while projecting a finished bid. */
interface BidSectionBuilder {
  title: string
  level: number
  parts: string[]
}

/**
 * Project a parsed finished-bid `.docx` block stream into a {@link BidDraft}
 * so the comparison pre-screen can run against an already-rendered bid.
 * Headings (either channel) become section titles; paragraphs and tables
 * become Markdown content.
 * @param raw - the block stream of the bid .docx file.
 * @param limits - resource limits.
 * @returns the bid draft projection (tender facts left empty).
 */
export function parseBidDocument(raw: RawDocument, limits: Limits): BidDraft {
  const builders: BidSectionBuilder[] = []
  let current: BidSectionBuilder | undefined
  for (const block of raw.blocks) {
    const heading = headingOf(block)
    if (heading !== undefined) {
      if (isTableOfContentsHeading(heading.title)) continue
      current = {
        title: heading.number !== '' ? `${heading.number} ${heading.title}` : heading.title,
        level: Math.min(Math.max(heading.level, 1), 4),
        parts: [],
      }
      builders.push(current)
      continue
    }
    if (current === undefined) continue
    if (block.kind === 'paragraph') {
      const text = block.text.trim()
      if (text !== '') current.parts.push(text)
    } else {
      current.parts.push(block.rows.map(row => `| ${row.join(' | ')} |`).join('\n'))
    }
  }
  if (builders.length >= limits.maxSections) throw sectionCapError(limits)
  return {
    tender: {},
    sections: builders.map(builder => ({
      title: builder.title.slice(0, 120),
      level: builder.level,
      content: builder.parts.join('\n\n'),
      status: 'drafted',
    })),
  }
}
