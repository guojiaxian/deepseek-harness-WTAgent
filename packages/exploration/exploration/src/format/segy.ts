/**
 * SEG-Y rev 1 seismic data reader.
 *
 * Layout (1-based file offsets): a 3200-byte text header (EBCDIC by default,
 * detected from the bytes), a 400-byte binary header, N extended text headers,
 * then fixed-length traces of a 240-byte trace header plus samples. Sample
 * formats 1 (IBM float), 2/3/7/8/9 (signed ints), 5/6 (IEEE floats), and
 * 10/11/12/15/16 (unsigned ints) are supported. IBM float decoding is exact:
 * the 24-bit hex fraction is normalized onto the IEEE mantissa so values such
 * as 0x41100000 → 1.0 and 0x41200000 → 2.0 decode without rounding loss.
 * @module @deepseek-ai/dsh-exploration
 */

import { ExplorationError } from '../errors.ts'
import { detectHeaderEncoding, ebcdicToString } from './ebcdic.ts'
import type { CellValue, Column, Dataset } from '../types.ts'

/** Options controlling SEG-Y parsing. */
export interface SegYOptions {
  /** Emit long format (`trace`, `sampleIndex`, `value`, geometry); default true. */
  readonly longFormat?: boolean
  /** Decode at most this many samples per trace. */
  readonly sampleLimit?: number
}

/** Sample byte width per SEG-Y sample format code. */
const SAMPLE_SIZE: Readonly<Record<number, number>> = {
  1: 4, // IBM float
  2: 4, // int32
  3: 2, // int16
  5: 4, // IEEE float32
  6: 8, // IEEE float64
  7: 3, // int24
  8: 1, // int8
  9: 8, // int64
  10: 4, // uint32
  11: 2, // uint16
  12: 8, // uint64
  15: 3, // uint24
  16: 1, // uint8
}

/**
 * Decode one IBM System/360 float32 to a JavaScript number. The 24-bit hex
 * fraction is normalized so the leading set bit becomes the IEEE implicit bit,
 * avoiding the precision loss of a naive `sign * fraction * 16^e`.
 * @param u32 - the 4 big-endian bytes as a uint32.
 * @returns the decoded value.
 */
export function decodeIbmFloat(u32: number): number {
  const sign = (u32 >>> 31) === 1 ? -1 : 1
  const e0 = ((u32 >>> 24) & 0x7f) - 64
  const frac = u32 & 0xffffff
  if (frac === 0) return sign * 0
  const k = 31 - Math.clz32(frac)
  const e = 4 * e0 + k + 103
  let bits: number
  if (e <= 0) {
    // Underflow to signed zero.
    bits = sign < 0 ? 0x80000000 : 0
  } else if (e >= 255) {
    // Overflow to signed infinity.
    bits = sign < 0 ? 0xff800000 : 0x7f800000
  } else {
    const mantissa = (frac << (23 - k)) & 0x7fffff
    bits = (sign < 0 ? 0x80000000 : 0) | (e << 23) | mantissa
  }
  const view = new DataView(new ArrayBuffer(4))
  view.setUint32(0, bits >>> 0, false)
  return view.getFloat32(0, false)
}

/** Decode a 24-bit big-endian sample into a signed or unsigned number. */
function readInt24(view: DataView, offset: number, signed: boolean): number {
  const b0 = view.getUint8(offset)
  const b1 = view.getUint8(offset + 1)
  const b2 = view.getUint8(offset + 2)
  let value = (b0 << 16) | (b1 << 8) | b2
  if (signed && (b0 & 0x80) !== 0) value -= 0x1000000
  return value
}

/**
 * Decode one sample of the given format from `offset` in `view`.
 * @param view - DataView over the whole SEG-Y buffer.
 * @param offset - absolute byte offset of the sample.
 * @param format - SEG-Y sample format code.
 * @returns the decoded sample value.
 */
function readSample(view: DataView, offset: number, format: number): number {
  switch (format) {
    case 1:
      return decodeIbmFloat(view.getUint32(offset, false))
    case 2:
      return view.getInt32(offset, false)
    case 3:
      return view.getInt16(offset, false)
    case 5:
      return view.getFloat32(offset, false)
    case 6:
      return view.getFloat64(offset, false)
    case 7:
      return readInt24(view, offset, true)
    case 8:
      return view.getInt8(offset)
    case 9:
      return Number(view.getBigInt64(offset, false))
    case 10:
      return view.getUint32(offset, false)
    case 11:
      return view.getUint16(offset, false)
    case 12:
      return Number(view.getBigUint64(offset, false))
    case 15:
      return readInt24(view, offset, false)
    case 16:
      return view.getUint8(offset)
    /* v8 ignore next 2 -- parseSegY guards sample formats via SAMPLE_SIZE, so every reachable call hits a listed case */
    default:
      throw new ExplorationError(`unsupported SEG-Y sample format ${format}`, { code: 'UNSUPPORTED_FORMAT' })
  }
}

/** Decode a text header (EBCDIC or ASCII) into 40 trimmed lines joined by newlines. */
function decodeTextHeader(bytes: Uint8Array): { encoding: 'ascii' | 'ebcdic'; text: string } {
  const encoding = detectHeaderEncoding(bytes)
  const raw = encoding === 'ebcdic'
    ? ebcdicToString(bytes)
    : Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  const lines: string[] = []
  for (let i = 0; i < 40; i++) {
    lines.push(raw.slice(i * 80, (i + 1) * 80).trimEnd())
  }
  return { encoding, text: lines.join('\n') }
}

/**
 * Parse a SEG-Y buffer into a dataset. Long format emits one row per sample
 * with geometry and header fields; short format emits one row per trace with
 * one `sample_<i>` column per decoded sample. Binary-header values are recorded
 * in the dataset meta for downstream traceability.
 * @param bytes - the raw SEG-Y file bytes.
 * @param options - parse options.
 * @returns the tabular dataset with SEG-Y header metadata.
 */
export function parseSegY(bytes: Uint8Array, options: SegYOptions = {}): Dataset {
  if (bytes.length < 3600) {
    throw new ExplorationError('SEG-Y file too short: missing 3200-byte text header or 400-byte binary header', {
      code: 'PARSE_ERROR',
    })
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleIntervalUs = view.getInt16(3216, false)
  const samplesPerTrace = view.getInt16(3220, false)
  const sampleFormat = view.getInt16(3224, false)
  const revNumber = view.getInt16(3500, false)
  const extHeaderCount = view.getInt16(3504, false)
  const sampleSize = SAMPLE_SIZE[sampleFormat]
  if (sampleSize === undefined) {
    throw new ExplorationError(`unsupported SEG-Y sample format ${sampleFormat}`, { code: 'UNSUPPORTED_FORMAT' })
  }
  if (samplesPerTrace <= 0) {
    throw new ExplorationError('SEG-Y binary header declares no samples per trace', { code: 'PARSE_ERROR' })
  }

  const { encoding, text } = decodeTextHeader(bytes.subarray(0, 3200))
  const longFormat = options.longFormat ?? true
  const decodedSamples = options.sampleLimit === undefined
    ? samplesPerTrace
    : Math.min(options.sampleLimit, samplesPerTrace)

  const columns: Column[] = longFormat
    ? [
      { name: 'trace', type: 'number', role: 'trace' },
      { name: 'sampleIndex', type: 'number', role: 'sample' },
      { name: 'value', type: 'number', role: 'amplitude' },
      { name: 'x', type: 'number', role: 'x' },
      { name: 'y', type: 'number', role: 'y' },
      { name: 'inline', type: 'number', role: 'inline' },
      { name: 'crossline', type: 'number', role: 'crossline' },
      { name: 'fieldRecord', type: 'number', role: 'fieldRecord' },
      { name: 'traceInRecord', type: 'number', role: 'traceInRecord' },
      { name: 'traceId', type: 'number', role: 'traceId' },
    ]
    : [
      { name: 'trace', type: 'number', role: 'trace' },
      ...Array.from({ length: decodedSamples }, (_, i) => ({
        name: `sample_${i}`, type: 'number' as const, role: 'amplitude' as const,
      })),
    ]

  const traceHeader = 240
  const traceBytes = traceHeader + samplesPerTrace * sampleSize
  const dataStart = 3600 + extHeaderCount * 3200
  const rows: CellValue[][] = []
  let offset = dataStart
  let traceIndex = 0
  while (offset + traceBytes <= bytes.length) {
    const fieldRecord = view.getInt32(offset + 8, false)
    const traceInRecord = view.getInt32(offset + 12, false)
    const traceId = view.getInt16(offset + 28, false)
    const x = view.getInt32(offset + 180, false)
    const y = view.getInt32(offset + 184, false)
    const inline = view.getInt32(offset + 188, false)
    const crossline = view.getInt32(offset + 192, false)
    const sampleStart = offset + traceHeader
    if (longFormat) {
      for (let s = 0; s < decodedSamples; s++) {
        rows.push([
          traceIndex, s, readSample(view, sampleStart + s * sampleSize, sampleFormat),
          x, y, inline, crossline, fieldRecord, traceInRecord, traceId,
        ])
      }
    } else {
      const row: CellValue[] = [traceIndex]
      for (let s = 0; s < decodedSamples; s++) {
        row.push(readSample(view, sampleStart + s * sampleSize, sampleFormat))
      }
      rows.push(row)
    }
    offset += traceBytes
    traceIndex++
  }
  if (offset !== bytes.length && bytes.length - offset < traceBytes) {
    throw new ExplorationError('SEG-Y file ends with a truncated trace', { code: 'PARSE_ERROR' })
  }

  return {
    columns,
    rows,
    meta: {
      sampleIntervalUs,
      sampleFormat,
      sampleFormatName: sampleFormatName(sampleFormat),
      traceCount: traceIndex,
      revNumber,
      extHeaderCount,
      textHeaderEncoding: encoding,
      textHeader: text,
    },
  }
}

/** Human-readable name for a SEG-Y sample format code. */
function sampleFormatName(format: number): string {
  switch (format) {
    case 1: return 'IBM float'
    case 2: return 'int32'
    case 3: return 'int16'
    case 5: return 'IEEE float32'
    case 6: return 'IEEE float64'
    case 7: return 'int24'
    case 8: return 'int8'
    case 9: return 'int64'
    case 10: return 'uint32'
    case 11: return 'uint16'
    case 12: return 'uint64'
    case 15: return 'uint24'
    case 16: return 'uint8'
    /* v8 ignore next 2 -- sampleFormatName only runs for formats with a defined SAMPLE_SIZE */
    default: return `unknown (${format})`
  }
}
