import { describe, expect, it } from 'vitest'
import { checksumBytes, checksumDataset } from '../src/checksum.ts'
import { carryMeta, columnIndex, columnValues, findColumn, requireColumn } from '../src/dataset.ts'
import { ExplorationError } from '../src/errors.ts'
import { detectHeaderEncoding, ebcdicToAscii, ebcdicToString } from '../src/format/ebcdic.ts'
import { iqr, mad, max, mean, median, min, quantile, std, zscore } from '../src/stats.ts'
import { convert, resolveUnit } from '../src/units.ts'
import type { Dataset } from '../src/types.ts'

describe('ExplorationError', () => {
  it('carries a stable code and optional run/step context', () => {
    const error = new ExplorationError('boom', { code: 'PARSE_ERROR' })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ExplorationError')
    expect(error.message).toBe('boom')
    expect(error.code).toBe('PARSE_ERROR')
    expect(error.runId).toBeUndefined()
    expect(error.stepId).toBeUndefined()
    expect(error.details).toBeUndefined()
  })

  it('assigns optional fields only when present', () => {
    const error = new ExplorationError('boom', {
      code: 'DATA_ERROR',
      runId: 'run-1',
      stepId: 'step-2',
      details: { column: 'depth' },
    })
    expect(error.runId).toBe('run-1')
    expect(error.stepId).toBe('step-2')
    expect(error.details).toEqual({ column: 'depth' })
  })
})

describe('checksum', () => {
  it('hashes bytes deterministically', () => {
    const first = checksumBytes(new TextEncoder().encode('abc'))
    const second = checksumBytes(new TextEncoder().encode('abc'))
    expect(first).toBe(second)
    expect(first).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(checksumBytes(new TextEncoder().encode('abd'))).not.toBe(first)
  })

  it('canonicalizes a dataset with sorted meta keys', () => {
    const base: Dataset = { columns: [{ name: 'a', type: 'number' }], rows: [[1]], meta: {} }
    const shuffled: Dataset = {
      columns: base.columns,
      rows: base.rows,
      meta: { z: 1, a: 2 },
    }
    const ordered: Dataset = {
      columns: base.columns,
      rows: base.rows,
      meta: { a: 2, z: 1 },
    }
    expect(checksumDataset(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(checksumDataset(shuffled)).toBe(checksumDataset(ordered))
    expect(checksumDataset(base)).not.toBe(checksumDataset(shuffled))
  })
})

describe('stats', () => {
  it('mean handles empty and non-finite samples', () => {
    expect(mean([])).toBeNull()
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([1, 2, Infinity, NaN, null as unknown as number])).toBe(1.5)
  })

  it('std is the sample form and needs two samples', () => {
    expect(std([])).toBeNull()
    expect(std([5])).toBeNull()
    expect(std([1, 2, 3])).toBe(1)
  })

  it('median handles odd and even lengths', () => {
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('quantile uses the R-7 estimator', () => {
    expect(quantile([], 0.5)).toBeNull()
    expect(quantile([1, 2, 3], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 1)).toBe(4)
  })

  it('iqr is the interquartile range', () => {
    expect(iqr([])).toBeNull()
    expect(iqr([1, 2, 3, 4])).toBe(1.5)
  })

  it('zscore scores against the reference sample', () => {
    expect(zscore(10, [])).toBeNull()
    expect(zscore(10, [3, 3, 3])).toBeNull()
    expect(zscore(10, [1, 2, 3])).toBe(8)
  })

  it('min and max return null on empty input and ignore non-finite values', () => {
    expect(min([])).toBeNull()
    expect(max([])).toBeNull()
    expect(min([3, 1, 2])).toBe(1)
    expect(max([3, 1, 2])).toBe(3)
    expect(min([3, Infinity, NaN])).toBe(3)
  })

  it('mad measures spread around the median', () => {
    expect(mad([])).toBeNull()
    expect(mad([1, 2, 3])).toBe(1)
  })
})

describe('units', () => {
  it('resolves known units and rejects unknown ones', () => {
    expect(resolveUnit('m')).toBeDefined()
    expect(resolveUnit('nope')).toBeUndefined()
  })

  it('converts linear units through the base unit', () => {
    expect(convert(1, 'm', 'cm')).toBe(100)
    expect(convert(1, 'km', 'm')).toBe(1000)
    expect(convert(60, 's', 'min')).toBe(1)
    expect(convert(1, 'm/s', 'km/s')).toBe(0.001)
    expect(convert(1, 'g/cm3', 'kg/m3')).toBe(1000)
  })

  it('converts temperatures with their affine offsets', () => {
    expect(convert(0, 'C', 'F')).toBeCloseTo(32)
    expect(convert(32, 'F', 'C')).toBeCloseTo(0)
    expect(convert(273.15, 'C', 'K')).toBeCloseTo(546.3)
  })

  it('returns undefined for unknown units', () => {
    expect(convert(1, 'm', 'nope')).toBeUndefined()
    expect(convert(1, 'nope', 'm')).toBeUndefined()
  })
})

describe('dataset helpers', () => {
  it('carryMeta drops pipeline-owned keys and refreshes rowCount', () => {
    const carried = carryMeta({ source: 'f.csv', rowCount: 5, provenance: ['a'], custom: 1 }, 9)
    expect(carried).toEqual({ source: 'f.csv', custom: 1, rowCount: 9 })
  })

  it('findColumn resolves a column or fails loud', () => {
    expect(findColumn([{ name: 'a' }, { name: 'b' }], 'b', 'what')).toBe(1)
    expect(() => findColumn([{ name: 'a' }], 'z', 'what')).toThrow(/unknown column "z"/)
  })

  it('columnIndex returns -1 for unknown columns', () => {
    const ds: Dataset = { columns: [{ name: 'a', type: 'number' }], rows: [[1]], meta: {} }
    expect(columnIndex(ds, 'a')).toBe(0)
    expect(columnIndex(ds, 'z')).toBe(-1)
  })

  it('requireColumn resolves a column or fails loud', () => {
    const ds: Dataset = { columns: [{ name: 'a', type: 'number' }], rows: [[1]], meta: {} }
    expect(requireColumn(ds, 'a', 'what')).toBe(0)
    expect(() => requireColumn(ds, 'z', 'what')).toThrow(/unknown column "z"/)
  })

  it('columnValues resolves values preserving nulls', () => {
    const ds: Dataset = { columns: [{ name: 'a', type: 'number' }], rows: [[1], [null]], meta: {} }
    expect(columnValues(ds, 'a', 'what')).toEqual([1, null])
  })
})

describe('EBCDIC translation', () => {
  it('decodes single bytes', () => {
    expect(ebcdicToAscii(0xC1)).toBe('A')
    expect(ebcdicToAscii(0x40)).toBe(' ')
    expect(ebcdicToAscii(0xF0)).toBe('0')
    expect(ebcdicToAscii(0xFF)).toBe(' ')
  })

  it('maps out-of-range bytes to a space', () => {
    expect(ebcdicToAscii(256)).toBe(' ')
    expect(ebcdicToAscii(-1)).toBe(' ')
  })

  it('decodes a full buffer', () => {
    expect(ebcdicToString(Uint8Array.from([0xC1, 0xC2, 0xF0, 0xFF]))).toBe('AB0 ')
  })

  it('detects the header encoding from high bytes', () => {
    expect(detectHeaderEncoding(Uint8Array.from([0x40, 0x80]))).toBe('ebcdic')
    expect(detectHeaderEncoding(Uint8Array.from([0x41, 0x20]))).toBe('ascii')
  })
})
