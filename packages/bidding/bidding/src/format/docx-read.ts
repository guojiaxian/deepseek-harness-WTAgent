/**
 * `.docx` reader: parse an OOXML package into a block stream.
 *
 * Extracts `word/document.xml` (and the optional `word/styles.xml`) from the
 * ZIP archive and projects the body into an ordered block stream of paragraphs
 * (carrying style id/name and outline level) and tables (rows of cell text).
 * The projection is exactly what tender chapter detection needs — nothing more.
 * @module @deepseek-ai/dsh-bidding
 */

import { BiddingError } from '../errors.ts'
import { parseXml, textOfDescendants } from './xml.ts'
import type { XmlNode } from './xml.ts'
import { readZipEntries } from './zip.ts'

/** One paragraph block. */
export interface RawParagraph {
  readonly kind: 'paragraph'
  /** Style id from `w:pStyle`, when present. */
  readonly style?: string
  /** Style display name resolved through styles.xml, when known. */
  readonly styleName?: string
  /** Outline level from `w:outlineLvl`, 0-based, when present. */
  readonly outlineLevel?: number
  /** Concatenated text of all `w:t` runs in the paragraph. */
  readonly text: string
}

/** One table block: rows of cell text (nested tables are flattened to text). */
export interface RawTable {
  readonly kind: 'table'
  readonly rows: readonly (readonly string[])[]
}

/** One block of the projected document body. */
export type RawBlock = RawParagraph | RawTable

/** The projected `.docx` document. */
export interface RawDocument {
  readonly blocks: readonly RawBlock[]
}

/** Attribute lookup on an element: `undefined` when absent. */
function attr(node: XmlNode, name: string): string | undefined {
  return node.attrs[name]
}

/** First child element with the given name. */
function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find(candidate => candidate.name === name)
}

/** All child elements with the given name. */
function children(node: XmlNode, name: string): readonly XmlNode[] {
  return node.children.filter(candidate => candidate.name === name)
}

/**
 * Map style ids to display names through `word/styles.xml`.
 * @param stylesXml - the parsed styles part, when the archive has one.
 * @returns the id → name map.
 */
function styleNames(stylesXml: XmlNode | undefined): Map<string, string> {
  const names = new Map<string, string>()
  if (stylesXml === undefined) return names
  for (const style of children(stylesXml, 'w:style')) {
    const id = attr(style, 'w:styleId')
    const name = child(style, 'w:name')
    const val = name !== undefined ? attr(name, 'w:val') : undefined
    if (id !== undefined && val !== undefined) names.set(id, val)
  }
  return names
}

/**
 * Project one `w:p` element into a paragraph block.
 * @param paragraph - the paragraph element.
 * @param names - style id → display name map.
 * @returns the paragraph block.
 */
function paragraphBlock(paragraph: XmlNode, names: Map<string, string>): RawParagraph {
  const properties = child(paragraph, 'w:pPr')
  let style: string | undefined
  let outlineLevel: number | undefined
  if (properties !== undefined) {
    const styleElement = child(properties, 'w:pStyle')
    const styleId = styleElement !== undefined ? attr(styleElement, 'w:val') : undefined
    if (styleId !== undefined && styleId !== '') style = styleId
    const outlineElement = child(properties, 'w:outlineLvl')
    const outlineVal = outlineElement !== undefined ? attr(outlineElement, 'w:val') : undefined
    if (outlineVal !== undefined) {
      const parsed = Number.parseInt(outlineVal, 10)
      if (Number.isInteger(parsed) && parsed >= 0) outlineLevel = parsed
    }
  }
  const styleName = style !== undefined ? names.get(style) : undefined
  // exactOptionalPropertyTypes: optional fields only appear when defined.
  return {
    kind: 'paragraph',
    ...(style !== undefined ? { style } : {}),
    ...(styleName !== undefined ? { styleName } : {}),
    ...(outlineLevel !== undefined ? { outlineLevel } : {}),
    text: textOfDescendants(paragraph, 'w:t'),
  }
}

/**
 * Project one `w:tbl` element into a table block.
 * @param table - the table element.
 * @returns the table block.
 */
function tableBlock(table: XmlNode): RawTable {
  const rows: string[][] = []
  for (const row of children(table, 'w:tr')) {
    const cells: string[] = []
    for (const cell of children(row, 'w:tc')) {
      cells.push(textOfDescendants(cell, 'w:t'))
    }
    rows.push(cells)
  }
  return { kind: 'table', rows }
}

/**
 * Parse a `.docx` package into its block stream.
 * @param bytes - the complete .docx (ZIP) bytes.
 * @param maxBlocks - block count cap.
 * @returns the projected document.
 */
export function parseDocx(bytes: Uint8Array, maxBlocks: number): RawDocument {
  const entries = readZipEntries(bytes)
  const documentBytes = entries.get('word/document.xml')
  if (documentBytes === undefined) {
    throw new BiddingError('the archive has no word/document.xml part (not a .docx file)', { code: 'UNSUPPORTED_FORMAT' })
  }
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const documentXml = parseXml(decoder.decode(documentBytes))
  const body = child(documentXml, 'w:body')
  if (body === undefined) {
    throw new BiddingError('the document part has no w:body element', { code: 'PARSE_ERROR' })
  }
  const stylesBytes = entries.get('word/styles.xml')
  const names = styleNames(stylesBytes === undefined ? undefined : parseXml(decoder.decode(stylesBytes)))

  const blocks: RawBlock[] = []
  for (const element of body.children) {
    if (blocks.length >= maxBlocks) {
      throw new BiddingError(`document block count exceeds ${String(maxBlocks)}`, {
        code: 'LIMIT_EXCEEDED',
        details: { measured: blocks.length, cap: maxBlocks, recovery: 'use a smaller document' },
      })
    }
    if (element.name === 'w:p') {
      blocks.push(paragraphBlock(element, names))
    } else if (element.name === 'w:tbl') {
      blocks.push(tableBlock(element))
    }
  }
  return { blocks }
}
