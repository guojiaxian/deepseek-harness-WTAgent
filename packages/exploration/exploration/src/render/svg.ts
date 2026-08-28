/**
 * SVG rendering of a seismic section.
 *
 * The raster is embedded as a PNG data URI inside an `<image>` element, so the
 * SVG stays a single self-contained document viewable in any SVG-capable
 * browser or illustration tool and importable by professional geology
 * software that accepts SVG. Vector overlay elements (title, axis labels, and
 * a color bar with min/max amplitude labels) stay crisp at any zoom.
 * @module @deepseek-ai/dsh-exploration
 */

import { rgbToHex } from './colormap.ts'
import type { RGB } from './colormap.ts'
import { encodePng, toBase64 } from './png.ts'
import { rasterize } from './section.ts'
import type { SectionModel } from './section.ts'

/** Color bar gradient sample positions used for the SVG stops. */
const GRADIENT_POSITIONS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1] as const

/**
 * Render a section as a self-contained SVG document.
 * @param section - section to render.
 * @param palette - color map palette (256 entries).
 * @param width - raster width in pixels.
 * @param height - raster height in pixels.
 * @param title - optional document title, rendered as an overlay label.
 * @returns the SVG markup.
 */
export function svgFromSection(
  section: SectionModel,
  palette: readonly RGB[],
  width: number,
  height: number,
  title?: string,
): string {
  const raster = toBase64(encodePng(width, height, rasterize(section, width, height), palette))
  const barX = width - 180
  const barY = height - 34
  const barW = 150
  const barH = 14
  const lines: string[] = []
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`)
  if (title !== undefined) {
    lines.push(`<title>${escapeXml(title)}</title>`)
    lines.push(`<text x="${width / 2}" y="24" font-size="20" font-weight="bold" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="0.5">${escapeXml(title)}</text>`)
  }
  lines.push(`<image href="data:image/png;base64,${raster}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`)
  lines.push(`<defs><linearGradient id="colorbar" x1="0" y1="0" x2="1" y2="0">${gradientStops(palette)}</linearGradient></defs>`)
  lines.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="url(#colorbar)" stroke="#000000"/>`)
  lines.push(`<text x="${barX}" y="${barY - 4}" font-size="10" fill="#ffffff" stroke="#000000" stroke-width="0.5">${formatAmplitude(section.min)}</text>`)
  lines.push(`<text x="${barX + barW}" y="${barY - 4}" font-size="10" text-anchor="end" fill="#ffffff" stroke="#000000" stroke-width="0.5">${formatAmplitude(section.max)}</text>`)
  lines.push(`<text x="8" y="${height - 8}" font-size="10" fill="#ffffff" stroke="#000000" stroke-width="0.5">${escapeXml(section.xLabel)}</text>`)
  lines.push(`<text x="14" y="${height / 2}" font-size="10" fill="#ffffff" stroke="#000000" stroke-width="0.5" transform="rotate(-90 14 ${height / 2})">${escapeXml(section.yLabel)}</text>`)
  lines.push('</svg>')
  return lines.join('\n')
}

/** SVG `<stop>` elements sampling the palette at evenly spaced positions. */
function gradientStops(palette: readonly RGB[]): string {
  return GRADIENT_POSITIONS.map((position) => {
    const index = Math.round(position * (palette.length - 1))
    return `<stop offset="${(position * 100).toFixed(2)}%" stop-color="${rgbToHex(palette[index] as RGB)}"/>`
  }).join('')
}

/** Format an amplitude label, stripping trailing zeros from the precision. */
function formatAmplitude(value: number): string {
  return String(Number(value.toPrecision(4)))
}

/** Escape text for XML element content and attributes. */
function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, char => XML_ESCAPES[char] as string)
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}
