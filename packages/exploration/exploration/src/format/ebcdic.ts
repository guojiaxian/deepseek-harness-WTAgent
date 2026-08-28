/**
 * CP037 EBCDIC→ASCII translation for SEG-Y text headers.
 *
 * SEG-Y rev 1 text headers are EBCDIC by default; the decoder detects the
 * encoding from the first bytes and translates via this table. Unmapped bytes
 * decode to a space, matching how geophysical tools present undecodable header
 * content.
 * @module @deepseek-ai/dsh-exploration
 */

/** The 256-entry CP037 decode table, built once. */
const TABLE: readonly string[] = (() => {
  const table: string[] = new Array<string>(256).fill(' ')
  const set = (byte: number, char: string): void => {
    table[byte] = char
  }
  set(0x40, ' ')
  set(0x4b, '.')
  set(0x50, '&')
  set(0x5a, '!')
  set(0x5b, '$')
  set(0x5c, '*')
  set(0x5d, ')')
  set(0x5e, ';')
  set(0x60, '-')
  set(0x61, '/')
  set(0x6b, ',')
  set(0x6c, '%')
  set(0x6d, '_')
  set(0x6e, '>')
  set(0x6f, '?')
  set(0x7a, ':')
  set(0x7b, '#')
  set(0x7c, '@')
  set(0x7d, "'")
  set(0x7e, '=')
  set(0x7f, '"')
  // Lowercase letters a-z.
  for (let i = 0; i < 9; i++) set(0x81 + i, String.fromCharCode(0x61 + i)) // a-i
  for (let i = 0; i < 9; i++) set(0x91 + i, String.fromCharCode(0x6a + i)) // j-r
  for (let i = 0; i < 8; i++) set(0xa2 + i, String.fromCharCode(0x73 + i)) // s-z
  // Uppercase letters A-Z.
  for (let i = 0; i < 9; i++) set(0xc1 + i, String.fromCharCode(0x41 + i)) // A-I
  for (let i = 0; i < 9; i++) set(0xd1 + i, String.fromCharCode(0x4a + i)) // J-R
  for (let i = 0; i < 8; i++) set(0xe2 + i, String.fromCharCode(0x53 + i)) // S-Z
  // Digits 0-9.
  for (let i = 0; i < 10; i++) set(0xf0 + i, String.fromCharCode(0x30 + i))
  return table
})()

/**
 * Decode one EBCDIC byte to its ASCII character.
 * @param byte - byte value in [0, 255].
 * @returns the ASCII character, or a space for unmapped bytes.
 */
export function ebcdicToAscii(byte: number): string {
  return TABLE[byte] ?? ' '
}

/**
 * Decode a full EBCDIC buffer to an ASCII string.
 * @param bytes - EBCDIC-encoded bytes.
 * @returns the ASCII string.
 */
export function ebcdicToString(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += ebcdicToAscii(byte)
  return out
}

/**
 * Detect the text-header encoding of a SEG-Y file. SEG-Y rev 1 headers are
 * EBCDIC unless marked ASCII; a printable-ASCII file rarely contains bytes
 * >= 0x80, while EBCDIC headers almost always do.
 * @param bytes - the raw header bytes.
 * @returns `'ascii'` or `'ebcdic'`.
 */
export function detectHeaderEncoding(bytes: Uint8Array): 'ascii' | 'ebcdic' {
  for (const byte of bytes) {
    if (byte >= 0x80) return 'ebcdic'
  }
  return 'ascii'
}
