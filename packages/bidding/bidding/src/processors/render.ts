/**
 * Bid rendering entry: validate the render configuration, resolve it against
 * defaults, and project a {@link BidDraft} into `.docx` bytes through the
 * format layer. Enforces `maxOutputBytes` on the produced archive.
 * @module @deepseek-ai/dsh-bidding
 */

import { BiddingError } from '../errors.ts'
import type { BidDraft, Limits } from '../types.ts'
import { asBoolean, asNumber, asObject, asOptionalString, checkKeys } from '../validate.ts'
import { renderDocx } from '../format/docx-write.ts'
import type { ResolvedDocxConfig } from '../format/docx-write.ts'

/** Maximum header/footer text length. */
const HEADER_TEXT_CHARS = 60

/** User-supplied render options; omitted fields take defaults. */
export interface RenderConfig {
  readonly headerText?: string
  readonly footerText?: string
  readonly pageNumbers?: boolean
  readonly bodyFontFamily?: string
  readonly headingFontFamily?: string
  readonly fontSizePt?: number
  readonly lineSpacing?: number
  readonly paragraphSpacingPt?: number
  readonly marginsMm?: number
}

/** Default render configuration: 宋体 body over 黑体 headings, A4. */
export const DEFAULT_RENDER_CONFIG: ResolvedDocxConfig = {
  headerText: '',
  footerText: '',
  pageNumbers: true,
  bodyFontFamily: '宋体',
  headingFontFamily: '黑体',
  fontSizePt: 12,
  lineSpacing: 1.5,
  paragraphSpacingPt: 6,
  marginsMm: 25,
}

/**
 * Validate and resolve a render configuration.
 * @param value - user-supplied options (unknown JSON).
 * @returns the fully populated layout config.
 * @throws BiddingError `VALIDATION_ERROR` on unknown keys, wrong types, or
 * out-of-range values.
 */
export function resolveRenderConfig(value: unknown): ResolvedDocxConfig {
  const object = asObject(value, 'render config')
  checkKeys(object, [
    'headerText', 'footerText', 'pageNumbers', 'bodyFontFamily', 'headingFontFamily',
    'fontSizePt', 'lineSpacing', 'paragraphSpacingPt', 'marginsMm',
  ], 'render config')
  const headerText = asOptionalString(object.headerText, 'render config headerText')?.slice(0, HEADER_TEXT_CHARS) ?? ''
  const footerText = asOptionalString(object.footerText, 'render config footerText')?.slice(0, HEADER_TEXT_CHARS) ?? ''
  const pageNumbers = asBoolean(object.pageNumbers ?? true, 'render config pageNumbers')
  const bodyFontFamily = asOptionalString(object.bodyFontFamily, 'render config bodyFontFamily') ?? DEFAULT_RENDER_CONFIG.bodyFontFamily
  const headingFontFamily = asOptionalString(object.headingFontFamily, 'render config headingFontFamily') ?? DEFAULT_RENDER_CONFIG.headingFontFamily
  const fontSizePt = asNumber(object.fontSizePt ?? DEFAULT_RENDER_CONFIG.fontSizePt, 'render config fontSizePt')
  const lineSpacing = asNumber(object.lineSpacing ?? DEFAULT_RENDER_CONFIG.lineSpacing, 'render config lineSpacing')
  const paragraphSpacingPt = asNumber(object.paragraphSpacingPt ?? DEFAULT_RENDER_CONFIG.paragraphSpacingPt, 'render config paragraphSpacingPt')
  const marginsMm = asNumber(object.marginsMm ?? DEFAULT_RENDER_CONFIG.marginsMm, 'render config marginsMm')
  if (fontSizePt < 8 || fontSizePt > 28) {
    throw new BiddingError('render config fontSizePt must be between 8 and 28', { code: 'VALIDATION_ERROR' })
  }
  if (lineSpacing < 1 || lineSpacing > 3) {
    throw new BiddingError('render config lineSpacing must be between 1 and 3', { code: 'VALIDATION_ERROR' })
  }
  if (paragraphSpacingPt < 0 || paragraphSpacingPt > 36) {
    throw new BiddingError('render config paragraphSpacingPt must be between 0 and 36', { code: 'VALIDATION_ERROR' })
  }
  if (marginsMm < 10 || marginsMm > 50) {
    throw new BiddingError('render config marginsMm must be between 10 and 50', { code: 'VALIDATION_ERROR' })
  }
  return {
    headerText,
    footerText,
    pageNumbers,
    bodyFontFamily,
    headingFontFamily,
    fontSizePt,
    lineSpacing,
    paragraphSpacingPt,
    marginsMm,
  }
}

/**
 * Render a bid draft to `.docx` bytes.
 * @param draft - the normalized draft.
 * @param configValue - user-supplied render options.
 * @param limits - resource limits.
 * @returns the complete OOXML ZIP archive bytes.
 * @throws BiddingError `LIMIT_EXCEEDED` when the output exceeds
 * `limits.maxOutputBytes`.
 */
export function renderBidDocx(draft: BidDraft, configValue: unknown, limits: Limits): Uint8Array {
  const config = resolveRenderConfig(configValue)
  const bytes = renderDocx(draft, config)
  if (bytes.byteLength > limits.maxOutputBytes) {
    throw new BiddingError(`rendered document is ${String(bytes.byteLength)} bytes, exceeding the ${String(limits.maxOutputBytes)}-byte cap`, {
      code: 'LIMIT_EXCEEDED',
      details: { measured: bytes.byteLength, cap: limits.maxOutputBytes, recovery: 'shorten the draft or raise maxOutputBytes' },
    })
  }
  return bytes
}
