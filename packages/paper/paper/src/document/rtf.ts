/**
 * `.doc` renderer: Rich Text Format output readable by Word and LibreOffice.
 *
 * RTF is a plain-text tagged format, so the renderer can stay dependency-free
 * while still expressing page geometry, running headers/footers, a current
 * page-number field, font family, font size, line spacing, and paragraph
 * spacing. Text is escaped per the RTF spec (literal `{`, `}`, `\`, and
 * non-ASCII `\uN?` escapes) so papers with non-ASCII content survive intact.
 * @module @deepseek-ai/dsh-paper
 */

import { referenceText } from './reference.ts'
import type { Paper } from '../types.ts'
import type { ResolvedDocumentConfig } from './config.ts'

/** Twips per millimeter, matching the docx renderer. */
const TWIPS_PER_MM = 56.6929
/** A4 page width in twips. */
const A4_WIDTH_TWIPS = 11909
/** A4 page height in twips. */
const A4_HEIGHT_TWIPS = 16840

/**
 * Render a paper as `.doc` RTF bytes.
 * @param paper - paper to render.
 * @param config - resolved layout and content configuration.
 * @returns the RTF document bytes.
 */
export function renderDoc(paper: Paper, config: ResolvedDocumentConfig): Uint8Array {
  return new TextEncoder().encode(buildRtf(paper, config))
}

/** Assemble the complete RTF source string. */
function buildRtf(paper: Paper, config: ResolvedDocumentConfig): string {
  const margin = Math.round(config.marginsMm * TWIPS_PER_MM)
  const line = Math.round(config.lineSpacing * 240)
  const after = Math.round(config.paragraphSpacingPt * 20)
  const size = Math.round(config.fontSizePt * 2)
  const headingSize = Math.round(size * 1.2)
  const titleSize = Math.round(size * 1.4)
  const font = escapeRtf(config.fontFamily)

  const blocks: string[] = [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0 ' + font + ';}}',
    `\\paperw${A4_WIDTH_TWIPS}\\paperh${A4_HEIGHT_TWIPS}`,
    `\\margl${margin}\\margr${margin}\\margt${margin}\\margb${margin}`,
    `{\\header\\pard\\qc\\f0\\fs18 ${escapeRtf(config.headerText)}\\par}`,
  ]
  const page = config.pageNumbers ? 'Page \\chpgn' : ''
  blocks.push(`{\\footer\\pard\\qc\\f0\\fs18 ${escapeRtf(config.footerText)}${page !== '' ? ` ${page}` : ''}\\par}`)

  if (paper.title !== undefined && paper.title !== '') {
    blocks.push(`\\pard\\qc\\f0\\b\\fs${titleSize} ${escapeRtf(paper.title)}\\b0\\sa${after}\\par`)
  }
  if (paper.abstract !== undefined && paper.abstract !== '') {
    blocks.push(`\\pard\\qj\\f0\\b\\fs${size} Abstract:{\\b0 }${escapeRtf(paper.abstract)}\\sa${after}\\sl${line}\\slmult1\\par`)
  }
  for (const section of paper.sections) {
    if (section.heading !== undefined && section.heading !== '') {
      blocks.push(`\\pard\\qj\\f0\\b\\fs${headingSize} ${escapeRtf(section.heading)}\\b0\\sa${after}\\sl${line}\\slmult1\\par`)
    }
    for (const paragraph of section.paragraphs) {
      blocks.push(`\\pard\\qj\\f0\\fs${size} ${escapeRtf(paragraph)}\\sa${after}\\sl${line}\\slmult1\\par`)
    }
  }
  if (paper.citations.length > 0) {
    blocks.push(`\\pard\\qj\\f0\\b\\fs${headingSize} References\\b0\\sa${after}\\sl${line}\\slmult1\\par`)
    paper.citations.forEach((citation, index) => {
      blocks.push(`\\pard\\qj\\f0\\fs${size} [${index + 1}] ${escapeRtf(referenceText(citation))}\\sa${after}\\sl${line}\\slmult1\\par`)
    })
  }
  blocks.push('}')
  return blocks.join('\n')
}

/**
 * Escape a string for an RTF text destination: braces, backslash, and every
 * non-ASCII code unit as a signed `\uN?` escape so Word recovers it as UTF-16.
 * @param value - raw string.
 * @returns the RTF source form.
 */
export function escapeRtf(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 92) out += '\\\\'
    else if (code === 123) out += '\\{'
    else if (code === 125) out += '\\}'
    else if (code >= 128) out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`
    else out += String.fromCharCode(code)
  }
  return out
}
