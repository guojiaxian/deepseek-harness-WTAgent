import { describe, expect, it } from 'vitest'
import { checksumBytes, checksumText } from '../src/checksum.ts'
import { BiddingError } from '../src/errors.ts'
import { DEFAULT_LIMITS, resolveLimits } from '../src/types.ts'
import { SHIPPED_TEMPLATES } from '../src/templates/index.ts'
import { normalizeCategory, parseMaterial } from '../src/processors/material.ts'
import { parseTemplate } from '../src/processors/template.ts'
import { DEFAULT_COMPARE_THRESHOLDS, tokenize } from '../src/processors/compare.ts'
import {
  asArray, asBoolean, asEnum, asNumber, asObject, asOptionalNumber, asOptionalString, asString, checkKeys,
} from '../src/validate.ts'

describe('BiddingError', () => {
  it('carries a stable code and optional details', () => {
    const error = new BiddingError('boom', { code: 'PARSE_ERROR' })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BiddingError')
    expect(error.message).toBe('boom')
    expect(error.code).toBe('PARSE_ERROR')
    expect(error.details).toBeUndefined()
  })

  it('assigns details only when present', () => {
    const error = new BiddingError('boom', { code: 'LIMIT_EXCEEDED', details: { cap: 3 } })
    expect(error.details).toEqual({ cap: 3 })
  })
})

describe('checksum', () => {
  it('hashes bytes and text deterministically', () => {
    const bytes = new TextEncoder().encode('abc')
    expect(checksumBytes(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(checksumText('abc')).toBe(checksumBytes(bytes))
    expect(checksumText('abc')).toBe(checksumText('abc'))
  })
})

describe('limits', () => {
  it('resolves a partial over the defaults', () => {
    const resolved = resolveLimits({ maxSections: 10 })
    expect(resolved.maxSections).toBe(10)
    expect(resolved.maxInputBytes).toBe(DEFAULT_LIMITS.maxInputBytes)
  })

  it('defaults are the documented resource caps', () => {
    expect(DEFAULT_LIMITS.maxInputBytes).toBe(32 * 1024 * 1024)
    expect(DEFAULT_LIMITS.maxMaterials).toBe(5000)
    expect(DEFAULT_LIMITS.maxOutputBytes).toBe(16 * 1024 * 1024)
  })
})

describe('validate helpers', () => {
  it('asObject coerces undefined and rejects non-objects', () => {
    expect(asObject(undefined, 'x')).toEqual({})
    expect(asObject({}, 'x')).toEqual({})
    expect(() => asObject(null, 'x')).toThrow(BiddingError)
    expect(() => asObject([], 'x')).toThrow(BiddingError)
    expect(() => asObject(3, 'x')).toThrow(/must be an object/)
  })

  it('checkKeys rejects unknown keys', () => {
    expect(() => { checkKeys({ a: 1, b: 2 }, ['a'], 'cfg') }).toThrow(/unknown cfg option "b"/)
    expect(() => { checkKeys({ a: 1 }, ['a', 'b'], 'cfg') }).not.toThrow()
  })

  it('asBoolean / asNumber / asString / asArray narrow or throw', () => {
    expect(asBoolean(true, 'b')).toBe(true)
    expect(() => asBoolean(1, 'b')).toThrow(/must be a boolean/)
    expect(asNumber(1.5, 'n')).toBe(1.5)
    expect(() => asNumber(Number.NaN, 'n')).toThrow(/must be a finite number/)
    expect(asString(' x ', 's')).toBe(' x ')
    expect(() => asString('  ', 's')).toThrow(/must be a non-empty string/)
    expect(asArray([1], 'a')).toEqual([1])
    expect(() => asArray('a', 'a')).toThrow(/must be an array/)
  })

  it('asEnum matches one of the literals', () => {
    expect(asEnum('b', ['a', 'b'], 'e')).toBe('b')
    expect(() => asEnum('c', ['a', 'b'], 'e')).toThrow(/must be one of a, b/)
  })

  it('optional helpers accept undefined and reject empties', () => {
    expect(asOptionalString(undefined, 's')).toBeUndefined()
    expect(asOptionalString('v', 's')).toBe('v')
    expect(() => asOptionalString('', 's')).toThrow(/non-empty/)
    expect(asOptionalNumber(undefined, 'n')).toBeUndefined()
    expect(asOptionalNumber(2, 'n')).toBe(2)
    expect(() => asOptionalNumber('x', 'n')).toThrow(/finite number/)
  })
})

describe('shipped templates', () => {
  it('registers the four built-in skeletons with unique kebab ids', () => {
    expect(SHIPPED_TEMPLATES.map(template => template.id)).toEqual([
      'government-procurement', 'engineering', 'goods', 'services',
    ])
    for (const template of SHIPPED_TEMPLATES) {
      expect(template.chapters.length).toBeGreaterThan(3)
      expect(template.chapters.some(chapter => chapter.required)).toBe(true)
      for (const chapter of template.chapters) {
        expect(chapter.level).toBeGreaterThanOrEqual(1)
        expect(chapter.level).toBeLessThanOrEqual(4)
      }
    }
  })
})

describe('parseTemplate', () => {
  it('validates a complete template object', () => {
    const template = parseTemplate({
      id: 'custom-t',
      name: '自定义',
      category: 'custom',
      chapters: [
        { id: 'c1', level: 1, title: '第一章', required: true, materialCategories: ['Qual'] },
        { id: 'c2', level: 2, title: '第二章', required: false },
      ],
    }, 'custom-t.json')
    expect(template.id).toBe('custom-t')
    expect(template.chapters[0]!.materialCategories).toEqual(['qual'])
  })

  it('defaults optional fields and trims long text', () => {
    const template = parseTemplate({
      id: 't2', name: 'n', chapters: [{ id: 'c', level: 1, title: 'x'.repeat(200), requirements: 'r'.repeat(2000) }],
    }, 't2.json')
    expect(template.category).toBe('custom')
    expect(template.chapters[0]!.required).toBe(true)
    expect(template.chapters[0]!.title).toHaveLength(80)
    expect(template.chapters[0]!.requirements).toHaveLength(1000)
  })

  it('rejects malformed ids, levels, duplicate chapters, and empty trees', () => {
    expect(() => parseTemplate({ id: 'Bad_Id', name: 'n', chapters: [] }, 'f.json')).toThrow(/id/)
    expect(() => parseTemplate({ id: 'ok', name: 'n', chapters: [] }, 'f.json')).toThrow(/no chapters/)
    expect(() => parseTemplate({ id: 'ok', name: 'n', chapters: [{ id: 'c', level: 9, title: 't' }] }, 'f.json')).toThrow(/level/)
    expect(() => parseTemplate({ id: 'ok', name: 'n', chapters: [{ id: 'c', level: 1, title: 't' }, { id: 'c', level: 1, title: 't' }] }, 'f.json')).toThrow(/duplicate/)
    expect(() => parseTemplate({ id: 'ok', name: 'n' }, 'f.json')).toThrow(/chapters/)
  })
})

describe('parseMaterial', () => {
  it('validates a stored material file', () => {
    const material = parseMaterial({
      id: 'm-0123456789abcdef',
      category: 'company-qualification',
      title: '资质',
      content: '内容',
      tags: ['资质'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, 'm-0123456789abcdef.json')
    expect(material.tags).toEqual(['资质'])
  })

  it('rejects malformed ids and missing fields', () => {
    expect(() => parseMaterial({ id: 'x' }, 'f.json')).toThrow(/id/)
    expect(() => parseMaterial({ id: 'm-0123456789abcdef' }, 'f.json')).toThrow(/category/)
  })
})

describe('material helpers', () => {
  it('normalizes categories to kebab-case', () => {
    expect(normalizeCategory('Company Qualification')).toBe('company-qualification')
    expect(normalizeCategory('资质文件')).toBe('资质文件')
    expect(normalizeCategory('  A--B  ')).toBe('a-b')
    expect(normalizeCategory('***')).toBe('')
  })
})

describe('compare helpers', () => {
  it('tokenizes domain terms, latin words, and CJK bigrams', () => {
    const tokens = tokenize('提供技术方案与售后服务，SLA响应时间 30 分钟')
    expect(tokens).toContain('技术方案')
    expect(tokens).toContain('售后服务')
    expect(tokens).toContain('sla')
    expect(tokens.some(token => token.startsWith('响'))).toBe(true)
  })

  it('keeps single CJK runs as single tokens', () => {
    expect(tokenize('证')).toEqual(['证'])
  })

  it('exposes tunable default thresholds', () => {
    expect(DEFAULT_COMPARE_THRESHOLDS.coveredRatio).toBe(0.5)
    expect(DEFAULT_COMPARE_THRESHOLDS.partialRatio).toBe(0.2)
    expect(DEFAULT_COMPARE_THRESHOLDS.minTokens).toBe(3)
  })
})
