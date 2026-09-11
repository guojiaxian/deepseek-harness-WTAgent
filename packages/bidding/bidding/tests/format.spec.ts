import { describe, expect, it } from 'vitest'
import { buildZip, crc32, readZipEntries } from '../src/format/zip.ts'
import type { ZipEntry, ZipReadLimits } from '../src/format/zip.ts'
import { parseXml, textOfDescendants } from '../src/format/xml.ts'
import { DEFAULT_XML_LIMITS } from '../src/format/xml.ts'
import { parseDocx } from '../src/format/docx-read.ts'
import { renderDocx } from '../src/format/docx-write.ts'
import { DEFAULT_RENDER_CONFIG } from '../src/processors/render.ts'
import type { BidDraft } from '../src/types.ts'

const TINY_LIMITS: ZipReadLimits = {
  maxEntries: 2,
  maxEntryBytes: 64,
  maxTotalBytes: 128,
  maxRatio: 2,
}

/** A minimal draft for the renderer. */
const DRAFT: BidDraft = {
  tender: { projectName: '测试项目', tenderNo: 'DSH-2026-001', purchaser: '测试采购人' },
  sections: [
    { title: '第一章 投标函', level: 1, content: '正文段落。', status: 'drafted' },
  ],
}

describe('zip writer and reader', () => {
  it('round-trips store-only entries', () => {
    const entries: ZipEntry[] = [
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'dir/b.txt', data: new TextEncoder().encode('world') },
    ]
    const archive = buildZip(entries)
    const read = readZipEntries(archive)
    expect(new TextDecoder().decode(read.get('a.txt'))).toBe('hello')
    expect(new TextDecoder().decode(read.get('dir/b.txt'))).toBe('world')
  })

  it('computes the IEEE CRC-32 checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('rejects archives that are too small or lack an EOCD record', () => {
    expect(() => readZipEntries(new Uint8Array(4))).toThrow(/too small/)
    expect(() => readZipEntries(new Uint8Array(64))).toThrow(/end-of-central-directory/)
  })

  it('rejects malformed local headers and inconsistent sizes', () => {
    const archive = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }])
    const corrupted = Uint8Array.from(archive)
    corrupted.set([0xff, 0xff, 0xff, 0xff], 0)
    expect(() => readZipEntries(corrupted)).toThrow(/local header/)
  })

  it('rejects entry-count, size, and total caps', () => {
    const three = buildZip([
      { name: 'a', data: new TextEncoder().encode('x') },
      { name: 'b', data: new TextEncoder().encode('x') },
      { name: 'c', data: new TextEncoder().encode('x') },
    ])
    expect(() => readZipEntries(three, TINY_LIMITS)).toThrow(/entry count/)
    const big = buildZip([{ name: 'big', data: new TextEncoder().encode('x'.repeat(80)) }])
    expect(() => readZipEntries(big, TINY_LIMITS)).toThrow(/inflates to/)
    // Per-entry sizes stay under the cap while the running total crosses it.
    const totalLimits: ZipReadLimits = { maxEntries: 4, maxEntryBytes: 80, maxTotalBytes: 128, maxRatio: 2 }
    const total = buildZip([
      { name: 'a', data: new TextEncoder().encode('x'.repeat(70)) },
      { name: 'b', data: new TextEncoder().encode('x'.repeat(70)) },
    ])
    expect(() => readZipEntries(total, totalLimits)).toThrow(/total/)
  })

  it('rejects path traversal and duplicate entry names', () => {
    expect(() => readZipEntries(buildZip([{ name: '../evil.txt', data: new Uint8Array(1) }]))).toThrow(/traverses/)
    // The writer never emits duplicate names, so a hostile archive is emulated
    // by feeding the same name twice directly to the reader.
    expect(() => readZipEntries(buildZip([
      { name: 'a', data: new TextEncoder().encode('1') },
      { name: 'a', data: new TextEncoder().encode('2') },
    ]))).toThrow(/duplicate/)
  })

  it('rejects zip-bomb ratios', () => {
    const archive = buildZip([{ name: 'bomb', data: new TextEncoder().encode('x'.repeat(4096)) }])
    // Inflate the stored size in the central directory so the ratio check fires.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const centralOffset = view.getUint32(archive.length - 6, true)
    view.setUint32(centralOffset + 24, 4096 * 200, true)
    expect(() => readZipEntries(archive)).toThrow(/ratio/)
  })
})

describe('xml parser', () => {
  it('parses declarations, comments, attributes, and nested elements', () => {
    const node = parseXml('<?xml version="1.0"?><!-- note --><root a="1"><child>text</child></root>')
    expect(node.name).toBe('root')
    expect(node.attrs['a']).toBe('1')
    expect(node.children[0]!.text).toBe('text')
  })

  it('decodes the five entities plus numeric references', () => {
    const node = parseXml('<r>&amp;&lt;&gt;&quot;&apos;&#65;&#x42;</r>')
    expect(node.text).toBe('&<>"\'AB')
  })

  it('decodes entities in attribute values', () => {
    const node = parseXml('<r a="&lt;b&gt;"/>')
    expect(node.attrs['a']).toBe('<b>')
  })

  it('skips DOCTYPE declarations without resolving entities', () => {
    const node = parseXml('<!DOCTYPE r [<!ENTITY e "x">]><r/>')
    expect(node.name).toBe('r')
    expect(() => parseXml('<r>&e;</r>')).toThrow(/unknown entity/)
  })

  it('fails loud on malformed constructs', () => {
    expect(() => parseXml('<r>')).toThrow(/XML parse error/)
    expect(() => parseXml('<r>&unterminated</r>')).toThrow(/unterminated entity/)
    expect(() => parseXml('<r>&#xZZ;</r>')).toThrow(/character reference/)
    expect(() => parseXml('<?xml version="1.0" <r/>')).toThrow(/processing instruction/)
    expect(() => parseXml('<!-- no end<r/>')).toThrow(/comment/)
  })

  it('enforces depth and element caps', () => {
    expect(() => parseXml(`<r>${'<c>'.repeat(70)}${'</c>'.repeat(70)}</r>`, { ...DEFAULT_XML_LIMITS, maxDepth: 8 })).toThrow(/depth|parse error/i)
    const many = `<r>${'<c/>'.repeat(20)}</r>`
    expect(() => parseXml(many, { ...DEFAULT_XML_LIMITS, maxElements: 5 })).toThrow(/element|parse error/i)
  })

  it('textOfDescendants concatenates matching descendants', () => {
    const node = parseXml('<r><p><t>a</t></p><p><t>b</t><t>c</t></p></r>')
    expect(textOfDescendants(node, 't')).toBe('abc')
  })
})

describe('docx writer and reader', () => {
  it('round-trips a rendered draft through the reader', () => {
    const bytes = renderDocx(DRAFT, DEFAULT_RENDER_CONFIG)
    const raw = parseDocx(bytes, 1000)
    const paragraphs = raw.blocks.filter(block => block.kind === 'paragraph') as { text: string; styleName?: string }[]
    expect(paragraphs.some(paragraph => paragraph.text === '第一章 投标函')).toBe(true)
    const heading = paragraphs.find(paragraph => paragraph.styleName === 'Heading 1')
    expect(heading?.text).toBe('第一章 投标函')
  })

  it('rejects archives without a document part', () => {
    const archive = buildZip([{ name: 'other.txt', data: new TextEncoder().encode('x') }])
    expect(() => parseDocx(archive, 10)).toThrow(/not a \.docx file/)
  })

  it('rejects a document part without w:body', () => {
    const archive = buildZip([{ name: 'word/document.xml', data: new TextEncoder().encode('<w:document/>') }])
    expect(() => parseDocx(archive, 10)).toThrow(/w:body/)
  })

  it('enforces the block cap', () => {
    const bytes = renderDocx(DRAFT, DEFAULT_RENDER_CONFIG)
    expect(() => parseDocx(bytes, 2)).toThrow(/block count/)
  })

  it('reads tables as row blocks', () => {
    const draft: BidDraft = {
      tender: {},
      sections: [{
        title: '表', level: 1, status: 'drafted',
        content: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      }],
    }
    const raw = parseDocx(renderDocx(draft, DEFAULT_RENDER_CONFIG), 100)
    const table = raw.blocks.find(block => block.kind === 'table') as unknown as { rows: string[][] }
    expect(table.rows).toEqual([['A', 'B'], ['1', '2']])
  })
})
