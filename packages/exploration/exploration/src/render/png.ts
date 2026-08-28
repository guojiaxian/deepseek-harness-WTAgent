/**
 * Minimal PNG encoder for 8-bit indexed-color (type 3) images.
 *
 * The `profile` processor renders amplitude sections through this encoder so
 * results are viewable anywhere PNG is supported and embeddable as data URIs
 * inside the SVG output. Raster data is one palette index per pixel; the
 * palette (up to 256 RGB entries) is stored in the PLTE chunk and the raw
 * scanlines are deflate-compressed into the IDAT chunk. The implementation is
 * dependency-free: CRC-32 is table-driven and compression uses Node's built-in
 * zlib.
 * @module @deepseek-ai/dsh-exploration
 */

import { deflateSync } from 'node:zlib'
import type { RGB } from './colormap.ts'

/** PNG signature bytes. */
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** CRC-32 table for the PNG polynomial, computed once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/**
 * Encode an indexed-color PNG image.
 * @param width - image width in pixels.
 * @param height - image height in pixels.
 * @param pixels - `width * height` palette indices in row-major order.
 * @param palette - RGB palette; must contain every index used by `pixels`.
 * @returns the complete PNG file bytes.
 */
export function encodePng(width: number, height: number, pixels: Uint8Array, palette: readonly RGB[]): Uint8Array {
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdrData(width, height)),
    chunk('PLTE', plteData(palette)),
    chunk('IDAT', idatData(width, height, pixels)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * Encode a byte buffer as a base64 string.
 * @param bytes - bytes to encode.
 * @returns the base64 text.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number)
  return btoa(binary)
}

/** IHDR chunk payload: 8-bit, indexed color, no filters, no interlace. */
function ihdrData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  data[8] = 8 // bit depth
  data[9] = 3 // color type: indexed
  data[10] = 0 // compression
  data[11] = 0 // filter
  data[12] = 0 // interlace
  return data
}

/** PLTE chunk payload: one RGB triplet per palette entry. */
function plteData(palette: readonly RGB[]): Uint8Array {
  const data = new Uint8Array(palette.length * 3)
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = palette[i] as RGB
    data[i * 3] = r
    data[i * 3 + 1] = g
    data[i * 3 + 2] = b
  }
  return data
}

/** IDAT chunk payload: deflate-compressed scanlines, each prefixed by filter byte 0. */
function idatData(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (width + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  return deflateSync(raw)
}

/** One PNG chunk: length, type, data, and CRC over type + data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const crcInput = new Uint8Array(typeBytes.length + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, typeBytes.length)
  const out = new Uint8Array(4 + typeBytes.length + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  out.set(typeBytes, 4)
  out.set(data, 4 + typeBytes.length)
  view.setUint32(4 + typeBytes.length + data.length, crc32(crcInput), false)
  return out
}

/** CRC-32 (PNG polynomial) over a byte buffer. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}
