/**
 * Minimal ZIP writer and hardened reader for Office Open XML packaging.
 *
 * The writer is the paper engine's store-only profile: entries are written
 * stored (method 0) with CRC-32 checksums — valid ZIP that Word, LibreOffice,
 * and every common unzip open. The reader parses the end-of-central-directory
 * record backwards (the only robust way to find the central directory), then
 * inflates entries with explicit zip-bomb, ZIP64, and path-traversal guards.
 * @module @deepseek-ai/dsh-bidding
 */

import { inflateRawSync } from 'node:zlib'
import { BiddingError } from '../errors.ts'

/** One stored entry in the archive: a member name plus its raw bytes. */
export interface ZipEntry {
  /** Member path inside the archive, using `/` separators. */
  readonly name: string
  /** Uncompressed entry bytes; stored verbatim. */
  readonly data: Uint8Array
}

/** Reader guard rails. */
export interface ZipReadLimits {
  /** Maximum entry count; default 512. */
  readonly maxEntries: number
  /** Maximum uncompressed bytes per entry; default 64 MiB. */
  readonly maxEntryBytes: number
  /** Maximum total uncompressed bytes; default 128 MiB. */
  readonly maxTotalBytes: number
  /** Maximum compression ratio for entries ≥ 1 KiB compressed; default 100. */
  readonly maxRatio: number
}

/** Default ZIP read limits. */
export const DEFAULT_ZIP_READ_LIMITS: ZipReadLimits = {
  maxEntries: 512,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxRatio: 100,
}

/** Little-endian signature bytes of each ZIP structure. */
const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50

/** Maximum bytes of an archive's tail scanned for the EOCD record. */
const MAX_EOCD_SCAN = 65_557

/** CRC-32 lookup table (IEEE 802.3 polynomial, reflected). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * Compute the CRC-32 checksum of an entry's bytes.
 * @param data - entry bytes.
 * @returns the CRC-32 value as an unsigned integer.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = ((CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Assemble a store-only ZIP archive over the given entries.
 * @param entries - members in archive order; the central directory preserves it.
 * @returns the complete archive bytes.
 */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_HEADER, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += 30 + name.length + data.length
  }

  const centralDir = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDir.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDir, end])
}

/**
 * Reject archive member names that attempt path traversal or are malformed.
 * @param name - member path inside the archive.
 */
function checkEntryName(name: string): void {
  if (name === '') {
    throw new BiddingError('ZIP entry with an empty name', { code: 'PARSE_ERROR' })
  }
  if (name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new BiddingError(`ZIP entry "${name}" uses an absolute or backslash path`, { code: 'PARSE_ERROR' })
  }
  for (const segment of name.split('/')) {
    if (segment === '..') {
      throw new BiddingError(`ZIP entry "${name}" traverses outside the archive root`, { code: 'PARSE_ERROR' })
    }
  }
}

/**
 * Read every entry of a ZIP archive with hardening.
 * @param data - the complete archive bytes.
 * @param limits - reader guard rails.
 * @returns entries keyed by member name.
 */
export function readZipEntries(data: Uint8Array, limits: ZipReadLimits = DEFAULT_ZIP_READ_LIMITS): Map<string, Uint8Array> {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (buffer.length < 22) {
    throw new BiddingError('archive is too small to be a ZIP file', { code: 'PARSE_ERROR' })
  }
  // Locate the EOCD record: the last 0x06054b50 within the tail window.
  const scanStart = Math.max(0, buffer.length - MAX_EOCD_SCAN)
  let eocd = -1
  for (let i = buffer.length - 22; i >= scanStart; i--) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL) {
      eocd = i
      break
    }
  }
  if (eocd === -1) {
    throw new BiddingError('end-of-central-directory record not found (not a ZIP file)', { code: 'PARSE_ERROR' })
  }
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new BiddingError('ZIP64 archives are not supported', { code: 'PARSE_ERROR' })
  }
  if (entryCount > limits.maxEntries) {
    throw new BiddingError(`ZIP entry count ${String(entryCount)} exceeds ${String(limits.maxEntries)}`, {
      code: 'LIMIT_EXCEEDED',
      details: { measured: entryCount, cap: limits.maxEntries, recovery: 'use a smaller archive' },
    })
  }
  if (centralOffset + centralSize > buffer.length) {
    throw new BiddingError('central directory extends past the archive end', { code: 'PARSE_ERROR' })
  }

  const entries = new Map<string, Uint8Array>()
  let total = 0
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_HEADER) {
      throw new BiddingError(`central directory entry ${String(index)} is malformed`, { code: 'PARSE_ERROR' })
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    checkEntryName(name)
    if (entries.has(name)) {
      throw new BiddingError(`duplicate ZIP entry "${name}"`, { code: 'PARSE_ERROR' })
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new BiddingError(`ZIP entry "${name}" inflates to ${String(uncompressedSize)} bytes, cap ${String(limits.maxEntryBytes)}`, {
        code: 'LIMIT_EXCEEDED',
        details: { measured: uncompressedSize, cap: limits.maxEntryBytes, recovery: 'use a smaller document' },
      })
    }
    total += uncompressedSize
    if (total > limits.maxTotalBytes) {
      throw new BiddingError(`ZIP total inflated size exceeds ${String(limits.maxTotalBytes)}`, {
        code: 'LIMIT_EXCEEDED',
        details: { measured: total, cap: limits.maxTotalBytes, recovery: 'use a smaller document' },
      })
    }
    if (compressedSize >= 1024 && uncompressedSize / compressedSize > limits.maxRatio) {
      throw new BiddingError(`ZIP entry "${name}" has a suspicious compression ratio (possible zip bomb)`, {
        code: 'PARSE_ERROR',
      })
    }

    // Verify the local header and locate the entry data.
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new BiddingError(`local header of "${name}" is malformed`, { code: 'PARSE_ERROR' })
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > buffer.length) {
      throw new BiddingError(`entry data of "${name}" extends past the archive end`, { code: 'PARSE_ERROR' })
    }
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    let content: Buffer
    if (method === 0) {
      content = Buffer.from(raw)
      if (content.length !== uncompressedSize) {
        throw new BiddingError(`stored entry "${name}" has an inconsistent size`, { code: 'PARSE_ERROR' })
      }
    } else if (method === 8) {
      try {
        content = inflateRawSync(raw)
      } catch (error: unknown) {
        throw new BiddingError(`entry "${name}" failed to inflate: ${error instanceof Error ? error.message : String(error)}`, {
          code: 'PARSE_ERROR',
        })
      }
      if (content.length !== uncompressedSize) {
        throw new BiddingError(`inflated entry "${name}" has an inconsistent size`, { code: 'PARSE_ERROR' })
      }
    } else {
      throw new BiddingError(`ZIP entry "${name}" uses unsupported method ${String(method)}`, { code: 'PARSE_ERROR' })
    }
    entries.set(name, new Uint8Array(content))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
