/**
 * Structured document configuration and the format dispatch for exports.
 *
 * Exports take a {@link Paper} plus a {@link DocumentConfig} describing both
 * content and layout: running header/footer text, page numbering, font family
 * and size, line spacing, paragraph spacing, and uniform margins. The config is
 * validated loudly up front (unknown keys and out-of-range values fail) so a
 * malformed export request never silently produces a malformed document. Two
 * renderers consume the same config: `docx` builds real OOXML inside a ZIP
 * archive, and `doc` builds classic RTF. Both are dependency-free in line with
 * the rest of the engine.
 * @module @deepseek-ai/dsh-paper
 */

import { checksumBytes } from '../checksum.ts'
import { PaperError } from '../errors.ts'
import { asBoolean, asNumber, asString, checkKeys, checkObject } from '../processors/validate.ts'
import type { Limits, Paper } from '../types.ts'
import { renderDoc } from './rtf.ts'
import { renderDocx } from './docx.ts'

/** Supported document output formats. */
export type DocumentFormat = 'doc' | 'docx'

/** Structured layout and content configuration of a generated document. */
export interface DocumentConfig {
  /** Text emitted in the running header of every page. */
  readonly headerText?: string
  /** Text emitted in the running footer of every page. */
  readonly footerText?: string
  /** Show the current page number in the footer; default true. */
  readonly pageNumbers?: boolean
  /** Body font family name; default `Times New Roman`. */
  readonly fontFamily?: string
  /** Body font size in points; default 12. */
  readonly fontSizePt?: number
  /** Line spacing as a multiple of single spacing; default 1.5. */
  readonly lineSpacing?: number
  /** Space after each paragraph in points; default 6. */
  readonly paragraphSpacingPt?: number
  /** Uniform page margin in millimeters; default 25.4 (one inch). */
  readonly marginsMm?: number
}

/** A {@link DocumentConfig} with every optional field resolved to its default. */
export interface ResolvedDocumentConfig {
  readonly headerText: string
  readonly footerText: string
  readonly pageNumbers: boolean
  readonly fontFamily: string
  readonly fontSizePt: number
  readonly lineSpacing: number
  readonly paragraphSpacingPt: number
  readonly marginsMm: number
}

/** One generated document: raw bytes plus a fingerprint of those bytes. */
export interface DocumentOutput {
  /** The produced format, matching the requested one. */
  readonly format: DocumentFormat
  /** Raw document bytes in the requested format. */
  readonly data: Uint8Array
  /** Byte length of the raw document. */
  readonly bytes: number
  /** sha256 over the raw document bytes. */
  readonly checksum: string
}

/** Default body font family. */
export const DEFAULT_FONT_FAMILY = 'Times New Roman'
/** Default body font size in points. */
export const DEFAULT_FONT_SIZE_PT = 12
/** Default line spacing as a multiple of single spacing. */
export const DEFAULT_LINE_SPACING = 1.5
/** Default space after each paragraph in points. */
export const DEFAULT_PARAGRAPH_SPACING_PT = 6
/** Default uniform page margin in millimeters. */
export const DEFAULT_MARGINS_MM = 25.4
/** Default footer page numbering on/off. */
export const DEFAULT_PAGE_NUMBERS = true
/** Default maximum generated document size in bytes. */
export const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * Validate a raw document config, resolving every optional field to its default.
 * @param config - raw config value.
 * @returns the fully resolved config.
 */
export function validateDocumentConfig(config: unknown): ResolvedDocumentConfig {
  const obj = checkObject(config, 'document config')
  checkKeys(obj, [
    'headerText', 'footerText', 'pageNumbers', 'fontFamily',
    'fontSizePt', 'lineSpacing', 'paragraphSpacingPt', 'marginsMm',
  ], 'document')
  return {
    headerText: obj.headerText === undefined ? '' : asString(obj.headerText, 'document.headerText'),
    footerText: obj.footerText === undefined ? '' : asString(obj.footerText, 'document.footerText'),
    pageNumbers: obj.pageNumbers === undefined ? DEFAULT_PAGE_NUMBERS : asBoolean(obj.pageNumbers, 'document.pageNumbers'),
    fontFamily: obj.fontFamily === undefined ? DEFAULT_FONT_FAMILY : asString(obj.fontFamily, 'document.fontFamily'),
    fontSizePt: obj.fontSizePt === undefined ? DEFAULT_FONT_SIZE_PT : positiveNumber(obj.fontSizePt, 'document.fontSizePt'),
    lineSpacing: obj.lineSpacing === undefined ? DEFAULT_LINE_SPACING : positiveNumber(obj.lineSpacing, 'document.lineSpacing'),
    paragraphSpacingPt: obj.paragraphSpacingPt === undefined
      ? DEFAULT_PARAGRAPH_SPACING_PT
      : nonNegativeNumber(obj.paragraphSpacingPt, 'document.paragraphSpacingPt'),
    marginsMm: obj.marginsMm === undefined ? DEFAULT_MARGINS_MM : positiveNumber(obj.marginsMm, 'document.marginsMm'),
  }
}

/**
 * Assert a value is a positive finite number.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the number.
 */
function positiveNumber(value: unknown, what: string): number {
  const n = asNumber(value, what)
  if (n <= 0) {
    throw new PaperError(`${what} must be a positive number (e.g. 12)`, { code: 'VALIDATION_ERROR' })
  }
  return n
}

/**
 * Assert a value is a zero-or-positive finite number.
 * @param value - value to check.
 * @param what - human-readable option name.
 * @returns the number.
 */
function nonNegativeNumber(value: unknown, what: string): number {
  const n = asNumber(value, what)
  if (n < 0) {
    throw new PaperError(`${what} must be zero or positive (e.g. 6)`, { code: 'VALIDATION_ERROR' })
  }
  return n
}

/**
 * Render a paper as a `.docx` or `.doc` document under a resolved config.
 * @param paper - paper to render; title, sections, and citations are projected.
 * @param format - requested output format, `doc` or `docx`.
 * @param config - resolved layout and content configuration.
 * @param limits - resource limits; `maxOutputBytes` caps the generated size.
 * @returns the generated document bytes plus their checksum.
 */
export function renderDocument(
  paper: Paper,
  format: string,
  config: ResolvedDocumentConfig,
  limits: Limits,
): DocumentOutput {
  if (format !== 'doc' && format !== 'docx') {
    throw new PaperError(
      `unsupported document format "${format}"; use "doc" or "docx"`,
      { code: 'UNSUPPORTED_FORMAT' },
    )
  }
  const data = format === 'docx' ? renderDocx(paper, config) : renderDoc(paper, config)
  enforceMaxBytes(data, limits.maxOutputBytes)
  return { format, data, bytes: data.byteLength, checksum: checksumBytes(data) }
}

/**
 * Reject an over-sized document with recovery guidance.
 * @param data - generated document bytes.
 * @param maxBytes - configured cap; defaults when the limit is unset.
 */
function enforceMaxBytes(data: Uint8Array, maxBytes: number | undefined): void {
  const cap = maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (data.byteLength > cap) {
    throw new PaperError(
      `generated ${data.byteLength} byte document exceeds the ${cap} byte limit; shrink the manuscript or raise maxOutputBytes`,
      { code: 'LIMIT_EXCEEDED', details: { bytes: data.byteLength, maxBytes: cap } },
    )
  }
}
