/**
 * `.docx` renderer: hand-built OOXML document inside a store-only ZIP archive.
 *
 * Follows the paper engine's proven zero-dependency pattern and extends it with
 * bid-critical elements: a centered cover page, a `TOC` field (Word computes the
 * page numbers when the user updates fields on open), Heading 1–4 styles with a
 * CJK typeface ladder (黑体 headings over 宋体 body), and real `w:tbl` tables
 * parsed from Markdown table syntax. Readable by Word and LibreOffice.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidDraft, DraftSection } from '../types.ts'
import { buildZip } from './zip.ts'

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** Twips per millimeter used to convert margins and page geometry. */
const TWIPS_PER_MM = 56.6929
/** A4 page width in twips. */
const A4_WIDTH_TWIPS = 11909
/** A4 page height in twips. */
const A4_HEIGHT_TWIPS = 16840
/** Header/footer distance from the page edge in twips. */
const HEADER_OFFSET_TWIPS = 720

/** Fully resolved rendering configuration (see `render.ts`). */
export interface ResolvedDocxConfig {
  readonly headerText: string
  readonly footerText: string
  readonly pageNumbers: boolean
  readonly bodyFontFamily: string
  readonly headingFontFamily: string
  readonly fontSizePt: number
  readonly lineSpacing: number
  readonly paragraphSpacingPt: number
  readonly marginsMm: number
}

/** Encode a UTF-8 XML source string into bytes. */
function encode(source: string): Uint8Array {
  return new TextEncoder().encode(source)
}

/** Escape text for use inside XML text nodes and attribute values. */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[char] as string)
}

/** One run of literal text. */
function textRun(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/** A paragraph bound to a named style, with one text run. */
function styledParagraph(style: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${textRun(text)}</w:p>`
}

/** One centered paragraph with direct font sizing (cover page lines). */
function coverLine(text: string, halfPoints: number, font: string, bold: boolean): string {
  const boldTag = bold ? '<w:b/>' : ''
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
    `<w:r><w:rPr><w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:eastAsia="${escapeXml(font)}"/>${boldTag}` +
    `<w:sz w:val="${String(halfPoints)}"/><w:szCs w:val="${String(halfPoints)}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

/** An explicit page-break paragraph. */
function pageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
}

/** The OOXML `PAGE` field: begin, instruction, separate, and end runs. */
function pageField(): string {
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
}

/** The OOXML `TOC` field over headings 1-3, marked dirty so Word refreshes it. */
function tocField(): string {
  return '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>目录（打开后按 Ctrl+A、F9 更新域）</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
}

/** One body paragraph with the Normal style. */
function bodyParagraph(text: string): string {
  return styledParagraph('Normal', text)
}

/** One bullet paragraph: a literal bullet glyph plus the item text. */
function bulletParagraph(text: string): string {
  return styledParagraph('Normal', `• ${text}`)
}

/** One cell of a table row. */
function tableCell(text: string, bold: boolean, widthTwips: number): string {
  const boldTag = bold ? '<w:b/>' : ''
  return `<w:tc><w:tcPr><w:tcW w:w="${String(widthTwips)}" w:type="dxa"/></w:tcPr>` +
    '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="left"/></w:pPr>' +
    `<w:r>${boldTag !== '' ? `<w:rPr>${boldTag}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
}

/** One row of a table. */
function tableRow(cells: readonly string[], bold: boolean, widthTwips: number): string {
  return `<w:tr>${cells.map(cell => tableCell(cell, bold, widthTwips)).join('')}</w:tr>`
}

/** A bordered table with equal column widths and a bold header row. */
function tableBlock(rows: readonly (readonly string[])[], config: ResolvedDocxConfig): string {
  const columnCount = Math.max(...rows.map(row => row.length), 1)
  const usable = A4_WIDTH_TWIPS - 2 * Math.round(config.marginsMm * TWIPS_PER_MM)
  const width = Math.max(320, Math.floor(usable / columnCount))
  const borders = '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(edge => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
      .join('') +
    '</w:tblBorders>'
  const grid = `<w:tblGrid>${Array.from({ length: columnCount }, () => `<w:gridCol w:w="${String(width)}"/>`).join('')}</w:tblGrid>`
  const body = rows.map((row, index) => tableRow(row, index === 0, width)).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>${grid}${body}</w:tbl>`
}

/** One parsed Markdown table. */
interface MarkdownTable {
  readonly kind: 'table'
  readonly rows: readonly (readonly string[])[]
}

/** One parsed Markdown bullet item. */
interface MarkdownBullet {
  readonly kind: 'bullet'
  readonly text: string
}

/** One parsed Markdown body paragraph. */
interface MarkdownParagraph {
  readonly kind: 'paragraph'
  readonly text: string
}

type ContentPart = MarkdownTable | MarkdownBullet | MarkdownParagraph

/**
 * Split section content into paragraphs, bullets, and tables.
 * @param content - Markdown content (paragraphs, `- ` bullets, pipe tables).
 * @returns the ordered inline parts.
 */
function contentParts(content: string): ContentPart[] {
  const lines = content.split('\n')
  const parts: ContentPart[] = []
  let paragraph: string[] = []
  let tableLines: string[] = []
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      parts.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }
  const flushTable = (): void => {
    if (tableLines.length > 0) {
      const rows: string[][] = []
      for (const line of tableLines) {
        const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
        // Skip the separator row (`|---|---|`).
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue
        rows.push(cells)
      }
      if (rows.length > 0) parts.push({ kind: 'table', rows })
      tableLines = []
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|')) {
      flushParagraph()
      tableLines.push(trimmed)
      continue
    }
    flushTable()
    if (trimmed === '') {
      flushParagraph()
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    if (bullet !== null) {
      flushParagraph()
      parts.push({ kind: 'bullet', text: bullet[1] ?? '' })
      continue
    }
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushTable()
  return parts
}

/** The cover page: project / tender no. / bidder / date, then a page break. */
function coverXml(draft: BidDraft, config: ResolvedDocxConfig): string {
  const parts: string[] = []
  parts.push(coverLine('', 24, config.bodyFontFamily, false))
  parts.push(coverLine('', 24, config.bodyFontFamily, false))
  const projectName = draft.tender.projectName ?? ''
  if (projectName !== '') parts.push(coverLine(projectName, 44, config.headingFontFamily, true))
  if (draft.tender.tenderNo !== undefined && draft.tender.tenderNo !== '') {
    parts.push(coverLine(`（招标编号：${draft.tender.tenderNo}）`, 28, config.bodyFontFamily, false))
  }
  parts.push(coverLine('投 标 文 件', 72, config.headingFontFamily, true))
  if (draft.tender.purchaser !== undefined && draft.tender.purchaser !== '') {
    parts.push(coverLine(`投标人：${draft.tender.purchaser}`, 28, config.bodyFontFamily, false))
  }
  parts.push(coverLine(new Date().toISOString().slice(0, 10), 24, config.bodyFontFamily, false))
  parts.push(pageBreak())
  return parts.join('')
}

/**
 * The TOC page: a centered bold title (deliberately not a Heading style, so
 * the refreshed TOC field does not swallow its own heading) plus the dirty TOC
 * field, then a page break.
 * @param config - resolved layout configuration (heading typeface).
 */
function tocXml(config: ResolvedDocxConfig): string {
  return coverLine('目 录', 32, config.headingFontFamily, true) + tocField() + pageBreak()
}

/** One draft section: heading paragraph plus rendered content parts. */
function sectionXml(section: DraftSection, config: ResolvedDocxConfig): string {
  const headingStyle = `Heading${String(Math.min(Math.max(section.level, 1), 4))}`
  const parts: string[] = [styledParagraph(headingStyle, section.title)]
  for (const part of contentParts(section.content)) {
    if (part.kind === 'paragraph') {
      parts.push(bodyParagraph(part.text))
    } else if (part.kind === 'bullet') {
      parts.push(bulletParagraph(part.text))
    } else {
      parts.push(tableBlock(part.rows, config))
    }
  }
  return parts.join('\n')
}

/** The styles part: Normal defaults, Title, and Heading1-4. */
function stylesXml(config: ResolvedDocxConfig): string {
  const body = escapeXml(config.bodyFontFamily)
  const heading = escapeXml(config.headingFontFamily)
  const size = Math.round(config.fontSizePt * 2)
  const line = Math.round(config.lineSpacing * 240)
  const after = Math.round(config.paragraphSpacingPt * 20)
  const fonts = (font: string): string =>
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/>`
  const headingStyle = (id: string, name: string, scale: number): string => `
<w:style w:type="paragraph" w:styleId="${id}">
<w:name w:val="${name}"/>
<w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="${String(after * 2)}" w:after="${String(after)}"/><w:keepNext/><w:outlineLvl w:val="${String(Number.parseInt(id.replace('Heading', ''), 10) - 1)}"/></w:pPr>
<w:rPr>${fonts(heading)}<w:b/><w:sz w:val="${String(Math.round(size * scale))}"/><w:szCs w:val="${String(Math.round(size * scale))}"/></w:rPr>
</w:style>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="${String(after)}" w:line="${String(line)}" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>
<w:rPr>${fonts(body)}<w:sz w:val="${String(size)}"/><w:szCs w:val="${String(size)}"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Title">
<w:name w:val="Title"/>
<w:pPr><w:spacing w:before="0" w:after="${String(after * 2)}"/><w:jc w:val="center"/></w:pPr>
<w:rPr>${fonts(heading)}<w:b/><w:sz w:val="${String(Math.round(size * 1.4))}"/><w:szCs w:val="${String(Math.round(size * 1.4))}"/></w:rPr>
</w:style>${headingStyle('Heading1', 'Heading 1', 1.4)}${headingStyle('Heading2', 'Heading 2', 1.25)}${headingStyle('Heading3', 'Heading 3', 1.12)}${headingStyle('Heading4', 'Heading 4', 1.05)}
</w:styles>`
}

/** A header paragraph carrying the configured header text, centered. */
function headerXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${NS_W}">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${textRun(text)}</w:p>
</w:hdr>`
}

/** A footer paragraph carrying the configured footer text and page number. */
function footerXml(text: string, pageNumbers: boolean): string {
  const runs: string[] = []
  if (text !== '') runs.push(textRun(text))
  if (pageNumbers) runs.push(textRun(' '), pageField())
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${NS_W}">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs.join('')}</w:p>
</w:ftr>`
}

/** The package-level content-type overrides for each part. */
function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`
}

/** Root relationships mapping the package to the document part. */
function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/>
</Relationships>`
}

/** Document-level relationships linking styles, header, and footer parts. */
function documentRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">
<Relationship Id="rId1" Type="${NS_R}/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="${NS_R}/header" Target="header1.xml"/>
<Relationship Id="rId3" Type="${NS_R}/footer" Target="footer1.xml"/>
</Relationships>`
}

/**
 * Render a bid draft as `.docx` bytes.
 * @param draft - the draft to render.
 * @param config - resolved layout configuration.
 * @returns the complete OOXML ZIP archive.
 */
export function renderDocx(draft: BidDraft, config: ResolvedDocxConfig): Uint8Array {
  const margin = Math.round(config.marginsMm * TWIPS_PER_MM)
  const body = [
    coverXml(draft, config),
    tocXml(config),
    ...draft.sections.map(section => sectionXml(section, config)),
  ].join('\n')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}">
<w:body>
${body}
<w:sectPr>
<w:headerReference w:type="default" r:id="rId2"/>
<w:footerReference w:type="default" r:id="rId3"/>
<w:pgSz w:w="${String(A4_WIDTH_TWIPS)}" w:h="${String(A4_HEIGHT_TWIPS)}"/>
<w:pgMar w:top="${String(margin)}" w:right="${String(margin)}" w:bottom="${String(margin)}" w:left="${String(margin)}" w:header="${String(HEADER_OFFSET_TWIPS)}" w:footer="${String(HEADER_OFFSET_TWIPS)}" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`
  return buildZip([
    { name: '[Content_Types].xml', data: encode(contentTypesXml()) },
    { name: '_rels/.rels', data: encode(rootRelsXml()) },
    { name: 'word/document.xml', data: encode(document) },
    { name: 'word/_rels/document.xml.rels', data: encode(documentRelsXml()) },
    { name: 'word/styles.xml', data: encode(stylesXml(config)) },
    { name: 'word/header1.xml', data: encode(headerXml(config.headerText)) },
    { name: 'word/footer1.xml', data: encode(footerXml(config.footerText, config.pageNumbers)) },
  ])
}
