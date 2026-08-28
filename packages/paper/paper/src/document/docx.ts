/**
 * `.docx` renderer: hand-built OOXML document inside a store-only ZIP archive.
 *
 * Builds a minimal but standards-conforming WordprocessingML document with a
 * title, abstract, numbered sections, a references list, and a running header
 * and footer carrying the config text and an optional page-number field. The
 * parts — `[Content_Types].xml`, the two `.rels` relationship files,
 * `word/document.xml`, `word/styles.xml`, and the header/footer parts — are
 * assembled here and zipped by `buildZip`. Dependency-free, deterministic, and
 * readable by Word, LibreOffice, and every common unzip tool.
 * @module @deepseek-ai/dsh-paper
 */

import { referenceText } from './reference.ts'
import type { Paper } from '../types.ts'
import type { ResolvedDocumentConfig } from './config.ts'
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

/**
 * Render a paper as `.docx` bytes.
 * @param paper - paper to render.
 * @param config - resolved layout and content configuration.
 * @returns the complete OOXML ZIP archive.
 */
export function renderDocx(paper: Paper, config: ResolvedDocumentConfig): Uint8Array {
  const margin = Math.round(config.marginsMm * TWIPS_PER_MM)
  const doc = documentXml(paper, margin)
  const styles = stylesXml(config)
  const header = headerXml(config.headerText)
  const footer = footerXml(config.footerText, config.pageNumbers)
  return buildZip([
    { name: '[Content_Types].xml', data: encode(contentTypesXml()) },
    { name: '_rels/.rels', data: encode(rootRelsXml()) },
    { name: 'word/document.xml', data: encode(doc) },
    { name: 'word/_rels/document.xml.rels', data: encode(documentRelsXml()) },
    { name: 'word/styles.xml', data: encode(styles) },
    { name: 'word/header1.xml', data: encode(header) },
    { name: 'word/footer1.xml', data: encode(footer) },
  ])
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

/** The styles part: Normal defaults plus Title and Heading1 paragraph styles. */
function stylesXml(config: ResolvedDocumentConfig): string {
  const font = escapeXml(config.fontFamily)
  const size = Math.round(config.fontSizePt * 2)
  const line = Math.round(config.lineSpacing * 240)
  const after = Math.round(config.paragraphSpacingPt * 20)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="${after}" w:line="${line}" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>
<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Title">
<w:name w:val="Title"/>
<w:pPr><w:spacing w:before="0" w:after="${Math.round(after * 2)}"/><w:jc w:val="center"/></w:pPr>
<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:b/><w:sz w:val="${Math.round(size * 1.4)}"/><w:szCs w:val="${Math.round(size * 1.4)}"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading1">
<w:name w:val="Heading 1"/>
<w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="${after}" w:after="${after}"/><w:keepNext/></w:pPr>
<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:b/></w:rPr>
</w:style>
</w:styles>`
}

/** A header paragraph carrying the configured header text, centered. */
function headerXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${NS_W}">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>
</w:hdr>`
}

/** A footer paragraph carrying the configured footer text and page page number. */
function footerXml(text: string, pageNumbers: boolean): string {
  const runs: string[] = []
  if (text !== '') runs.push(textRun(text))
  if (pageNumbers) runs.push(textRun(' '), pageField())
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${NS_W}">
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runs.join('')}</w:p>
</w:ftr>`
}

/** The OOXML `PAGE` field: begin, instruction, separate, and end runs. */
function pageField(): string {
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
}

/** One run of literal text. */
function textRun(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

/** A paragraph bound to a named style, with one text run. */
function styledParagraph(style: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${textRun(text)}</w:p>`
}

/** The document body: title, abstract, sections, references, and section props. */
function documentXml(paper: Paper, margin: number): string {
  const paragraphs: string[] = []
  if (paper.title !== undefined && paper.title !== '') {
    paragraphs.push(styledParagraph('Title', paper.title))
  }
  if (paper.abstract !== undefined && paper.abstract !== '') {
    paragraphs.push(styledParagraph('Normal', `Abstract: ${paper.abstract}`))
  }
  for (const section of paper.sections) {
    if (section.heading !== undefined && section.heading !== '') {
      paragraphs.push(styledParagraph('Heading1', section.heading))
    }
    for (const paragraph of section.paragraphs) {
      paragraphs.push(styledParagraph('Normal', paragraph))
    }
  }
  if (paper.citations.length > 0) {
    paragraphs.push(styledParagraph('Heading1', 'References'))
    paper.citations.forEach((citation, index) => {
      paragraphs.push(styledParagraph('Normal', `[${index + 1}] ${referenceText(citation)}`))
    })
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}">
<w:body>
${paragraphs.join('\n')}
<w:sectPr>
<w:headerReference w:type="default" r:id="rId2"/>
<w:footerReference w:type="default" r:id="rId3"/>
<w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}"/>
<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="${HEADER_OFFSET_TWIPS}" w:footer="${HEADER_OFFSET_TWIPS}" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`
}
