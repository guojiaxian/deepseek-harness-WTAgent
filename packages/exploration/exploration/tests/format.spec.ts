import { describe, expect, it } from 'vitest'
import { csvToDataset, parseCsv } from '../src/format/csv.ts'
import { ingestData } from '../src/format/index.ts'
import { jsonToDataset } from '../src/format/json.ts'
import { decodeIbmFloat, parseSegY } from '../src/format/segy.ts'

function buildSegY(payload: Uint8Array, opts: {
  format: number
  samplesPerTrace: number
  sampleIntervalUs?: number
  revNumber?: number
  extHeaders?: number
}): Uint8Array {
  const ext = opts.extHeaders ?? 0
  const buf = new Uint8Array(3600 + ext * 3200 + payload.length)
  const view = new DataView(buf.buffer)
  view.setInt16(3216, opts.sampleIntervalUs ?? 2000, false)
  view.setInt16(3220, opts.samplesPerTrace, false)
  view.setInt16(3224, opts.format, false)
  view.setInt16(3500, opts.revNumber ?? 0x0100, false)
  view.setInt16(3504, ext, false)
  buf.set(payload, 3600 + ext * 3200)
  return buf
}

function tracePayload(traces: Array<{
  header?: (view: DataView, offset: number) => void
  samples: Uint8Array
}>): Uint8Array {
  const size = traces.reduce((sum, t) => sum + 240 + t.samples.length, 0)
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)
  let offset = 0
  for (const t of traces) {
    t.header?.(view, offset)
    buf.set(t.samples, offset + 240)
    offset += 240 + t.samples.length
  }
  return buf
}

function float32s(...values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4)
  const view = new DataView(buf.buffer)
  values.forEach((v, i) => { view.setFloat32(i * 4, v, false) })
  return buf
}

function u32s(...values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4)
  const view = new DataView(buf.buffer)
  values.forEach((v, i) => { view.setUint32(i * 4, v, false) })
  return buf
}

describe('parseCsv', () => {
  it('parses basic rows with a trailing newline dropped', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles quoted fields, escaped quotes, and multi-line fields', () => {
    expect(parseCsv('"a,b",c\n"x""y",z')).toEqual([['a,b', 'c'], ['x"y', 'z']])
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']])
  })

  it('handles CRLF and LF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles a bare carriage return without a following newline', () => {
    expect(parseCsv('a\rb')).toEqual([['a'], ['b']])
  })

  it('keeps empty fields and supports a custom delimiter', () => {
    expect(parseCsv('a,,b')).toEqual([['a', '', 'b']])
    expect(parseCsv('a;b', { delimiter: ';' })).toEqual([['a', 'b']])
  })

  it('trims unquoted fields when requested', () => {
    expect(parseCsv(' a , b ', { trim: true })).toEqual([['a', 'b']])
    expect(parseCsv(' a , b ', { trim: false })).toEqual([[' a ', ' b ']])
  })
})

describe('csvToDataset', () => {
  it('builds a header-driven dataset with inferred types', () => {
    const ds = csvToDataset([
      ['name', 'depth', 'active', 'when', 'note'],
      ['w1', '10', 'true', '2024-01-01', 'hi'],
      ['w2', '20.5', 'false', '2024-02-01T03:04:05Z', 'bye'],
    ])
    expect(ds.columns.map(c => [c.name, c.type])).toEqual([
      ['name', 'string'], ['depth', 'number'], ['active', 'boolean'],
      ['when', 'datetime'], ['note', 'string'],
    ])
    expect(ds.rows[0]).toEqual(['w1', 10, true, '2024-01-01', 'hi'])
    expect(ds.rows[1]).toEqual(['w2', 20.5, false, '2024-02-01T03:04:05Z', 'bye'])
  })

  it('generates column_i names for missing headers and pads ragged rows', () => {
    const ds = csvToDataset([['', 'a'], ['x', 'y', 'z']])
    expect(ds.columns.map(c => c.name)).toEqual(['column_0', 'a', 'column_2'])
    expect(ds.rows[0]).toEqual(['x', 'y', 'z'])
  })

  it('deduplicates repeated header names with suffixes', () => {
    const ds = csvToDataset([['a', 'a', 'a'], ['1', '2', '3']])
    expect(ds.columns.map(c => c.name)).toEqual(['a', 'a_2', 'a_3'])
  })

  it('supports header-less rows and disables type inference', () => {
    const ds = csvToDataset([['1', '2'], ['3', '4']], { hasHeader: false })
    expect(ds.columns.map(c => c.name)).toEqual(['column_0', 'column_1'])
    expect(ds.columns[0]?.type).toBe('number')

    const raw = csvToDataset([['a'], ['1']], { inferTypes: false })
    expect(raw.columns[0]?.type).toBe('unknown')
    expect(raw.rows[0]).toEqual(['1'])
  })

  it('turns empty cells into null and an all-empty column into unknown', () => {
    const ds = csvToDataset([['a', 'b'], ['1', '']])
    expect(ds.rows[0]).toEqual([1, null])
    const empty = csvToDataset([['a'], ['']])
    expect(empty.columns[0]?.type).toBe('unknown')
  })
})

describe('jsonToDataset', () => {
  it('builds a dataset from an array of row objects', () => {
    const ds = jsonToDataset([{ a: 1, b: 'x' }, { a: 2, b: null }])
    expect(ds.columns.map(c => [c.name, c.type])).toEqual([['a', 'number'], ['b', 'string']])
    expect(ds.rows).toEqual([[1, 'x'], [2, null]])
  })

  it('infers boolean and unknown types and pads missing keys with null', () => {
    const ds = jsonToDataset([{ a: true }, { a: false, b: 1 }])
    expect(ds.columns.map(c => [c.name, c.type])).toEqual([['a', 'boolean'], ['b', 'number']])
    expect(ds.rows).toEqual([[true, null], [false, 1]])

    const empty = jsonToDataset([{ a: null }])
    expect(empty.columns[0]?.type).toBe('unknown')
  })

  it('passes a dataset-shaped object through with a guaranteed meta', () => {
    const ds = jsonToDataset({ columns: [{ name: 'a', type: 'number' }], rows: [[1]], meta: { src: 'x' } })
    expect(ds.columns).toEqual([{ name: 'a', type: 'number' }])
    expect(ds.rows).toEqual([[1]])
    expect(ds.meta).toEqual({ src: 'x' })
    expect(jsonToDataset({ columns: [{ name: 'a' }], rows: [[1]] }).meta).toEqual({})
  })

  it('rejects malformed values', () => {
    expect(() => jsonToDataset(42)).toThrow(/must be a dataset object/)
    expect(() => jsonToDataset([1, 2])).toThrow(/rows must be objects/)
    expect(() => jsonToDataset([{ a: {} }])).toThrow(/must be null, number, string, or boolean/)
    expect(() => jsonToDataset({ columns: [1], rows: [[]] })).toThrow(/columns must be objects/)
    expect(() => jsonToDataset({ columns: [{ name: 'a' }], rows: [1] })).toThrow(/rows must be arrays/)
    expect(() => jsonToDataset({ columns: [{ name: 'a' }], rows: [[{}]] })).toThrow(/cells must be/)
  })
})

describe('decodeIbmFloat', () => {
  it('decodes exact IBM float values', () => {
    expect(decodeIbmFloat(0x41100000)).toBe(1)
    expect(decodeIbmFloat(0x41200000)).toBe(2)
    expect(decodeIbmFloat(0xC1C80000)).toBe(-12.5)
  })

  it('handles zero, underflow, and overflow', () => {
    expect(decodeIbmFloat(0x00000000)).toBe(0)
    expect(Object.is(decodeIbmFloat(0x80000000), -0)).toBe(true)
    expect(decodeIbmFloat(0x00400000)).toBe(0)
    expect(Object.is(decodeIbmFloat(0x80400000), -0)).toBe(true)
    expect(decodeIbmFloat(0x7F400000)).toBe(Infinity)
    expect(decodeIbmFloat(0xFF400000)).toBe(-Infinity)
  })
})

describe('parseSegY', () => {
  const formatCases: Array<{ format: number; bytes: Uint8Array; expected: number }> = [
    { format: 1, bytes: u32s(0x41100000), expected: 1 },
    { format: 2, bytes: u32s(0x00000100), expected: 256 },
    { format: 3, bytes: Uint8Array.from([0x01, 0x02]), expected: 258 },
    { format: 5, bytes: float32s(1.5), expected: 1.5 },
    { format: 6, bytes: float64(2.25), expected: 2.25 },
    { format: 7, bytes: Uint8Array.from([0x01, 0x02, 0x03]), expected: 66051 },
    { format: 8, bytes: Uint8Array.from([0xFE]), expected: -2 },
    { format: 9, bytes: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1]), expected: 1 },
    { format: 10, bytes: u32s(0xFFFFFFF0), expected: 4294967280 },
    { format: 11, bytes: Uint8Array.from([0xFF, 0xF0]), expected: 65520 },
    { format: 12, bytes: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 2]), expected: 2 },
    { format: 15, bytes: Uint8Array.from([0xFF, 0xFF, 0xFF]), expected: 16777215 },
    { format: 16, bytes: Uint8Array.from([0xFD]), expected: 253 },
  ]

  it.each(formatCases)('decodes sample format $format', ({ format, bytes, expected }) => {
    const file = buildSegY(tracePayload([{ samples: bytes }]), { format, samplesPerTrace: 1 })
    const ds = parseSegY(file)
    expect(ds.rows[0]?.[2]).toBe(expected)
  })

  it('sign-extends 24-bit and 8-bit signed integers', () => {
    const int24 = buildSegY(tracePayload([{ samples: Uint8Array.from([0x80, 0, 0]) }]), { format: 7, samplesPerTrace: 1 })
    expect(parseSegY(int24).rows[0]?.[2]).toBe(-8388608)
    const int8 = buildSegY(tracePayload([{ samples: Uint8Array.from([0x80]) }]), { format: 8, samplesPerTrace: 1 })
    expect(parseSegY(int8).rows[0]?.[2]).toBe(-128)
  })

  it('reads geometry and header fields in long format', () => {
    const file = buildSegY(tracePayload([{
      header: (view, o) => {
        view.setInt32(o + 8, 7, false)
        view.setInt32(o + 12, 3, false)
        view.setInt16(o + 28, 1, false)
        view.setInt32(o + 180, 100, false)
        view.setInt32(o + 184, 200, false)
        view.setInt32(o + 188, 5, false)
        view.setInt32(o + 192, 6, false)
      },
      samples: float32s(1, 2),
    }]), { format: 5, samplesPerTrace: 2 })
    const ds = parseSegY(file)
    expect(ds.columns.map(c => c.name)).toEqual([
      'trace', 'sampleIndex', 'value', 'x', 'y', 'inline', 'crossline',
      'fieldRecord', 'traceInRecord', 'traceId',
    ])
    expect(ds.rows).toEqual([
      [0, 0, 1, 100, 200, 5, 6, 7, 3, 1],
      [0, 1, 2, 100, 200, 5, 6, 7, 3, 1],
    ])
    expect(ds.meta).toMatchObject({
      sampleIntervalUs: 2000,
      sampleFormat: 5,
      sampleFormatName: 'IEEE float32',
      traceCount: 1,
      revNumber: 0x0100,
      extHeaderCount: 0,
      textHeaderEncoding: 'ascii',
    })
  })

  it('emits short format with one sample column per sample', () => {
    const file = buildSegY(tracePayload([{ samples: float32s(1, 2) }]), { format: 5, samplesPerTrace: 2 })
    const ds = parseSegY(file, { longFormat: false })
    expect(ds.columns.map(c => c.name)).toEqual(['trace', 'sample_0', 'sample_1'])
    expect(ds.rows[0]).toEqual([0, 1, 2])
  })

  it('respects sampleLimit in both formats', () => {
    const file = buildSegY(tracePayload([{ samples: float32s(1, 2, 3, 4) }]), { format: 5, samplesPerTrace: 4 })
    const short = parseSegY(file, { longFormat: false, sampleLimit: 2 })
    expect(short.columns.map(c => c.name)).toEqual(['trace', 'sample_0', 'sample_1'])
    expect(short.rows[0]).toEqual([0, 1, 2])

    const long = parseSegY(file, { sampleLimit: 2 })
    expect(long.rows).toHaveLength(2)
    expect(long.rows[1]?.[1]).toBe(1)
  })

  it('reads an EBCDIC text header', () => {
    const file = buildSegY(tracePayload([{ samples: float32s(1) }]), { format: 5, samplesPerTrace: 1 })
    file[0] = 0xC1
    file[1] = 0xC2
    const ds = parseSegY(file)
    expect(ds.meta.textHeaderEncoding).toBe('ebcdic')
    expect(ds.meta.textHeader).toMatch(/^AB/)
  })

  it('skips extended text headers', () => {
    const file = buildSegY(tracePayload([{ samples: float32s(1) }]), { format: 5, samplesPerTrace: 1, extHeaders: 1 })
    const ds = parseSegY(file)
    expect(ds.meta.extHeaderCount).toBe(1)
    expect(ds.rows[0]?.[2]).toBe(1)
  })

  it('parses multiple traces', () => {
    const payload = tracePayload([
      { samples: float32s(1) },
      { samples: float32s(2) },
    ])
    const file = buildSegY(payload, { format: 5, samplesPerTrace: 1 })
    const ds = parseSegY(file)
    expect(ds.meta.traceCount).toBe(2)
    expect(ds.rows.map(row => row[0])).toEqual([0, 1])
  })

  it('rejects short files, unknown formats, empty traces, and truncated traces', () => {
    expect(() => parseSegY(new Uint8Array(100))).toThrow(/too short/)
    expect(() => parseSegY(buildSegY(new Uint8Array(0), { format: 4, samplesPerTrace: 1 })))
      .toThrow(/unsupported SEG-Y sample format 4/)
    expect(() => parseSegY(buildSegY(new Uint8Array(0), { format: 5, samplesPerTrace: 0 }))).toThrow(/declares no samples/)
    const truncated = buildSegY(new Uint8Array(242), { format: 5, samplesPerTrace: 1 })
    expect(() => parseSegY(truncated)).toThrow(/truncated trace/)
  })
})

describe('ingestData', () => {
  it('dispatches csv, json, and segy input', () => {
    const csv = ingestData({ format: 'csv', data: 'a,b\n1,2', source: 'inline' }, {})
    expect(csv.rows).toEqual([[1, 2]])

    const json = ingestData({ format: 'JSON', data: new TextEncoder().encode('[{"a":1}]') }, {})
    expect(json.rows).toEqual([[1]])

    const segy = buildSegY(tracePayload([{ samples: float32s(1) }]), { format: 5, samplesPerTrace: 1 })
    const segyDs = ingestData({ format: 'segy', data: segy }, {})
    expect(segyDs.rows[0]?.[2]).toBe(1)
  })

  it('passes ingest options through to the format readers', () => {
    const csv = ingestData({ format: 'csv', data: 'a;b\n1;2' }, { delimiter: ';', trim: true })
    expect(csv.columns.map(c => c.name)).toEqual(['a', 'b'])
  })

  it('forwards csv dataset options and segy parse limits', () => {
    const csv = ingestData({ format: 'csv', data: 'a,b\n1,2' }, { hasHeader: false, inferTypes: false })
    expect(csv.columns.map(c => c.name)).toEqual(['column_0', 'column_1'])
    expect(csv.columns[0]?.type).toBe('unknown')

    const segy = buildSegY(tracePayload([{ samples: float32s(1, 2) }]), { format: 5, samplesPerTrace: 2 })
    const short = ingestData({ format: 'segy', data: segy }, { longFormat: false, sampleLimit: 1 })
    expect(short.columns.map(c => c.name)).toEqual(['trace', 'sample_0'])
    expect(short.rows[0]).toEqual([0, 1])
  })

  it('rejects unknown formats, string SEG-Y, and invalid JSON', () => {
    expect(() => ingestData({ format: 'xml', data: 'x' }, {})).toThrow(/unsupported input format/)
    expect(() => ingestData({ format: 'segy', data: 'nope' }, {})).toThrow(/must be raw bytes/)
    expect(() => ingestData({ format: 'json', data: 'not json' }, {})).toThrow(/invalid JSON/)
  })
})

function float64(value: number): Uint8Array {
  const buf = new Uint8Array(8)
  new DataView(buf.buffer).setFloat64(0, value, false)
  return buf
}
