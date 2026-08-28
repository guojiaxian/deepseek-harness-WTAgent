import { describe, expect, it } from 'vitest'
import { validateDocumentConfig, renderDocument, renderDocx, renderDoc, referenceText, escapeRtf } from '../src/document/index.ts'
import { buildZip } from '../src/document/zip.ts'
import type { Limits, Paper } from '../src/types.ts'

// `LIMITS` intentionally omits `maxOutputBytes` so `renderDocument` applies its own default cap.
const LIMITS: Limits = { maxInputBytes: 1_000_000, maxSections: 50, maxParagraphs: 50, maxCitations: 30, maxFindings: 50 }

/** Minimal paper exercising title, abstract, sections, and references. */
const PAPER: Paper = {
  title: 'A Study of & <Things> "here"',
  abstract: 'An abstract.',
  sections: [
    { kind: 'heading', heading: 'Introduction', paragraphs: ['Due to the fact that it matters.'] },
    { kind: 'paragraph', paragraphs: ['A second paragraph with \'quotes\' and special {braces}.'] },
  ],
  citations: [
    {
      id: '1', kind: 'journal', authors: ['Smith, J.'], year: '2020', title: 'A. S',
      raw: 'Smith, J. (2020) A. S, 1(1), 2-3.', formatted: 'Smith, J. (2020). A. S, 1(1), 2-3.',
    },
    { id: '2', kind: 'journal', authors: [], year: '2021', title: 'B', raw: '中文论文 (2021) B.' },
  ],
  meta: {},
}

const decoder = new TextDecoder()

/** Decode a rendered document back to its XML/RTF source. */
function textOf(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

describe('validateDocumentConfig', () => {
  it('resolves every field to its default', () => {
    expect(validateDocumentConfig({})).toEqual({
      headerText: '',
      footerText: '',
      pageNumbers: true,
      fontFamily: 'Times New Roman',
      fontSizePt: 12,
      lineSpacing: 1.5,
      paragraphSpacingPt: 6,
      marginsMm: 25.4,
    })
  })

  it('accepts user-supplied layout options', () => {
    const config = validateDocumentConfig({
      headerText: 'H', footerText: 'F', pageNumbers: false,
      fontFamily: 'SimSun', fontSizePt: 11, lineSpacing: 2, paragraphSpacingPt: 0, marginsMm: 20,
    })
    expect(config).toMatchObject({ headerText: 'H', footerText: 'F', fontSizePt: 11, lineSpacing: 2, marginsMm: 20 })
  })

  it('rejects unknown keys and wrong types', () => {
    expect(() => validateDocumentConfig({ nope: 1 })).toThrow(/unknown document option/)
    expect(() => validateDocumentConfig({ pageNumbers: 'x' })).toThrow(/must be a boolean/)
    expect(() => validateDocumentConfig({ fontFamily: '   ' })).toThrow(/non-empty string/)
    expect(() => validateDocumentConfig({ fontSizePt: 'x' })).toThrow(/finite number/)
    expect(() => validateDocumentConfig({ fontSizePt: 0 })).toThrow(/must be a positive number/)
    expect(() => validateDocumentConfig({ paragraphSpacingPt: -1 })).toThrow(/must be zero or positive/)
    expect(() => validateDocumentConfig('nope')).toThrow(/must be an object/)
  })
})

describe('referenceText', () => {
  it('prefers a formatted citation and falls back to raw text', () => {
    expect(referenceText({ raw: 'raw', formatted: 'formatted' })).toBe('formatted')
    expect(referenceText({ raw: 'raw only' })).toBe('raw only')
  })
})

describe('escapeRtf', () => {
  it('escapes braces, backslashes, and non-ASCII code units', () => {
    expect(escapeRtf('a{b}c\\d')).toBe('a\\{b\\}c\\\\d')
    expect(escapeRtf('中A')).toBe('\\u20013?A')
    expect(escapeRtf('plain')).toBe('plain')
  })
})

describe('renderDocument dispatch', () => {
  it('renders docx under the default output cap', () => {
    const output = renderDocument(PAPER, 'docx', validateDocumentConfig({}), LIMITS)
    expect(output.format).toBe('docx')
    expect(output.data.byteLength).toBeGreaterThan(0)
    expect(output.checksum).toHaveLength(64)
    expect(textOf(output.data).slice(0, 2)).toBe('PK')
  })

  it('renders doc (RTF) with a custom config', () => {
    const output = renderDocument(PAPER, 'doc', validateDocumentConfig({ pageNumbers: true }), LIMITS)
    expect(output.format).toBe('doc')
    expect(textOf(output.data)).toContain('\\rtf1')
  })

  it('rejects an unsupported format with recovery guidance', () => {
    try {
      renderDocument(PAPER, 'pdf', validateDocumentConfig({}), LIMITS)
      throw new Error('expected failure')
    } catch (error) {
      const err = error as { code: string; message: string }
      expect(err.code).toBe('UNSUPPORTED_FORMAT')
      expect(err.message).toContain('use "doc" or "docx"')
    }
  })

  it('enforces the configured output byte cap with recovery guidance', () => {
    try {
      renderDocument(PAPER, 'docx', validateDocumentConfig({}), { ...LIMITS, maxOutputBytes: 8 })
      throw new Error('expected failure')
    } catch (error) {
      const err = error as { code: string; message: string; details: { maxBytes: number } }
      expect(err.code).toBe('LIMIT_EXCEEDED')
      expect(err.message).toMatch(/exceeds the 8 byte limit/)
      expect(err.details.maxBytes).toBe(8)
    }
  })
})

describe('renderDocx', () => {
  it('builds a ZIP archive with the OOXML parts and a page-number field', () => {
    const bytes = renderDocx(PAPER, validateDocumentConfig({ headerText: 'Draft', footerText: 'Confidential', pageNumbers: true }))
    const source = textOf(bytes)
    expect(source.slice(0, 2)).toBe('PK')
    expect(source).toContain('[Content_Types].xml')
    expect(source).toContain('word/document.xml')
    expect(source).toContain('word/styles.xml')
    expect(source).toContain('word/header1.xml')
    expect(source).toContain('word/footer1.xml')
    expect(source).toContain('Draft')
    expect(source).toContain('Confidential')
    expect(source).toContain('PAGE')
    expect(source).toContain('A Study of &amp; &lt;Things&gt; &quot;here&quot;')
  })

  it('omits the page-number field when disabled and honors formatted references', () => {
    const bytes = renderDocx(PAPER, validateDocumentConfig({ pageNumbers: false }))
    const source = textOf(bytes)
    expect(source).not.toContain('PAGE')
    expect(source).toContain('Smith, J. (2020). A. S, 1(1), 2-3.')
  })

  it('renders a paper without title, abstract, or references', () => {
    const empty = renderDocx({ sections: [], citations: [], meta: {} }, validateDocumentConfig({}))
    expect(textOf(empty)).toContain('<w:body>')
  })
})

describe('renderDoc (RTF)', () => {
  it('emits RTF with header, footer, and a page-number field', () => {
    const source = textOf(renderDoc(PAPER, validateDocumentConfig({ headerText: 'Head', footerText: 'Foot', pageNumbers: true })))
    expect(source).toContain('\\rtf1\\ansi')
    expect(source).toContain('{\\header')
    expect(source).toContain('{\\footer')
    expect(source).toContain('\\chpgn')
    expect(source).toContain('Head')
    expect(source).toContain('Foot')
    expect(source).toContain('\\u20013?\\u25991?')
  })

  it('omits the page-number field and falls back to raw citations when disabled', () => {
    const source = textOf(renderDoc(PAPER, validateDocumentConfig({ pageNumbers: false })))
    expect(source).not.toContain('\\chpgn')
    // The second citation is emitted from its raw text, escaped for RTF.
    expect(source).toContain('\\u20013?\\u25991?')
  })

  it('renders a bare paper without title or sections', () => {
    const source = textOf(renderDoc({ sections: [], citations: [], meta: {} }, validateDocumentConfig({})))
    expect(source).toContain('\\rtf1')
  })
})

describe('buildZip', () => {
  it('archives multiple entries with a terminating central directory', () => {
    const archive = buildZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b.txt', data: new TextEncoder().encode('world') },
    ])
    const source = textOf(archive)
    expect(source.slice(0, 2)).toBe('PK')
    expect(source).toContain('a.txt')
    expect(source).toContain('b.txt')
  })
})
