import { describe, expect, it } from 'vitest'
import * as clean from '../src/processors/clean.ts'
import * as convert from '../src/processors/convert.ts'
import * as detect from '../src/processors/detect.ts'
import * as extract from '../src/processors/extract.ts'
import * as ingest from '../src/processors/ingest.ts'
import { runStep, validateStep } from '../src/processors/index.ts'
import type { CellType, CellValue, Dataset, Limits, PipelineStep, StepType } from '../src/types.ts'

const LIMITS: Limits = { maxInputBytes: 1_000_000, maxRows: 1000, maxColumns: 100, maxAnomalyRecords: 500 }

function ds(columns: Array<{ name: string; type?: CellType; unit?: string }>, rows: unknown[][]): Dataset {
  return {
    columns: columns.map(c => ({
      name: c.name,
      type: c.type ?? 'number',
      ...(c.unit === undefined ? {} : { unit: c.unit }),
    })),
    rows: rows as CellValue[][],
    meta: {},
  }
}

describe('ingest processor', () => {
  it('validates options and rejects misconfiguration', () => {
    expect(ingest.validate(undefined)).toEqual({})
    expect(ingest.validate({})).toEqual({})
    expect(ingest.validate({ delimiter: ';', hasHeader: false, trim: true, inferTypes: false, longFormat: false, sampleLimit: 3 }))
      .toEqual({ delimiter: ';', hasHeader: false, trim: true, inferTypes: false, longFormat: false, sampleLimit: 3 })
    expect(() => ingest.validate({ delimiter: ';;' })).toThrow(/single character/)
    expect(() => ingest.validate({ sampleLimit: 0 })).toThrow(/positive integer/)
    expect(() => ingest.validate({ nope: true })).toThrow(/unknown ingest option/)
  })

  it('enforces the byte budget and stamps provenance', () => {
    const tight = { ...LIMITS, maxInputBytes: 5 }
    expect(() => ingest.run({ format: 'csv', data: 'a,b\n1,2' }, {}, tight)).toThrow(/exceeds the 5-byte limit/)

    const result = ingest.run({ format: 'csv', data: 'a,b\n1,2', source: 'f.csv' }, {}, LIMITS)
    expect(result.dataset.meta.source).toBe('f.csv')
    expect(result.dataset.meta.rowCount).toBe(1)
    expect(result.notes[0]).toContain('ingested f.csv as csv')

    const inline = ingest.run({ format: 'csv', data: 'a\n1' }, {}, LIMITS)
    expect(inline.notes[0]).toContain('ingested inline as csv')
  })

  it('sizes byte input and keeps a json-provided source label', () => {
    const bytes = ingest.run({ format: 'csv', data: new TextEncoder().encode('a\n1'), source: 'b.csv' }, {}, LIMITS)
    expect(bytes.dataset.meta.source).toBe('b.csv')
    expect(bytes.dataset.rows).toEqual([[1]])

    const json = ingest.run(
      { format: 'json', data: JSON.stringify({ columns: [{ name: 'a', type: 'number' }], rows: [[1]], meta: { source: 'json-src' } }) },
      {},
      LIMITS,
    )
    expect(json.dataset.meta.source).toBe('json-src')
    expect(json.notes[0]).toContain('ingested json-src as json')
  })
})

describe('clean processor', () => {
  it('validates every option', () => {
    const config = clean.validate({
      missing: { action: 'fill', value: 0 },
      ranges: [{ column: 'd', min: 0, max: 10, action: 'clamp' }],
      dedupe: { columns: ['a'] },
      dropColumns: ['x'],
      renameColumns: [{ from: 'a', to: 'b' }],
      trimStrings: true,
      columnTypes: [{ column: 'a', type: 'number' }],
    })
    expect(config.missing).toEqual({ action: 'fill', value: 0 })
    expect(config.dedupe).toEqual({ columns: ['a'] })
    expect(() => clean.validate({ missing: { action: 'fill' } })).toThrow(/requires `value`/)
    expect(() => clean.validate({ missing: { action: 'fill', value: {} } })).toThrow(/number, string, or boolean/)
    expect(() => clean.validate({ ranges: [{ column: 'd', action: 'clamp' }] })).toThrow(/requires "min" or "max"/)
    expect(() => clean.validate({ ranges: [{ column: 'd', min: 5, max: 1, action: 'clamp' }] })).toThrow(/must not exceed max/)
    expect(() => clean.validate({ dedupe: { nope: 1 } })).toThrow(/unknown clean.dedupe option/)
    expect(() => clean.validate({ columnTypes: [{ column: 'a', type: 'date' }] })).toThrow(/must be one of/)
  })

  it('validates sparse configs and validation helpers fail loud', () => {
    expect(clean.validate(undefined)).toEqual({})
    expect(clean.validate({ missing: { action: 'drop' } })).toEqual({ missing: { action: 'drop' } })
    expect(clean.validate({ dedupe: {} })).toEqual({ dedupe: {} })
    expect(clean.validate({ ranges: [{ column: 'd', max: 8, action: 'clamp' }] }))
      .toEqual({ ranges: [{ column: 'd', max: 8, action: 'clamp' }] })
    expect(clean.validate({ ranges: [{ column: 'd', min: 2, action: 'clamp' }] }))
      .toEqual({ ranges: [{ column: 'd', min: 2, action: 'clamp' }] })
    expect(() => clean.validate({ trimStrings: 'yes' })).toThrow(/must be a boolean/)
    expect(() => clean.validate({ ranges: [{ column: 'd', min: 'x', action: 'clamp' }] })).toThrow(/finite number/)
    expect(() => clean.validate({ dropColumns: 'a' })).toThrow(/must be an array/)
  })

  it('drops and renames columns', () => {
    const dropped = clean.run(ds([{ name: 'a' }, { name: 'b' }, { name: 'c' }], [[1, 2, 3]]), { dropColumns: ['b'] })
    expect(dropped.dataset.columns.map(c => c.name)).toEqual(['a', 'c'])
    expect(dropped.dataset.rows[0]).toEqual([1, 3])
    expect(dropped.notes[0]).toContain('dropped columns: b')
    expect(() => clean.run(ds([{ name: 'a' }], [[1]]), { dropColumns: ['z'] })).toThrow(/unknown column "z"/)

    const renamed = clean.run(ds([{ name: 'a' }], [[1]]), { renameColumns: [{ from: 'a', to: 'alpha' }] })
    expect(renamed.dataset.columns[0]?.name).toBe('alpha')
    expect(renamed.notes[0]).toContain('renamed columns: a→alpha')
    expect(() => clean.run(ds([{ name: 'a' }], [[1]]), { renameColumns: [{ from: 'a', to: 'x' }, { from: 'a', to: 'y' }] }))
      .toThrow(/duplicate rename/)
    expect(() => clean.run(ds([{ name: 'a' }, { name: 'b' }], [[1, 2]]), { renameColumns: [{ from: 'a', to: 'b' }] }))
      .toThrow(/duplicate column/)
  })

  it('coerces column types and fails loud on impossible conversions', () => {
    const numbers = clean.run(ds([{ name: 'a', type: 'string' }], [['1'], ['2']]), { columnTypes: [{ column: 'a', type: 'number' }] })
    expect(numbers.dataset.columns[0]?.type).toBe('number')
    expect(numbers.dataset.rows).toEqual([[1], [2]])

    const booleans = clean.run(ds([{ name: 'a' }], [[0], [1]]), { columnTypes: [{ column: 'a', type: 'boolean' }] })
    expect(booleans.dataset.rows).toEqual([[false], [true]])

    const fromBool = clean.run(ds([{ name: 'a', type: 'boolean' }], [[true], [false]]), { columnTypes: [{ column: 'a', type: 'number' }] })
    expect(fromBool.dataset.rows).toEqual([[1], [0]])

    const strings = clean.run(ds([{ name: 'a' }], [[1], [2]]), { columnTypes: [{ column: 'a', type: 'string' }] })
    expect(strings.dataset.rows).toEqual([['1'], ['2']])

    expect(() => clean.run(ds([{ name: 'a', type: 'string' }], [['abc']]), { columnTypes: [{ column: 'a', type: 'number' }] }))
      .toThrow(/cannot coerce "abc" to number/)
    expect(() => clean.run(ds([{ name: 'a', type: 'string' }], [['maybe']]), { columnTypes: [{ column: 'a', type: 'boolean' }] }))
      .toThrow(/cannot coerce "maybe" to boolean/)
  })

  it('handles missing-value policies', () => {
    const base = ds([{ name: 'a' }], [[1], [null], [3]])
    const dropped = clean.run(base, { missing: { action: 'drop' } })
    expect(dropped.dataset.rows).toEqual([[1], [3]])
    expect(dropped.notes[0]).toContain('dropped 1 rows with missing values')

    const filled = clean.run(base, { missing: { action: 'fill', value: 0 } })
    expect(filled.dataset.rows).toEqual([[1], [0], [3]])
    expect(filled.notes[0]).toContain('filled 1 missing cells with 0')

    const kept = clean.run(base, { missing: { action: 'keep' } })
    expect(kept.dataset.rows).toEqual([[1], [null], [3]])
    expect(kept.notes).toEqual([])
  })

  it('clamps, drops, and errors on out-of-range values', () => {
    const base = ds([{ name: 'd' }], [[1], [5], [10]])
    const clamped = clean.run(base, { ranges: [{ column: 'd', min: 2, max: 8, action: 'clamp' }] })
    expect(clamped.dataset.rows).toEqual([[2], [5], [8]])
    expect(clamped.notes[0]).toContain('clamped 2 out-of-range values')

    const dropped = clean.run(base, { ranges: [{ column: 'd', min: 2, max: 8, action: 'drop' }] })
    expect(dropped.dataset.rows).toEqual([[5]])
    expect(dropped.notes[0]).toContain('dropped 2 rows out of range')

    expect(() => clean.run(base, { ranges: [{ column: 'd', min: 2, max: 8, action: 'error' }] })).toThrow(/out of range/)
    expect(() => clean.run(ds([{ name: 's', type: 'string' }], [['x']]), { ranges: [{ column: 's', min: 0, max: 1, action: 'clamp' }] }))
      .toThrow(/not numeric/)
  })

  it('deduplicates whole rows or by selected columns and trims strings', () => {
    const dupes = ds([{ name: 'a' }, { name: 'b' }], [[1, 1], [1, 1], [1, 2]])
    const deduped = clean.run(dupes, { dedupe: true })
    expect(deduped.dataset.rows).toEqual([[1, 1], [1, 2]])
    expect(deduped.notes[0]).toContain('removed 1 duplicate rows')

    const byCol = clean.run(dupes, { dedupe: { columns: ['a'] } })
    expect(byCol.dataset.rows).toEqual([[1, 1]])
    expect(() => clean.run(dupes, { dedupe: { columns: ['z'] } })).toThrow(/unknown column "z"/)

    const trimmed = clean.run(ds([{ name: 's', type: 'string' }], [['  hi ']]), { trimStrings: true })
    expect(trimmed.dataset.rows).toEqual([['hi']])
    expect(trimmed.notes[0]).toContain('trimmed whitespace from 1 string cells')
  })

  it('pads ragged rows when dropping columns', () => {
    const ragged = clean.run(ds([{ name: 'a' }, { name: 'b' }], [[1, 2], [3]]), { dropColumns: ['a'] })
    expect(ragged.dataset.columns.map(c => c.name)).toEqual(['b'])
    expect(ragged.dataset.rows).toEqual([[2], [null]])
  })

  it('coerces no-op cells, nulls, and string booleans', () => {
    const numbers = clean.run(
      ds([{ name: 'a', type: 'string' }], [[1], ['2'], [null], ['3']]),
      { columnTypes: [{ column: 'a', type: 'number' }] },
    )
    expect(numbers.dataset.rows).toEqual([[1], [2], [null], [3]])

    const booleans = clean.run(
      ds([{ name: 'a' }], [[true], ['true'], ['0'], ['false'], [1]]),
      { columnTypes: [{ column: 'a', type: 'boolean' }] },
    )
    expect(booleans.dataset.rows).toEqual([[true], [true], [false], [false], [true]])
  })

  it('skips notes when missing-value work changes nothing', () => {
    const noMissing = ds([{ name: 'a' }], [[1], [2]])
    const dropped = clean.run(noMissing, { missing: { action: 'drop' } })
    expect(dropped.dataset.rows).toEqual([[1], [2]])
    expect(dropped.notes).toEqual([])

    const filled = clean.run(noMissing, { missing: { action: 'fill', value: 0 } })
    expect(filled.dataset.rows).toEqual([[1], [2]])
    expect(filled.notes).toEqual([])
  })

  it('passes non-numeric cells through and errors on one-sided ranges', () => {
    const withNull = clean.run(ds([{ name: 'd' }], [[1], [null], [3]]), { ranges: [{ column: 'd', min: 0, action: 'clamp' }] })
    expect(withNull.dataset.rows).toEqual([[1], [null], [3]])

    expect(() => clean.run(ds([{ name: 'd' }], [[1], [5]]), { ranges: [{ column: 'd', max: 2, action: 'error' }] }))
      .toThrow(/out of range \[-∞, 2\]/)
    expect(() => clean.run(ds([{ name: 'd' }], [[5], [1]]), { ranges: [{ column: 'd', min: 3, action: 'error' }] }))
      .toThrow(/out of range \[3, \+∞\]/)
  })

  it('keeps unique rows silently and trims nothing when already clean', () => {
    const unique = clean.run(ds([{ name: 'a' }], [[1], [2]]), { dedupe: true })
    expect(unique.dataset.rows).toEqual([[1], [2]])
    expect(unique.notes).toEqual([])

    const plain = clean.run(ds([{ name: 's', type: 'string' }, { name: 'n' }], [['hi', 5]]), { trimStrings: true })
    expect(plain.dataset.rows).toEqual([['hi', 5]])
    expect(plain.notes).toEqual([])
  })
})

describe('convert processor', () => {
  it('validates every option', () => {
    const config = convert.validate({
      units: [{ column: 'd', from: 'm', to: 'cm' }],
      depthTime: { mode: 'depth-to-time', depthColumn: 'd', timeColumn: 't', velocity: 2000, outputUnit: 's' },
      selectColumns: ['d'],
    })
    expect(config.units).toHaveLength(1)
    expect(config.depthTime?.outputUnit).toBe('s')
    expect(() => convert.validate({ depthTime: { mode: 'sideways', depthColumn: 'd', timeColumn: 't', velocity: 1 } }))
      .toThrow(/must be one of/)
    expect(() => convert.validate({ depthTime: { mode: 'depth-to-time', depthColumn: 'd', timeColumn: 't', velocity: 0 } }))
      .toThrow(/must be positive/)
    expect(() => convert.validate({ depthTime: { mode: 'depth-to-time', depthColumn: 'd', timeColumn: 't', velocity: 1, outputUnit: 'h' } }))
      .toThrow(/must be one of/)
    expect(() => convert.validate({ selectColumns: ['d', 5] })).toThrow(/non-empty string/)
    expect(convert.validate({ depthTime: { mode: 'depth-to-time', depthColumn: 'd', timeColumn: 't', velocity: 2000 } }).depthTime?.outputUnit)
      .toBeUndefined()
  })

  it('selects columns in the requested order', () => {
    const result = convert.run(ds([{ name: 'a' }, { name: 'b' }, { name: 'c' }], [[1, 2, 3]]), { selectColumns: ['c', 'a'] })
    expect(result.dataset.columns.map(c => c.name)).toEqual(['c', 'a'])
    expect(result.dataset.rows[0]).toEqual([3, 1])
  })

  it('converts units and updates the declared unit', () => {
    const result = convert.run(ds([{ name: 'd', unit: 'm' }], [[1], [2]]), { units: [{ column: 'd', from: 'm', to: 'cm' }] })
    expect(result.dataset.rows).toEqual([[100], [200]])
    expect(result.dataset.columns[0]?.unit).toBe('cm')
    expect(result.notes[0]).toContain('converted "d" m→cm')
    expect(() => convert.run(ds([{ name: 'd' }], [[1]]), { units: [{ column: 'd', from: 'm', to: 'nope' }] }))
      .toThrow(/unknown unit/)
    expect(() => convert.run(ds([{ name: 'd', type: 'string' }], [['x']]), { units: [{ column: 'd', from: 'm', to: 'cm' }] }))
      .toThrow(/not numeric/)
  })

  it('converts depth to two-way time', () => {
    const result = convert.run(ds([{ name: 'depth' }], [[100], [200]]), {
      depthTime: { mode: 'depth-to-time', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })
    expect(result.dataset.columns.map(c => c.name)).toEqual(['depth', 'twt'])
    expect(result.dataset.rows).toEqual([[100, 100], [200, 200]])
    expect(result.dataset.columns[1]).toMatchObject({ type: 'number', unit: 'ms', role: 'time' })

    const seconds = convert.run(ds([{ name: 'depth' }], [[100]]), {
      depthTime: { mode: 'depth-to-time', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000, outputUnit: 's' },
    })
    expect(seconds.dataset.rows[0]).toEqual([100, 0.1])
  })

  it('reuses an existing time column instead of duplicating it', () => {
    const result = convert.run(ds([{ name: 'depth' }, { name: 'twt' }], [[100, 0]]), {
      depthTime: { mode: 'depth-to-time', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })
    expect(result.dataset.columns).toHaveLength(2)
    expect(result.dataset.rows[0]).toEqual([100, 100])
  })

  it('converts two-way time to depth', () => {
    const result = convert.run(ds([{ name: 'twt', unit: 'ms' }], [[100], [200]]), {
      depthTime: { mode: 'time-to-depth', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })
    expect(result.dataset.columns.map(c => c.name)).toEqual(['twt', 'depth'])
    expect(result.dataset.rows).toEqual([[100, 100], [200, 200]])
    expect(result.dataset.columns[1]).toMatchObject({ type: 'number', unit: 'm', role: 'depth' })

    const reuse = convert.run(ds([{ name: 'twt' }, { name: 'depth' }], [[100, 0]]), {
      depthTime: { mode: 'time-to-depth', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })
    expect(reuse.dataset.columns).toHaveLength(2)
  })

  it('rejects non-numeric depth/time columns', () => {
    expect(() => convert.run(ds([{ name: 'depth', type: 'string' }], [['x']]), {
      depthTime: { mode: 'depth-to-time', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })).toThrow(/depth column must be numeric/)
    expect(() => convert.run(ds([{ name: 'twt', type: 'string' }], [['x']]), {
      depthTime: { mode: 'time-to-depth', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })).toThrow(/time column must be numeric/)
  })

  it('pads ragged rows when selecting columns', () => {
    const ragged = convert.run(ds([{ name: 'a' }, { name: 'b' }], [[1, 2], [3]]), { selectColumns: ['a', 'b'] })
    expect(ragged.dataset.rows).toEqual([[1, 2], [3, null]])
  })

  it('leaves non-numeric cells untouched in unit conversion', () => {
    const result = convert.run(ds([{ name: 'd' }], [[1], [null]]), { units: [{ column: 'd', from: 'm', to: 'cm' }] })
    expect(result.dataset.rows).toEqual([[100], [null]])
  })

  it('pads rows with non-numeric depth or time cells in depth-time conversion', () => {
    const depth = convert.run(ds([{ name: 'depth' }], [[100], [null]]), {
      depthTime: { mode: 'depth-to-time', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000 },
    })
    expect(depth.dataset.rows).toEqual([[100, 100], [null, null]])

    const twt = convert.run(ds([{ name: 'twt' }], [[100], [null]]), {
      depthTime: { mode: 'time-to-depth', depthColumn: 'depth', timeColumn: 'twt', velocity: 2000, outputUnit: 's' },
    })
    expect(twt.dataset.rows).toEqual([[100, 100000], [null, null]])
    expect(twt.dataset.columns[1]).toMatchObject({ type: 'number', unit: 'm', role: 'depth' })
  })
})

describe('extract processor', () => {
  it('validates every option', () => {
    const config = extract.validate({
      statistics: { columns: ['a'] },
      rolling: [{ column: 'a', window: 3, operation: 'mean', output: 'm' }],
      rms: [{ column: 'a', window: 2 }],
    })
    expect(config.rolling).toHaveLength(1)
    expect(config.rms?.[0]?.output).toBeUndefined()
    expect(() => extract.validate({ rolling: [{ column: 'a', window: 3, operation: 'avg', output: 'm' }] }))
      .toThrow(/must be one of/)
    expect(() => extract.validate({ rolling: [{ column: 'a', window: 0, operation: 'mean', output: 'm' }] }))
      .toThrow(/positive integer/)
    expect(() => extract.validate({ statistics: { nope: 1 } })).toThrow(/unknown extract.statistics option/)
    expect(extract.validate({ statistics: {} })).toEqual({ statistics: {} })
    expect(extract.validate({ rms: [{ column: 'a', window: 2, output: 'x' }] }).rms?.[0]?.output).toBe('x')
  })

  it('computes per-column statistics over numeric columns by default', () => {
    const result = extract.run(ds([{ name: 'a' }, { name: 'b', type: 'string' }, { name: 'c' }], [[1, 'x', 2], [3, 'y', 4]]), {})
    const stats = result.dataset.meta.statistics as Record<string, Record<string, unknown>>
    expect(Object.keys(stats)).toEqual(['a', 'c'])
    expect(stats.a).toMatchObject({ count: 2, nulls: 0, mean: 2, median: 2, min: 1, max: 3, std: Math.sqrt(2), q1: 1.5, q3: 2.5, iqr: 1 })
    expect(result.notes[0]).toContain('computed statistics for 2 numeric column(s)')
  })

  it('supports explicit statistic columns and rejects bad ones', () => {
    const result = extract.run(ds([{ name: 'a' }, { name: 'c' }], [[1, 2]]), { statistics: { columns: ['c'] } })
    expect(Object.keys(result.dataset.meta.statistics as Record<string, unknown>)).toEqual(['c'])
    expect(() => extract.run(ds([{ name: 'a' }], [[1]]), { statistics: { columns: ['z'] } })).toThrow(/unknown column/)
    expect(() => extract.run(ds([{ name: 's', type: 'string' }], [['x']]), { statistics: { columns: ['s'] } }))
      .toThrow(/not numeric/)
  })

  it('computes rolling window statistics with null-padded edges', () => {
    const result = extract.run(ds([{ name: 'v' }], [[1], [2], [3], [4], [5]]), {
      rolling: [
        { column: 'v', window: 3, operation: 'mean', output: 'm' },
        { column: 'v', window: 3, operation: 'std', output: 's' },
        { column: 'v', window: 3, operation: 'min', output: 'lo' },
        { column: 'v', window: 3, operation: 'max', output: 'hi' },
      ],
    })
    const m = result.dataset.rows.map(row => row[1])
    expect(m).toEqual([1.5, 2, 3, 4, 4.5])
    const s = result.dataset.rows.map(row => row[2])
    expect(s[1]).toBe(1)
    expect(s[0]).toBeNull()
    expect(result.dataset.rows.map(row => row[3])).toEqual([1, 1, 2, 3, 4])
    expect(result.dataset.rows.map(row => row[4])).toEqual([2, 3, 4, 5, 5])
    expect(result.dataset.columns.at(-1)?.name).toBe('hi')
    expect(() => extract.run(ds([{ name: 'v' }], [[1]]), { rolling: [{ column: 'z', window: 3, operation: 'mean', output: 'm' }] }))
      .toThrow(/unknown column/)
    expect(() => extract.run(ds([{ name: 's', type: 'string' }], [['x']]), { rolling: [{ column: 's', window: 3, operation: 'mean', output: 'm' }] }))
      .toThrow(/not numeric/)
  })

  it('computes rolling RMS amplitude columns', () => {
    const result = extract.run(ds([{ name: 'amp' }], [[1], [2], [3], [4]]), { rms: [{ column: 'amp', window: 2, output: 'rms2' }] })
    expect(result.dataset.columns.at(-1)?.name).toBe('rms2')
    expect(result.dataset.rows.map(row => row[1] as number)).toEqual([
      1, Math.sqrt(2.5), Math.sqrt(6.5), Math.sqrt(12.5),
    ])
    const defaulted = extract.run(ds([{ name: 'amp' }], [[1], [2]]), { rms: [{ column: 'amp', window: 2 }] })
    expect(defaulted.dataset.columns.at(-1)?.name).toBe('amp_rms_2')
    expect(() => extract.run(ds([{ name: 'amp' }], [[1]]), { rms: [{ column: 'z', window: 2 }] }))
      .toThrow(/unknown column/)
  })

  it('preserves non-reserved meta keys and summarizes empty numeric columns', () => {
    const data: Dataset = {
      columns: [{ name: 'a', type: 'number' }],
      rows: [[null], [null]],
      meta: { source: 'f.csv', rowCount: 5 },
    }
    const result = extract.run(data, {})
    const stats = result.dataset.meta.statistics as Record<string, { count: number; nulls: number; q1: null }>
    expect(stats.a).toMatchObject({ count: 0, nulls: 2, q1: null })
    expect(result.dataset.meta.source).toBe('f.csv')
    expect(result.dataset.meta.rowCount).toBe(2)
  })

  it('rejects non-numeric rms columns and pads empty rms windows', () => {
    expect(() => extract.run(ds([{ name: 's', type: 'string' }], [['x']]), { rms: [{ column: 's', window: 2 }] }))
      .toThrow(/not numeric/)

    const empty = extract.run(ds([{ name: 'amp' }], [[null], [1], [2]]), { rms: [{ column: 'amp', window: 2 }] })
    expect(empty.dataset.rows[0]?.[1]).toBeNull()
    expect(empty.dataset.rows[1]?.[1]).toBe(1)
  })

  it('ignores non-numeric cells in rolling windows', () => {
    const result = extract.run(ds([{ name: 'v' }], [[1], [null], [3]]), {
      rolling: [{ column: 'v', window: 3, operation: 'mean', output: 'm' }],
    })
    expect(result.dataset.rows.map(row => row[1])).toEqual([1, 2, 3])
  })
})

describe('detect processor', () => {
  it('validates every option', () => {
    const config = detect.validate({
      zscore: [{ column: 'a', threshold: 3 }],
      iqr: [{ column: 'a', k: 2 }],
      threshold: [{ column: 'a', min: 0, max: 10 }],
      spike: [{ column: 'a', window: 3, threshold: 5 }],
      deadTrace: [{ sampleColumns: ['s0'] }],
      nulls: [{ columns: ['a'] }],
    })
    expect(config.zscore?.[0]?.threshold).toBe(3)
    expect(() => detect.validate({ threshold: [{ column: 'a' }] })).toThrow(/requires "min" or "max"/)
    expect(() => detect.validate({ threshold: [{ column: 'a', min: 5, max: 1 }] })).toThrow(/must not exceed max/)
    expect(() => detect.validate({ spike: [{ column: 'a', window: 0 }] })).toThrow(/positive integer/)

    const sparse = detect.validate({
      zscore: [{ column: 'a' }],
      iqr: [{ column: 'a' }],
      spike: [{ column: 'a' }],
      deadTrace: [{}],
      nulls: [{}],
    })
    expect(sparse.zscore?.[0]?.threshold).toBeUndefined()
    expect(sparse.iqr?.[0]?.k).toBeUndefined()
    expect(sparse.spike?.[0]?.window).toBeUndefined()
    expect(sparse.spike?.[0]?.threshold).toBeUndefined()
    expect(sparse.deadTrace?.[0]?.sampleColumns).toBeUndefined()
    expect(sparse.nulls?.[0]?.columns).toBeUndefined()
  })

  it('flags z-score outliers', () => {
    const data = ds([{ name: 'v' }], [
      [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [100],
    ])
    const result = detect.run(data, { zscore: [{ column: 'v' }] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ row: number; kind: string }>
    const detail = expect.stringContaining('3') as unknown as string
    expect(anomalies).toEqual([{ column: 'v', row: 10, value: 100, kind: 'zscore', detail }])
    expect(result.notes[0]).toContain('z-score detection on "v"')

    const constant = detect.run(ds([{ name: 'v' }], [[5], [5], [5]]), { zscore: [{ column: 'v' }] }, LIMITS)
    expect(constant.dataset.meta.anomalies).toEqual([])
  })

  it('flags IQR outliers and skips constant columns', () => {
    const result = detect.run(ds([{ name: 'v' }], [[1], [2], [3], [4], [100]]), { iqr: [{ column: 'v' }] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ row: number }>
    expect(anomalies.map(a => a.row)).toEqual([4])
    const constant = detect.run(ds([{ name: 'v' }], [[5], [5], [5]]), { iqr: [{ column: 'v' }] }, LIMITS)
    expect(constant.dataset.meta.anomalies).toEqual([])
  })

  it('flags threshold violations', () => {
    const result = detect.run(ds([{ name: 'v' }], [[1], [2], [3]]), { threshold: [{ column: 'v', min: 0, max: 2 }] }, LIMITS)
    expect(result.dataset.meta.anomalies).toHaveLength(1)
    expect((result.dataset.meta.anomalies as Array<{ row: number }>)[0]?.row).toBe(2)
  })

  it('flags spikes against a flat local median', () => {
    const result = detect.run(ds([{ name: 'v' }], [[1], [1], [1], [10], [1], [1], [1]]), { spike: [{ column: 'v' }] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ row: number; kind: string }>
    expect(anomalies.map(a => a.row)).toEqual([3])
    expect(anomalies[0]?.kind).toBe('spike')

    const single = detect.run(ds([{ name: 'v' }], [[5]]), { spike: [{ column: 'v' }] }, LIMITS)
    expect(single.dataset.meta.anomalies).toEqual([])
  })

  it('flags dead traces by default and explicit sample columns', () => {
    const data = ds(
      [{ name: 'trace' }, { name: 's0' }, { name: 's1' }],
      [
        [0, 1, 1],
        [0, 1, 1],
        [1, 2, 1],
        [1, 2, 3],
      ],
    )
    const result = detect.run(data, { deadTrace: [{}] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ row: number; kind: string; value: number }>
    expect(anomalies.map(a => a.row)).toEqual([0])
    expect(anomalies[0]?.kind).toBe('deadTrace')

    const explicit = detect.run(data, { deadTrace: [{ sampleColumns: ['s0'] }] }, LIMITS)
    expect(explicit.dataset.meta.anomalies).toHaveLength(2)

    const noTrace = detect.run(ds([{ name: 's0' }, { name: 's1' }], [[1, 1], [1, 1]]), { deadTrace: [{}] }, LIMITS)
    expect(noTrace.dataset.meta.anomalies).toHaveLength(2)

    expect(() => detect.run(ds([{ name: 's', type: 'string' }], [['x']]), { deadTrace: [{ sampleColumns: ['s'] }] }, LIMITS))
      .toThrow(/not numeric/)
  })

  it('flags missing cells over all or selected columns', () => {
    const data = ds([{ name: 'a' }, { name: 'b' }], [[1, null], [null, 2]])
    const all = detect.run(data, { nulls: [{}] }, LIMITS)
    expect(all.dataset.meta.anomalies).toHaveLength(2)
    const some = detect.run(data, { nulls: [{ columns: ['a'] }] }, LIMITS)
    expect(some.dataset.meta.anomalies).toEqual([{ column: 'a', row: 1, value: null, kind: 'null', detail: 'missing value' }])
    expect(() => detect.run(data, { nulls: [{ columns: ['z'] }] }, LIMITS)).toThrow(/unknown column/)
  })

  it('truncates the anomaly list at the record limit', () => {
    const result = detect.run(ds([{ name: 'a' }], [[null], [null], [null]]), { nulls: [{}] }, { ...LIMITS, maxAnomalyRecords: 1 })
    expect(result.dataset.meta.anomalies).toHaveLength(1)
    expect(result.notes).toContain('anomaly list truncated at 1 records')
  })

  it('skips missing and non-numeric cells in z-score detection', () => {
    const rows: unknown[][] = [[null], [null], [5]]
    const result = detect.run(ds([{ name: 'v' }], rows), { zscore: [{ column: 'v' }] }, LIMITS)
    expect(result.dataset.meta.anomalies).toEqual([])
  })

  it('skips missing and non-numeric cells in IQR detection', () => {
    const rows: unknown[][] = [[null], [null], [1], [2], [3], [100]]
    const result = detect.run(ds([{ name: 'v' }], rows), { iqr: [{ column: 'v' }] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ row: number }>
    expect(anomalies.map(a => a.row)).toEqual([5])
  })

  it('skips missing rows and covers one-sided thresholds', () => {
    const rows: unknown[][] = []
    rows[1] = [null]
    rows[2] = [1]
    rows[3] = [5]
    const both = detect.run(ds([{ name: 'v' }], rows), { threshold: [{ column: 'v', min: 0, max: 2 }] }, LIMITS)
    expect(both.dataset.meta.anomalies).toHaveLength(1)

    const onlyMax = detect.run(ds([{ name: 'v' }], [[1], [3]]), { threshold: [{ column: 'v', max: 2 }] }, LIMITS)
    expect(onlyMax.dataset.meta.anomalies).toHaveLength(1)

    const onlyMin = detect.run(ds([{ name: 'v' }], [[1], [5]]), { threshold: [{ column: 'v', min: 3 }] }, LIMITS)
    expect(onlyMin.dataset.meta.anomalies).toHaveLength(1)
  })

  it('skips missing rows and flags MAD-based spikes', () => {
    const rows: unknown[][] = []
    rows[1] = [null]
    rows[2] = [1]
    rows[3] = [4]
    rows[4] = [1]
    rows[5] = [10]
    rows[6] = [100]
    rows[7] = [4]
    rows[8] = [1]
    const result = detect.run(ds([{ name: 'v' }], rows), { spike: [{ column: 'v' }] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ row: number; kind: string }>
    expect(anomalies.some(a => a.row === 6 && a.kind === 'spike')).toBe(true)
  })

  it('handles null trace keys, non-numeric samples, and short groups', () => {
    const data = ds(
      [{ name: 'trace' }, { name: 's0' }],
      [
        [null, 1],
        [null, 1],
        [0, null],
        [0, 5],
        [1, 5],
      ],
    )
    const result = detect.run(data, { deadTrace: [{ sampleColumns: ['s0'] }] }, LIMITS)
    const anomalies = result.dataset.meta.anomalies as Array<{ kind: string }>
    expect(anomalies.every(a => a.kind === 'deadTrace')).toBe(true)
    expect(anomalies).toHaveLength(2)
  })

  it('fails loud on unknown or non-numeric columns in numeric detections', () => {
    expect(() => detect.run(ds([{ name: 'a' }], [[1]]), { zscore: [{ column: 'z' }] }, LIMITS))
      .toThrow(/unknown column "z"/)
    expect(() => detect.run(ds([{ name: 's', type: 'string' }], [['x']]), { zscore: [{ column: 's' }] }, LIMITS))
      .toThrow(/not numeric/)
  })
})

describe('step dispatch', () => {
  it('validates each step type through validateStep', () => {
    expect(validateStep({ id: 'i', type: 'ingest', config: {} }).config).toEqual({})
    expect(validateStep({ id: 'c', type: 'clean', config: { dedupe: true } }).config).toEqual({ dedupe: true })
    expect(validateStep({ id: 'u', type: 'convert', config: {} }).config).toEqual({})
    expect(validateStep({ id: 'e', type: 'extract', config: {} }).config).toEqual({})
    expect(validateStep({ id: 'd', type: 'detect', config: {} }).config).toEqual({})
    expect(validateStep({ id: 'p', type: 'profile', config: { formats: ['png'] } }).config).toEqual({ formats: ['png'] })
    expect(() => validateStep({ id: 'x', type: 'bogus' as unknown as StepType, config: {} })).toThrow(/unknown step type/)
  })

  it('runs each step type through runStep', () => {
    const input = { format: 'csv', data: 'a\n1' }
    const step = (type: StepType): PipelineStep => ({ id: type, type, config: {} })
    const ingested = runStep(step('ingest'), { columns: [], rows: [], meta: {} }, input, LIMITS)
    const cleaned = runStep(step('clean'), ingested.dataset, input, LIMITS)
    expect(cleaned.dataset.rows).toEqual([[1]])
    const converted = runStep(step('convert'), cleaned.dataset, input, LIMITS)
    expect(converted.dataset.rows).toEqual([[1]])
    const extracted = runStep(step('extract'), converted.dataset, input, LIMITS)
    expect(extracted.dataset.rows).toEqual([[1]])
    const detected = runStep(step('detect'), extracted.dataset, input, LIMITS)
    expect(detected.dataset.rows).toEqual([[1]])
    expect(() => runStep({ id: 'x', type: 'bogus' as unknown as StepType, config: {} }, cleaned.dataset, input, LIMITS))
      .toThrow(/unknown step type/)
  })

  it('runs a profile step over a seismic-shaped dataset', () => {
    const section = ds(
      [{ name: 'trace' }, { name: 'sampleIndex' }, { name: 'value' }],
      [[0, 0, 1], [0, 1, 2]],
    )
    const profiled = runStep({ id: 'p', type: 'profile', config: { formats: ['png'] } }, section, { format: 'csv', data: '' }, LIMITS)
    expect(profiled.dataset.rows).toEqual([[0, 0, 1], [0, 1, 2]])
    expect(profiled.dataset.meta.profile).toMatchObject({ kind: 'seismic', formats: ['png'] })
  })
})
