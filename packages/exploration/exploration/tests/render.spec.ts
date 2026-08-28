import { describe, expect, it } from 'vitest'
import { palette, rgbToHex } from '../src/render/colormap.ts'
import { encodePng, toBase64 } from '../src/render/png.ts'
import { buildSection, rasterize } from '../src/render/section.ts'
import { svgFromSection } from '../src/render/svg.ts'
import * as profile from '../src/processors/profile.ts'
import type { CellType, CellValue, Dataset } from '../src/types.ts'

function ds(columns: Array<{ name: string; type?: CellType }>, rows: unknown[][]): Dataset {
  return {
    columns: columns.map(c => ({ name: c.name, type: c.type ?? 'number' })),
    rows: rows as CellValue[][],
    meta: {},
  }
}

/** Long-format SEG-Y section: 2 traces x 3 samples, distinct amplitudes. */
const LONG = ds(
  [{ name: 'trace' }, { name: 'sampleIndex' }, { name: 'value' }],
  [
    [0, 0, -1], [0, 1, 0], [0, 2, 1],
    [1, 0, 0], [1, 1, 1], [1, 2, 2],
  ],
)

/** Short-format section: 2 traces x 2 `sample_*` columns. */
const SHORT = ds(
  [{ name: 'trace' }, { name: 'sample_0' }, { name: 'sample_1' }],
  [
    [0, -1, 0],
    [1, 0, 1],
  ],
)

describe('color maps', () => {
  it('builds 256-entry palettes for every named color map', () => {
    for (const name of ['seismic', 'grayscale', 'jet'] as const) {
      const pal = palette(name)
      expect(pal).toHaveLength(256)
      expect(pal[0]).toHaveLength(3)
      expect(pal[255]?.[0]).toBeGreaterThanOrEqual(0)
    }
    // seismic is a diverging blue→white→red ramp: dark blue low end, near-white
    // midpoint, dark red high end.
    expect(palette('seismic')[0]).toEqual([0, 0, 88])
    expect(palette('seismic')[255]).toEqual([88, 0, 0])
    expect(palette('seismic')[128]!.every(channel => channel >= 250)).toBe(true)
    // grayscale is a linear black→white ramp.
    expect(palette('grayscale')[0]).toEqual([0, 0, 0])
    expect(palette('grayscale')[255]).toEqual([255, 255, 255])
  })

  it('formats RGB tuples as lowercase hex', () => {
    expect(rgbToHex([0, 0, 88])).toBe('#000058')
    expect(rgbToHex([255, 255, 255])).toBe('#ffffff')
    expect(rgbToHex([12, 34, 56])).toBe('#0c2238')
  })
})

describe('PNG encoder', () => {
  it('encodes an indexed-color PNG with the expected signature and chunks', () => {
    const pal = palette('grayscale')
    const pixels = new Uint8Array([0, 127, 255])
    const png = encodePng(3, 1, pixels, pal)
    expect(png.subarray(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    // IHDR declares 3x1, 8-bit indexed color.
    const width = new DataView(png.buffer, png.byteOffset + 16, 4).getUint32(0, false)
    const height = new DataView(png.buffer, png.byteOffset + 20, 4).getUint32(0, false)
    expect([width, height]).toEqual([3, 1])
    expect(png[png.byteOffset + 25]).toBe(3) // color type: indexed
    // IEND terminates the file.
    expect(new TextDecoder().decode(png.subarray(-8, -4))).toBe('IEND')
  })

  it('encodes base64 text from arbitrary bytes', () => {
    expect(toBase64(new Uint8Array([0x00, 0x01]))).toBe('AAE=')
    expect(toBase64(new Uint8Array([0x48, 0x69]))).toBe('SGk=')
  })
})

describe('section building', () => {
  it('builds a section from SEG-Y long format', () => {
    const section = buildSection(LONG)
    expect(section.kind).toBe('seismic')
    expect(section.traceCount).toBe(2)
    expect(section.sampleCount).toBe(3)
    expect(section.min).toBe(-1)
    expect(section.max).toBe(2)
    expect(section.values).toHaveLength(6)
    expect(section.values[0]).toBe(-1) // trace 0, sample 0
    expect(section.xLabel).toBe('trace')
    expect(section.yLabel).toBe('sample')
  })

  it('fills missing cells with 0 and skips unusable rows', () => {
    const ragged = ds(
      [{ name: 'trace' }, { name: 'sampleIndex' }, { name: 'value' }],
      [
        [0, 0, null],
        ['x', 1, 5],
        [1, -1, 5],
        [1, 1, 3],
      ],
    )
    const section = buildSection(ragged)
    expect(section.traceCount).toBe(2)
    expect(section.sampleCount).toBe(2)
    expect(section.values[0]).toBe(0) // missing value filled with 0
    expect(section.min).toBe(3)
    expect(section.max).toBe(3)
  })

  it('builds a section from short format sample columns', () => {
    const section = buildSection(SHORT)
    expect(section.traceCount).toBe(2)
    expect(section.sampleCount).toBe(2)
    expect(section.min).toBe(-1)
    expect(section.max).toBe(1)
    expect(section.values[0]).toBe(-1)
    expect(section.values[3]).toBe(1)
  })

  it('raises INCOMPLETE_DATA for non-seismic, empty, or all-null datasets', () => {
    expect(() => buildSection(ds([{ name: 'a' }], [[1]]))).toThrow(/no seismic columns/)
    expect(() => buildSection(ds(
      [{ name: 'trace' }, { name: 'sampleIndex' }, { name: 'value' }],
      [['x', 0, 1]],
    ))).toThrow(/no usable trace\/sample rows/)
    expect(() => buildSection(ds(
      [{ name: 'trace' }, { name: 'sampleIndex' }, { name: 'value' }],
      [[0, 0, null]],
    ))).toThrow(/no finite amplitude/)
    expect(() => buildSection(ds(
      [{ name: 'trace' }, { name: 'sample_0' }],
      [],
    ))).toThrow(/no rows/)
  })

  it('raises INCOMPLETE_DATA for short format with no finite amplitudes', () => {
    expect(() => buildSection(ds(
      [{ name: 'trace' }, { name: 'sample_0' }],
      [[0, null]],
    ))).toThrow(/no finite amplitude/)
  })

  it('rasterizes a section into palette indices', () => {
    const section = buildSection(LONG)
    const raster = rasterize(section, 4, 2)
    expect(raster).toHaveLength(8)
    expect(raster.every(index => index >= 0 && index <= 255)).toBe(true)
  })

  it('maps a constant section to the palette midpoint', () => {
    const constant = buildSection(ds(
      [{ name: 'trace' }, { name: 'sampleIndex' }, { name: 'value' }],
      [[0, 0, 5], [1, 0, 5]],
    ))
    expect(constant.min).toBe(5)
    expect(constant.max).toBe(5)
    const raster = rasterize(constant, 2, 1)
    expect(raster).toEqual(new Uint8Array([128, 128]))
  })
})

describe('SVG rendering', () => {
  const section = buildSection(LONG)

  it('embeds the raster as a PNG data URI with axis labels and color bar', () => {
    const svg = svgFromSection(section, palette('seismic'), 100, 80)
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"')
    expect(svg).toContain('data:image/png;base64,')
    expect(svg).toContain('<image href="data:image/png;base64,')
    expect(svg).toContain('id="colorbar"')
    expect(svg).toContain('trace')
    expect(svg).toContain('sample')
    expect(svg).toContain('</svg>')
  })

  it('renders an optional title with XML escaping', () => {
    const svg = svgFromSection(section, palette('jet'), 100, 80, 'Line <1> & "A"')
    expect(svg).toContain('<title>Line &lt;1&gt; &amp; &quot;A&quot;</title>')
    expect(svg).toContain('Line &lt;1&gt;')
  })

  it('formats amplitude labels without trailing precision noise', () => {
    const svg = svgFromSection(section, palette('grayscale'), 100, 80)
    expect(svg).toContain('>-1</text>')
    expect(svg).toContain('>2</text>')
  })
})

describe('profile processor', () => {
  it('validates every option and rejects misconfiguration', () => {
    expect(profile.validate(undefined)).toEqual({})
    expect(profile.validate({
      formats: ['png', 'svg'],
      width: 320,
      height: 240,
      colorMap: 'jet',
      title: 'sect',
    })).toEqual({ formats: ['png', 'svg'], width: 320, height: 240, colorMap: 'jet', title: 'sect' })
    expect(() => profile.validate({ formats: [] })).toThrow(/must not be empty/)
    expect(() => profile.validate({ formats: ['bmp'] })).toThrow(/must be one of/)
    expect(() => profile.validate({ width: 0 })).toThrow(/positive integer/)
    expect(() => profile.validate({ width: 2048 })).toThrow(/must not exceed 1024/)
    expect(() => profile.validate({ colorMap: 'magma' })).toThrow(/must be one of/)
    expect(() => profile.validate({ title: 42 })).toThrow(/non-empty string/)
    expect(() => profile.validate({ nope: true })).toThrow(/unknown profile option/)
  })

  it('renders both formats by default and attaches the profile to meta', () => {
    const result = profile.run(LONG, {})
    const output = result.dataset.meta.profile as Record<string, unknown>
    expect(output.kind).toBe('seismic')
    expect(output.formats).toEqual(['svg', 'png'])
    expect(output.width).toBe(640)
    expect(output.height).toBe(480)
    expect(output.colorMap).toBe('seismic')
    expect(output.traceCount).toBe(2)
    expect(output.sampleCount).toBe(3)
    expect(typeof output.svg).toBe('string')
    expect(typeof output.png).toBe('string')
    expect(result.dataset.meta.rowCount).toBe(6)
    expect(result.notes).toHaveLength(2)
    expect(result.notes[0]).toContain('rendered svg profile')
    expect(result.notes[1]).toContain('rendered png profile')
  })

  it('renders a single format when requested and carries the title', () => {
    const onlyPng = profile.run(LONG, { formats: ['png'], width: 16, height: 8, colorMap: 'grayscale', title: 't' })
    const pngProfile = onlyPng.dataset.meta.profile as Record<string, unknown>
    expect(pngProfile.formats).toEqual(['png'])
    expect(pngProfile.title).toBe('t')
    expect(typeof pngProfile.png).toBe('string')
    expect('svg' in pngProfile).toBe(false)
    expect(onlyPng.notes).toEqual([expect.stringContaining('rendered png profile')])

    const onlySvg = profile.run(LONG, { formats: ['svg'], width: 16, height: 8 })
    const svgProfile = onlySvg.dataset.meta.profile as Record<string, unknown>
    expect(svgProfile.formats).toEqual(['svg'])
    expect(typeof svgProfile.svg).toBe('string')
    expect('png' in svgProfile).toBe(false)
  })

  it('preserves non-reserved meta keys and refreshes rowCount', () => {
    const input: Dataset = {
      columns: LONG.columns,
      rows: LONG.rows,
      meta: { source: 'f.sgy', rowCount: 99, provenance: ['ingest (ingest)'] },
    }
    const result = profile.run(input, {})
    expect(result.dataset.meta.source).toBe('f.sgy')
    expect(result.dataset.meta.rowCount).toBe(6)
    expect(result.dataset.meta.provenance).toBeUndefined()
  })

  it('fails loud on incomplete datasets with the INCOMPLETE_DATA code', () => {
    let thrown: unknown
    try {
      profile.run(ds([{ name: 'a' }], [[1]]), {})
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as { code?: string }).code).toBe('INCOMPLETE_DATA')
  })
})
