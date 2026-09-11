/**
 * Minimal XML parser for Office Open XML reading.
 *
 * A hand-written state machine over the source text: no external entities, no
 * DTD resolution, no external libraries. The parser accepts exactly the XML
 * profile OOXML needs — declarations, comments, CDATA, elements, attributes,
 * the five predefined entities plus numeric character references — and fails
 * loud on anything else, which makes it immune to XXE by construction.
 * @module @deepseek-ai/dsh-bidding
 */

import { BiddingError } from '../errors.ts'

/** One parsed XML element: name, attributes, ordered children, direct text. */
export interface XmlNode {
  /** Element name, e.g. `w:p`. */
  readonly name: string
  /** Attributes keyed by qualified name. */
  readonly attrs: Readonly<Record<string, string>>
  /** Child elements in document order. */
  readonly children: readonly XmlNode[]
  /** Concatenated direct text content (including CDATA). */
  readonly text: string
}

/** Guard rails of the XML state machine. */
export interface XmlLimits {
  /** Maximum element depth; default 64. */
  readonly maxDepth: number
  /** Maximum total elements; default 100 000. */
  readonly maxElements: number
}

/** Default XML limits. */
export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxDepth: 64,
  maxElements: 100_000,
}

/** Reject with a positioned parse error. */
function fail(source: string, index: number, reason: string): never {
  const line = source.slice(0, index).split('\n').length
  throw new BiddingError(`XML parse error at line ${String(line)}: ${reason}`, { code: 'PARSE_ERROR' })
}

/** Mutable build-time node; frozen into {@link XmlNode} on close. */
interface MutableNode {
  name: string
  attrs: Record<string, string>
  children: MutableNode[]
  text: string
}

/**
 * Decode one entity reference at `index` (pointing at `&`).
 * @param value - the containing text or attribute value.
 * @param index - offset of the `&` within `value`.
 * @returns the decoded character and the offset past the `;` (within `value`).
 */
function decodeEntity(value: string, index: number): { char: string; next: number } {
  const semi = value.indexOf(';', index)
  if (semi === -1) fail(value, index, 'unterminated entity reference')
  const name = value.slice(index + 1, semi)
  switch (name) {
    case 'amp': return { char: '&', next: semi + 1 }
    case 'lt': return { char: '<', next: semi + 1 }
    case 'gt': return { char: '>', next: semi + 1 }
    case 'quot': return { char: '"', next: semi + 1 }
    case 'apos': return { char: "'", next: semi + 1 }
    default:
      if (name.length > 1 && (name[0] === '#' || (name[0] === 'x' && name[1] === '#'))) {
        const hex = name.startsWith('x#') || name.startsWith('#x')
        const digits = name.replace(/^#x|^x#|^#/, '')
        if (digits.length === 0 || digits.length > 8) fail(value, index, 'invalid character reference')
        const code = Number.parseInt(digits, hex ? 16 : 10)
        if (!Number.isFinite(code) || code < 0x9 || (code > 0xd7ff && code < 0xe000) || code > 0x10ffff) {
          fail(value, index, 'invalid character reference')
        }
        return { char: String.fromCodePoint(code), next: semi + 1 }
      }
      fail(value, index, `unknown entity "&${name};" (external entities are not resolved)`)
  }
}

/**
 * Decode entity references in a text or attribute value.
 * @param value - the raw value.
 * @returns the decoded string.
 */
function decodeText(value: string): string {
  if (!value.includes('&')) return value
  let out = ''
  let i = 0
  while (i < value.length) {
    const amp = value.indexOf('&', i)
    if (amp === -1) {
      out += value.slice(i)
      break
    }
    out += value.slice(i, amp)
    const decoded = decodeEntity(value, amp)
    out += decoded.char
    i = decoded.next
  }
  return out
}

/**
 * Skip one `<?...?>` / `<!--...-->` / `<!DOCTYPE ...>` construct starting at `i`.
 * @param source - full XML source.
 * @param i - offset of the leading `<`.
 * @returns the offset just past the construct, or undefined when `i` does not
 * start one of these.
 */
function skipMisc(source: string, i: number): number | undefined {
  if (source.startsWith('<?', i)) {
    const end = source.indexOf('?>', i + 2)
    if (end === -1) fail(source, i, 'unterminated processing instruction')
    return end + 2
  }
  if (source.startsWith('<!--', i)) {
    const end = source.indexOf('-->', i + 4)
    if (end === -1) fail(source, i, 'unterminated comment')
    return end + 3
  }
  if (/^<!doctype/i.test(source.slice(i, i + 9))) {
    // Skip the DOCTYPE with quote and bracket awareness: an internal subset may
    // contain quoted `>` characters and nested brackets.
    let depth = 0
    let quote = ''
    for (let j = i + 9; j < source.length; j++) {
      const char = source[j]
      if (quote !== '') {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '[') {
        depth++
      } else if (char === ']') {
        depth--
      } else if (char === '>' && depth <= 0) {
        return j + 1
      }
    }
    fail(source, i, 'unterminated DOCTYPE')
  }
  return undefined
}

/** Freeze a mutable node tree into the public readonly shape. */
function freeze(node: MutableNode): XmlNode {
  return {
    name: node.name,
    attrs: node.attrs,
    children: node.children.map(freeze),
    text: node.text,
  }
}

/**
 * Find the first descendant matching `predicate`, in document order.
 * @param node - root of the search.
 * @param predicate - match test.
 * @returns the first matching node, or undefined.
 */
export function findFirst(node: XmlNode, predicate: (candidate: XmlNode) => boolean): XmlNode | undefined {
  if (predicate(node)) return node
  for (const child of node.children) {
    const hit = findFirst(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * Concatenate the text of all descendant elements named `name`.
 * @param node - root of the search.
 * @param name - element name, e.g. `w:t`.
 * @returns the joined text content.
 */
export function textOfDescendants(node: XmlNode, name: string): string {
  let out = ''
  for (const child of node.children) {
    if (child.name === name) out += child.text
    out += textOfDescendants(child, name)
  }
  return out
}

/**
 * Parse an XML source into one root {@link XmlNode}.
 * @param source - the XML document text.
 * @param limits - parse guard rails.
 * @returns the root element node.
 */
export function parseXml(source: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlNode {
  if (source.startsWith('﻿')) {
    source = source.slice(1)
  }
  let root: MutableNode | undefined
  const stack: MutableNode[] = []
  let elements = 0
  let i = 0
  while (i < source.length) {
    if (source[i] !== '<') {
      // Text content: only allowed inside an element.
      const next = source.indexOf('<', i)
      const end = next === -1 ? source.length : next
      const raw = source.slice(i, end)
      if (stack.length === 0 && raw.trim() !== '') fail(source, i, 'text content outside the root element')
      if (stack.length > 0 && raw !== '') {
        const top = stack[stack.length - 1]
        if (top !== undefined) top.text += decodeText(raw)
      }
      i = end
      continue
    }
    const miscEnd = skipMisc(source, i)
    if (miscEnd !== undefined) {
      i = miscEnd
      continue
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9)
      if (end === -1) fail(source, i, 'unterminated CDATA section')
      const raw = source.slice(i + 9, end)
      if (stack.length === 0) fail(source, i, 'CDATA outside the root element')
      const cdataTop = stack[stack.length - 1]
      if (cdataTop !== undefined) cdataTop.text += raw
      i = end + 3
      continue
    }
    if (source[i + 1] === '/') {
      // Closing tag.
      const end = source.indexOf('>', i)
      if (end === -1) fail(source, i, 'unterminated closing tag')
      const name = source.slice(i + 2, end).trim()
      const top = stack.pop()
      if (top === undefined) fail(source, i, `unexpected closing tag </${name}>`)
      if (top.name !== name) fail(source, i, `mismatched closing tag </${name}> for <${top.name}>`)
      if (stack.length === 0) {
        root = top
        // Only whitespace may follow the root element.
        if (source.slice(end + 1).trim() !== '') fail(source, end + 1, 'content after the root element')
      }
      i = end + 1
      continue
    }
    // Opening tag: parse the name.
    let j = i + 1
    while (j < source.length && /[^\s/>]/.test(source.charAt(j))) j++
    const name = source.slice(i + 1, j)
    if (name === '') fail(source, i, 'empty element name')
    // Parse attributes until `>` or `/>`.
    const attrs: Record<string, string> = {}
    let selfClosing = false
    for (;;) {
      while (j < source.length && /\s/.test(source.charAt(j))) j++
      if (j >= source.length) fail(source, i, 'unterminated opening tag')
      if (source[j] === '>') {
        j++
        break
      }
      if (source[j] === '/' && source[j + 1] === '>') {
        selfClosing = true
        j += 2
        break
      }
      const attrStart = j
      while (j < source.length && /[^\s=/>]/.test(source.charAt(j))) j++
      const attrName = source.slice(attrStart, j)
      if (attrName === '') fail(source, j, 'expected attribute name')
      while (j < source.length && /\s/.test(source.charAt(j))) j++
      if (source[j] !== '=') fail(source, j, `expected "=" after attribute "${attrName}"`)
      j++
      while (j < source.length && /\s/.test(source.charAt(j))) j++
      const quote = source[j]
      if (quote !== '"' && quote !== "'") fail(source, j, 'attribute value must be quoted')
      const valueEnd = source.indexOf(quote, j + 1)
      if (valueEnd === -1) fail(source, j, 'unterminated attribute value')
      const rawValue = source.slice(j + 1, valueEnd)
      if (attrName in attrs) fail(source, attrStart, `duplicate attribute "${attrName}"`)
      attrs[attrName] = decodeText(rawValue)
      j = valueEnd + 1
    }
    elements++
    if (elements > limits.maxElements) {
      throw new BiddingError(`XML element count exceeds ${String(limits.maxElements)}`, { code: 'LIMIT_EXCEEDED' })
    }
    const node: MutableNode = { name, attrs, children: [], text: '' }
    if (stack.length > 0) {
      const parent = stack[stack.length - 1]
      if (parent !== undefined) parent.children.push(node)
    }
    if (!selfClosing) {
      if (stack.length + 1 > limits.maxDepth) {
        throw new BiddingError(`XML nesting depth exceeds ${String(limits.maxDepth)}`, { code: 'LIMIT_EXCEEDED' })
      }
      stack.push(node)
    } else if (stack.length === 0) {
      root = node
      if (source.slice(j).trim() !== '') fail(source, j, 'content after the root element')
    }
    i = j
  }
  if (stack.length > 0) fail(source, i, `unclosed element <${stack[stack.length - 1]?.name ?? ''}>`)
  if (root === undefined) fail(source, 0, 'no root element')
  return freeze(root)
}
