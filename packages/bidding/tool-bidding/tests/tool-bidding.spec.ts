import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { DEFAULT_RENDER_CONFIG, renderDocx } from '@deepseek-ai/dsh-bidding'
import type { BidDraft } from '@deepseek-ai/dsh-bidding'
import * as toolBidding from '@deepseek-ai/dsh-tool-bidding'
import * as toolInvariant from '../src/invariant.ts'

const testToolSignal = new AbortController().signal

/** Temporary directories created during the run. */
const tempDirs: string[] = []

/** Create a temp directory tracked for cleanup. */
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tool-bidding-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => {})
  }
})

/** A tender-shaped draft whose render output feeds the parse tool. */
const TENDER_FIXTURE: BidDraft = {
  tender: { projectName: '示例采购项目', tenderNo: 'DSH-2026-777', purchaser: '示例采购人' },
  sections: [
    {
      title: '招标公告', level: 1, status: 'drafted',
      content: '项目名称：示例采购项目\n\n招标编号：DSH-2026-777\n\n采购人：示例采购人',
    },
    {
      title: '投标人须知', level: 1, status: 'drafted',
      content: '未按要求加盖公章的投标文件视为无效投标。\n\n实质性要求：投标有效期90天。',
    },
    {
      title: '评分办法', level: 1, status: 'drafted',
      content: [
        '评分采用综合评分法，总分为100分。',
        '',
        '| 条款 | 评分标准 | 分值 |',
        '| --- | --- | --- |',
        '| 技术方案 | 技术方案完整性、先进性 | 40分 |',
        '| 售后服务 | 售后服务响应时间与网点 | 20分 |',
      ].join('\n'),
    },
  ],
}

/** Base64 tender docx consumed by the parse tool's data channel. */
const TENDER_BASE64 = (() => {
  const bytes = renderDocx(TENDER_FIXTURE, DEFAULT_RENDER_CONFIG)
  return Buffer.from(bytes).toString('base64')
})()

/** A minimal bid draft used by assemble/render/compare tools. */
const BID_DRAFT = {
  templateId: 'goods',
  tender: { projectName: '示例采购项目' },
  sections: [
    { title: '第一章 投标函', level: 1, status: 'drafted', content: '致招标人的投标函正文。' },
    { title: '第二章 技术方案', level: 1, status: 'drafted', content: '技术方案完整先进，提供实施方案。' },
  ],
}

/** Mount ToolRuntime, a real local fs, and the bidding tool plugin. */
async function harness(config: toolBidding.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: await tempRoot() })
  const fiber = await ctx.plugin(toolBidding, config)
  return { ctx, fiber }
}

let callCounter = 0
/** Dispatch one registered tool through the real runtime. */
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

/** Assert success and return the canonical JSON value. */
function resultJson(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected tool success')
  return result.value as Record<string, unknown>
}

/** Join the text blocks of one tool result. */
function resultText(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('tool-bidding plugin shape', () => {
  it('has the Loader-safe namespace export shape', () => {
    expect((toolBidding as { default?: unknown }).default).toBeUndefined()
    expect(toolBidding.name).toBe('tool-bidding')
    expect(toolBidding.inject).toEqual(['tools', 'fs'])
  })

  it('registers seven bidding tools and disposes all contributions', async () => {
    const { ctx, fiber } = await harness()
    const names = ctx.tools.schemas()
      .map(schema => schema.name)
      .filter(name => name.startsWith('bidding_'))
      .sort()
    expect(names).toEqual([
      'bidding_assemble_draft', 'bidding_compare', 'bidding_list_templates',
      'bidding_parse_tender', 'bidding_render_docx', 'bidding_save_material',
      'bidding_search_materials',
    ])
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'bidding_parse_tender')).toBe(false)
  })

  it('resolves resource-limit defaults on direct apply', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: await tempRoot() })
    // Bypass Loader normalization so every limit field stays undefined and the
    // per-field defaults in resolveConfig are taken.
    toolBidding.apply(ctx, {})
    const result = await call(ctx, 'bidding_list_templates', {})
    expect(result.isError).toBe(false)
  })
})

describe('bidding_parse_tender', () => {
  it('parses base64 tender bytes into the structured projection', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'bidding_parse_tender', { dataBase64: TENDER_BASE64, fileName: 'tender.docx' })
    const value = resultJson(result)
    expect(value.sectionCount).toBeGreaterThanOrEqual(2)
    expect(value.scoringCount).toBe(2)
    expect(value.fatalClauseCount).toBeGreaterThanOrEqual(1)
    const tender = value.tender as { meta: { projectName?: string }; scoring: { clause: string }[] }
    expect(tender.meta.projectName).toBe('示例采购项目')
    expect(tender.scoring.map(item => item.clause)).toContain('技术方案')
    expect(resultText(result)).toContain('Parsed tender')
  })

  it('rejects a call without path or data', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'bidding_parse_tender', {})
    expect(result.isError).toBe(true)
  })

  it('reads a workspace file through the sandboxed fs', async () => {
    const cwd = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd })
    await ctx.plugin(toolBidding, {})
    await writeFile(join(cwd, 'tender.docx'), Buffer.from(renderDocx(TENDER_FIXTURE, DEFAULT_RENDER_CONFIG)))
    const result = await call(ctx, 'bidding_parse_tender', { path: 'tender.docx' })
    const value = resultJson(result)
    expect(value.scoringCount).toBe(2)
    // The sidecar lands next to the source inside the workspace.
    expect(value.sidecarPath).toBe('tender.docx.extracted.md')
  })
})

describe('bidding_list_templates', () => {
  it('lists the four shipped templates with an empty user root', async () => {
    const { ctx } = await harness({ templateUserRoot: await tempRoot() })
    const result = await call(ctx, 'bidding_list_templates', {})
    const value = resultJson(result)
    expect((value.templates as unknown[]).length).toBe(4)
    expect(value.broken).toEqual([])
    expect(resultText(result)).toContain('Found 4 templates')
  })

  it('merges user templates and reports broken files', async () => {
    const userRoot = await tempRoot()
    await writeFile(join(userRoot, 'custom.json'), JSON.stringify({
      id: 'custom-center', name: '自定义交易中心模板', category: 'goods',
      chapters: [{ id: 'c1', level: 1, title: '第一章 投标函', required: true }],
    }))
    await writeFile(join(userRoot, 'broken.json'), '{ not json')
    const { ctx } = await harness({ templateUserRoot: userRoot })
    const result = await call(ctx, 'bidding_list_templates', {})
    const value = resultJson(result)
    const templates = value.templates as { id: string }[]
    expect(templates.map(template => template.id)).toContain('custom-center')
    const broken = value.broken as { file: string; reason: string }[]
    expect(broken).toHaveLength(1)
    expect(broken[0]?.file).toBe('broken.json')
    expect(typeof broken[0]?.reason).toBe('string')
  })
})

describe('bidding_save_material and bidding_search_materials', () => {
  it('saves then searches materials in the persistent library', async () => {
    const { ctx } = await harness({ materialRoot: await tempRoot() })
    const saved = resultJson(await call(ctx, 'bidding_save_material', {
      category: 'performance-proof',
      title: '某市智慧园区业绩',
      content: '2025年完成的智慧园区系统集成项目，合同额 500 万元，含验收证明。',
      tags: ['业绩', '智慧园区'],
      source: '2025年度投标',
    }))
    expect(saved.category).toBe('performance-proof')
    expect(typeof saved.materialId).toBe('string')

    const hits = resultJson(await call(ctx, 'bidding_search_materials', { query: '智慧园区' }))
    expect(hits.count).toBe(1)
    const first = (hits.hits as { title: string; preview: string }[])[0]!
    expect(first.title).toBe('某市智慧园区业绩')
    expect(first.preview).toContain('500')
    expect(resultText(await call(ctx, 'bidding_search_materials', { query: '智慧园区' }))).toContain('Matched 1 material(s)')

    const miss = resultJson(await call(ctx, 'bidding_search_materials', { query: '不存在关键词xyz' }))
    expect(miss.count).toBe(0)
  })

  it('rejects an empty material content', async () => {
    const { ctx } = await harness({ materialRoot: await tempRoot() })
    const result = await call(ctx, 'bidding_save_material', { category: 'technical-proposal', title: 't', content: '   ' })
    expect(result.isError).toBe(true)
  })
})

describe('bidding_assemble_draft', () => {
  it('assembles a draft against a shipped template', async () => {
    const { ctx } = await harness({ templateUserRoot: await tempRoot() })
    const result = await call(ctx, 'bidding_assemble_draft', { draft: BID_DRAFT })
    const value = resultJson(result)
    expect(value.sectionCount).toBe(2)
    const report = value.report as { errors: unknown[]; warnings: unknown[] }
    expect(report.errors).toEqual([])
    expect(resultText(result)).toContain('Assembled draft with 2 sections')
  })

  it('reports missing required chapters from the template', async () => {
    const { ctx } = await harness({ templateUserRoot: await tempRoot() })
    const result = await call(ctx, 'bidding_assemble_draft', {
      draft: { ...BID_DRAFT, sections: [BID_DRAFT.sections[0]] },
    })
    const value = resultJson(result)
    // Required-chapter coverage is a dedicated report field, not a warning.
    const report = value.report as { missingChapterTitles: string[] }
    expect(report.missingChapterTitles.length).toBeGreaterThan(0)
  })

  it('rejects a draft with no sections', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'bidding_assemble_draft', {
      draft: { tender: {}, sections: [] },
    })
    expect(result.isError).toBe(true)
  })
})

describe('bidding_render_docx', () => {
  it('renders a base64 docx with checksum', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'bidding_render_docx', { draft: BID_DRAFT })
    const value = resultJson(result)
    expect(value.format).toBe('docx')
    expect(value.bytes as number).toBeGreaterThan(1000)
    expect(typeof value.checksum).toBe('string')
    const decoded = Buffer.from(value.dataBase64 as string, 'base64')
    expect(decoded.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(value.fileName).toBe('示例采购项目.docx')
    expect(resultText(result)).toContain('Rendered')
  })

  it('falls back to a generic file name without a project name', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'bidding_render_docx', {
      draft: { tender: {}, sections: [{ title: '第一章 投标函', level: 1, status: 'drafted', content: '正文。' }] },
    })
    const value = resultJson(result)
    expect(value.fileName).toBe('bid-document.docx')
  })
})

describe('bidding_compare', () => {
  it('compares a draft against a tender projection', async () => {
    const { ctx } = await harness()
    const parsed = resultJson(await call(ctx, 'bidding_parse_tender', { dataBase64: TENDER_BASE64, fileName: 'tender.docx' }))
    const result = await call(ctx, 'bidding_compare', { tender: parsed.tender, draft: BID_DRAFT })
    const value = resultJson(result)
    const report = value.report as {
      coverage: { clause: string; status: string }[]
      totals: { scoringItems: number }
      summary: string
    }
    expect(report.totals.scoringItems).toBe(2)
    const technical = report.coverage.find(item => item.clause === '技术方案')!
    expect(technical.status).toBe('covered')
    expect(report.summary).toContain('确定性初筛')
    expect(resultText(result)).toContain('确定性初筛')
  })

  it('requires draft or bidPath', async () => {
    const { ctx } = await harness()
    const parsed = resultJson(await call(ctx, 'bidding_parse_tender', { dataBase64: TENDER_BASE64, fileName: 'tender.docx' }))
    const result = await call(ctx, 'bidding_compare', { tender: parsed.tender })
    expect(result.isError).toBe(true)
  })
})

describe('tool call presentation', () => {
  it('declares a generic pending card for every bidding tool', async () => {
    const { ctx } = await harness()
    const cases: [string, string, unknown][] = [
      ['bidding_parse_tender', 'Parse tender document', { dataBase64: 'x' }],
      ['bidding_list_templates', 'List bid templates', {}],
      ['bidding_save_material', 'Save bidding material', { category: 'c', title: 't', content: 'x' }],
      ['bidding_search_materials', 'Search bidding materials', { query: 'q' }],
      ['bidding_assemble_draft', 'Assemble bid draft', { draft: BID_DRAFT }],
      ['bidding_render_docx', 'Render bid document', { draft: BID_DRAFT }],
      ['bidding_compare', 'Compare tender and bid', { tender: {}, draft: BID_DRAFT }],
    ]
    for (const [name, title, args] of cases) {
      const definition = ctx.tools.get(name)!
      expect(definition.presentCall?.(args as never)).toEqual({
        card: 'generic',
        title,
        kind: 'other',
        rawInput: args,
      })
    }
  })
})

describe('tool-bidding invariant companion', () => {
  it('registers and disposes the package invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(toolInvariant)
    await fiber.dispose()
  })
})
