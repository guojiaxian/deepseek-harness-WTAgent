import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LIMITS, resolveLimits } from '../src/types.ts'
import type { BidDraft, TenderDocument } from '../src/types.ts'
import { parseBidDocument, parseTender as parseTenderDocument, renderTenderMarkdown } from '../src/processors/parse-tender.ts'
import { listTemplates, loadTemplate } from '../src/processors/template.ts'
import { loadMaterial, loadMaterials, saveMaterial, searchMaterials } from '../src/processors/material.ts'
import { assembleDraft } from '../src/processors/draft.ts'
import { renderBidDocx, resolveRenderConfig } from '../src/processors/render.ts'
import { compareTenderDraft } from '../src/processors/compare.ts'
import { parseDocx } from '../src/format/docx-read.ts'
import { renderDocx } from '../src/format/docx-write.ts'
import { DEFAULT_RENDER_CONFIG } from '../src/processors/render.ts'
import type { RawDocument } from '../src/format/docx-read.ts'

/** Temporary directories created during the run. */
const tempDirs: string[] = []

/** Create a temp directory tracked for cleanup. */
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bidding-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => {})
  }
})

/** A paragraph-only raw document from plain lines. */
function paragraphs(...lines: string[]): RawDocument {
  return { blocks: lines.map(line => ({ kind: 'paragraph' as const, text: line })) }
}

/** A rendered tender fixture: meta section, requirements, scoring table. */
function buildTenderFixture(): Uint8Array {
  const draft: BidDraft = {
    tender: { projectName: '示例采购项目', tenderNo: 'DSH-2026-777', purchaser: '示例采购人' },
    sections: [
      {
        title: '招标公告', level: 1, status: 'drafted',
        content: [
          '项目名称：示例采购项目',
          '招标编号：DSH-2026-777',
          '采购人：示例采购人',
          '代理机构：示例代理机构',
          '投标文件递交截止时间：2026年10月1日09:30',
          '投标保证金：人民币贰万元整',
          '资质要求：具备ISO9001质量管理体系认证证书',
          '交付时间：合同签订后90日内交付',
        ].join('\n\n'),
      },
      {
        title: '投标人须知', level: 1, status: 'drafted',
        content: [
          '逾期送达投标文件的，招标人将拒收，作无效投标处理。',
          '未按要求加盖公章的投标文件视为无效投标。',
          '实质性要求：投标有效期90天，自开标之日起计算。',
          '投标文件正本一份副本四份，胶装装订，逐页编码。',
        ].join('\n\n'),
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
          '| 类似业绩 | 近三年类似项目合同业绩 | 15分 |',
          '| 商务条款 | 付款方式与合同条款响应 | 10分 |',
        ].join('\n'),
      },
      { title: '合同条款', level: 1, status: 'drafted', content: '付款方式：验收合格后30日内支付。' },
    ],
  }
  return renderDocx(draft, DEFAULT_RENDER_CONFIG)
}

describe('parseTender', () => {
  it('projects a rendered tender docx: chapters, scoring, fatal clauses, meta', () => {
    const raw = parseDocx(buildTenderFixture(), 1000)
    const tender = parseTenderDocument(raw, DEFAULT_LIMITS)

    expect(tender.sections.map(section => section.title)).toContain('招标公告')
    expect(tender.sections.map(section => section.title)).toContain('评分办法')
    for (const section of tender.sections) {
      expect(section.level).toBe(1)
      expect(section.charCount).toBeGreaterThan(0)
    }

    expect(tender.scoring.length).toBe(4)
    const technical = tender.scoring.find(item => item.clause === '技术方案')
    expect(technical).toBeDefined()
    expect(technical!.points).toBe(40)
    expect(technical!.category).toBe('technical')
    const price = tender.scoring.find(item => item.clause === '类似业绩')
    expect(price!.category).toBe('qualification')

    expect(tender.fatalClauses.length).toBeGreaterThanOrEqual(2)
    expect(tender.fatalClauses.some(clause => clause.kind === 'disqualification')).toBe(true)
    expect(tender.fatalClauses.some(clause => clause.kind === 'mandatory')).toBe(true)

    expect(tender.formatRequirements.length).toBeGreaterThanOrEqual(1)

    expect(tender.meta.projectName).toBe('示例采购项目')
    expect(tender.meta.tenderNo).toBe('DSH-2026-777')
    expect(tender.meta.purchaser).toBe('示例采购人')
    expect(tender.meta.agency).toBe('示例代理机构')
    expect(tender.meta.deadline).toContain('2026')
    expect(tender.meta.bond).toContain('贰万')
    expect(tender.meta.qualification?.length).toBeGreaterThan(0)
    expect(tender.meta.deliverables?.length).toBeGreaterThan(0)
  })

  it('detects chapters through CJK numbering without styles', () => {
    const raw = paragraphs(
      '第一章 总则', '正文一。', '第二章 评标办法', '正文二。',
      '一、投标须知', '小节内容。', '（一）资格条件', '更小节内容。', '3.1 评分细则', '编号小节内容。',
    )
    const tender = parseTenderDocument(raw, DEFAULT_LIMITS)
    const titles = tender.sections.map(section => section.title)
    expect(titles).toEqual(['总则', '评标办法', '投标须知', '资格条件', '评分细则'])
    const levels = tender.sections.map(section => section.level)
    expect(levels).toEqual([1, 1, 1, 2, 2])
  })

  it('falls back to list-mode scoring without a scoring chapter', () => {
    const raw = paragraphs('一、项目概述', '本项目技术方案占40分。', '业绩占15分。')
    const tender = parseTenderDocument(raw, DEFAULT_LIMITS)
    expect(tender.scoring.length).toBe(2)
    expect(tender.warnings.some(warning => warning.includes('未找到评分办法章节'))).toBe(true)
  })

  it('warns when a scoring chapter yields no items', () => {
    const raw = paragraphs('一、评分办法', '详见附件。', '二、其他', '无。')
    const tender = parseTenderDocument(raw, DEFAULT_LIMITS)
    expect(tender.scoring).toEqual([])
    expect(tender.warnings.some(warning => warning.includes('未解析出评分点'))).toBe(true)
    expect(tender.warnings.some(warning => warning.includes('未识别到废标'))).toBe(true)
  })

  it('caps sections and warnings', () => {
    const many = Array.from({ length: 6 }, (_, index) => `第${index + 1}章 标题`)
    const raw = paragraphs(...many)
    expect(() => parseTenderDocument(raw, resolveLimits({ maxSections: 3 }))).toThrow(/section count exceeds/)
    expect(() => parseTenderDocument(paragraphs('一、a'), resolveLimits({ maxWarnings: 0 }))).not.toThrow()
  })

  it('renders a Markdown sidecar with meta header and tables', () => {
    const raw = parseDocx(buildTenderFixture(), 1000)
    const tender = parseTenderDocument(raw, DEFAULT_LIMITS)
    const markdown = renderTenderMarkdown(raw, tender)
    expect(markdown.startsWith('# 招标文件全文提取')).toBe(true)
    expect(markdown).toContain('- 项目名称：示例采购项目')
    expect(markdown).toContain('| 条款 |')
  })
})

describe('parseBidDocument', () => {
  it('projects a finished bid docx into a draft', () => {
    const bytes = renderDocx({
      tender: { projectName: 'p' },
      sections: [
        { title: '第一章 方案', level: 1, content: '内容段落。', status: 'drafted' },
        { title: '1.1 细则', level: 2, content: '细则内容。', status: 'drafted' },
      ],
    }, DEFAULT_RENDER_CONFIG)
    const draft = parseBidDocument(parseDocx(bytes, 100), DEFAULT_LIMITS)
    expect(draft.sections.length).toBe(2)
    expect(draft.sections[0]!.title).toContain('方案')
    expect(draft.sections[1]!.level).toBe(2)
    expect(draft.sections[1]!.content).toContain('细则内容')
  })

  it('enforces the section cap', () => {
    const raw = paragraphs(...Array.from({ length: 10 }, (_, index) => `第${index + 1}章 t`))
    expect(() => parseBidDocument(raw, resolveLimits({ maxSections: 3 }))).toThrow(/section count/)
  })
})

describe('template discovery', () => {
  it('merges shipped and user roots with first-wins shadowing', async () => {
    const root = await tempRoot()
    await writeFile(join(root, 'custom.json'), JSON.stringify({
      id: 'my-template', name: '自定', category: 'custom',
      chapters: [{ id: 'c1', level: 1, title: '章', required: true }],
    }), 'utf8')
    // Same id as a shipped template: shipped wins, user copy is shadowed.
    await writeFile(join(root, 'goods.json'), JSON.stringify({
      id: 'goods', name: '阴影副本', chapters: [{ id: 'x', level: 1, title: 'y', required: false }],
    }), 'utf8')
    await writeFile(join(root, 'broken.json'), '{ not json', 'utf8')

    const discovery = await listTemplates(root)
    const ids = discovery.templates.map(template => template.id)
    expect(ids).toContain('government-procurement')
    expect(ids).toContain('my-template')
    expect(ids.filter(id => id === 'goods')).toHaveLength(1)
    expect(discovery.templates.find(template => template.id === 'goods')!.name).toBe('货物采购标书（通用）')
    expect(discovery.broken.map(file => file.file)).toEqual(['broken.json'])
  })

  it('treats a missing user root as empty and loadTemplate throws NOT_FOUND', async () => {
    const root = await tempRoot()
    const discovery = await listTemplates(join(root, 'absent'))
    expect(discovery.templates.length).toBe(4)
    expect(discovery.broken).toEqual([])
    await expect(loadTemplate('nope', root)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' })
    await expect(loadTemplate('goods', root)).resolves.toMatchObject({ id: 'goods' })
  })
})

describe('material library', () => {
  it('saves, reloads, and searches materials', async () => {
    const root = await tempRoot()
    const saved = await saveMaterial(root, {
      category: 'Company Qualification',
      title: 'ISO9001 认证说明',
      content: '公司通过 ISO9001 质量管理体系认证。',
      tags: ['资质', 'ISO'],
      source: '示例项目',
    }, DEFAULT_LIMITS)
    expect(saved.id).toMatch(/^m-[0-9a-f]{16}$/)
    expect(saved.category).toBe('company-qualification')

    const reloaded = await loadMaterial(root, saved.id)
    expect(reloaded.title).toBe('ISO9001 认证说明')

    const hits = await searchMaterials(root, { query: 'iso9001' }, DEFAULT_LIMITS)
    expect(hits.length).toBe(1)
    expect(hits[0]!.preview).toContain('质量管理体系')

    const full = await searchMaterials(root, { query: 'iso9001', includeContent: true }, DEFAULT_LIMITS)
    expect(full[0]!.preview).toBeUndefined()

    const categoryHits = await searchMaterials(root, { category: 'company-qualification' }, DEFAULT_LIMITS)
    expect(categoryHits.length).toBe(1)
    const tagMiss = await searchMaterials(root, { tags: ['nope'] }, DEFAULT_LIMITS)
    expect(tagMiss).toEqual([])
  })

  it('rejects empty categories and oversized content', async () => {
    const root = await tempRoot()
    await expect(saveMaterial(root, { category: '***', title: 't', content: 'c' }, DEFAULT_LIMITS))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(saveMaterial(root, { category: 'ok', title: 't', content: '' }, DEFAULT_LIMITS))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(saveMaterial(root, {
      category: 'ok', title: 't', content: 'x'.repeat(1024),
    }, resolveLimits({ maxMaterialBytes: 100 }))).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('caps the library size and skips broken files on load', async () => {
    const root = await tempRoot()
    await saveMaterial(root, { category: 'a', title: 'one', content: 'c1' }, resolveLimits({ maxMaterials: 1 }))
    await expect(saveMaterial(root, { category: 'a', title: 'two', content: 'c2' }, resolveLimits({ maxMaterials: 1 })))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await writeFile(join(root, 'm-badbadbadbadbad1.json'), 'not json', 'utf8')
    const all = await loadMaterials(root)
    expect(all.length).toBe(1)
    await expect(loadMaterial(root, 'm-0000000000000000')).rejects.toMatchObject({ code: 'MATERIAL_NOT_FOUND' })
  })
})

describe('assembleDraft', () => {
  const template = {
    id: 't', name: 't', category: 'custom' as const,
    chapters: [
      { id: 'a', level: 1, title: '必选章', required: true },
      { id: 'b', level: 1, title: '可选章', required: false },
    ],
  }

  it('normalizes a well-formed draft', () => {
    const { draft, report } = assembleDraft({
      templateId: 't',
      tender: { projectName: 'p' },
      sections: [
        { templateChapterId: 'a', title: '必选章', level: 1, content: '内容', status: 'drafted' },
      ],
    }, template, new Map())
    expect(draft.sections[0]!.templateChapterId).toBe('a')
    expect(report.errors).toEqual([])
    expect(report.missingChapterTitles).toEqual([])
  })

  it('defaults status from content and records outline sections', () => {
    const { draft, report } = assembleDraft({
      sections: [{ title: '空章', level: 1, content: '', status: 'outline' }],
    }, undefined, new Map())
    expect(draft.sections[0]!.status).toBe('outline')
    expect(report.outlineSectionTitles).toEqual(['空章'])
  })

  it('reports level skips, missing materials, and missing required chapters', () => {
    const { report } = assembleDraft({
      sections: [
        { title: '一级', level: 1, content: 'x', status: 'drafted', materialIds: ['m-0000000000000000'] },
        { title: '三级跳', level: 3, content: 'y', status: 'drafted' },
        { title: '空内容', level: 3, content: '', status: 'drafted' },
      ],
    }, template, new Map())
    expect(report.errors.some(error => error.includes('跳级'))).toBe(true)
    expect(report.errors.some(error => error.includes('素材引用不存在'))).toBe(true)
    expect(report.warnings.some(warning => warning.includes('内容为空'))).toBe(true)
    expect(report.missingChapterTitles).toEqual(['必选章'])
  })

  it('rejects malformed structure', () => {
    expect(() => assembleDraft({ sections: [] }, undefined, new Map())).toThrow(/no sections/)
    expect(() => assembleDraft({ sections: [{ title: 'x', level: 5, content: '' }] }, undefined, new Map())).toThrow(/level/)
    expect(() => assembleDraft({ sections: [{ title: 'x', level: 1, content: '', status: 'bad' }] }, undefined, new Map())).toThrow(/status/)
    expect(() => assembleDraft({ sections: 'no' }, undefined, new Map())).toThrow(/sections/)
  })

  it('flags unknown template chapter references and warns without a template', () => {
    const withUnknown = assembleDraft({
      sections: [{ templateChapterId: 'zz', title: 'x', level: 1, content: 'y', status: 'drafted' }],
    }, template, new Map())
    expect(withUnknown.report.errors.some(error => error.includes('不存在'))).toBe(true)
    const withoutTemplate = assembleDraft({
      templateId: 'ghost',
      sections: [{ title: 'x', level: 1, content: 'y', status: 'drafted' }],
    }, undefined, new Map())
    expect(withoutTemplate.report.warnings.some(warning => warning.includes('跳过必选章节检查'))).toBe(true)
  })
})

describe('render config and rendering', () => {
  it('validates layout values', () => {
    expect(() => resolveRenderConfig({ fontSizePt: 2 })).toThrow(/fontSizePt/)
    expect(() => resolveRenderConfig({ lineSpacing: 9 })).toThrow(/lineSpacing/)
    expect(() => resolveRenderConfig({ paragraphSpacingPt: 99 })).toThrow(/paragraphSpacingPt/)
    expect(() => resolveRenderConfig({ marginsMm: 5 })).toThrow(/marginsMm/)
    expect(() => resolveRenderConfig({ nope: 1 })).toThrow(/unknown render config/)
    expect(() => resolveRenderConfig({ headerText: '  ' })).toThrow(/headerText/)
    const resolved = resolveRenderConfig({ headerText: '头', pageNumbers: false })
    expect(resolved.headerText).toBe('头')
    expect(resolved.pageNumbers).toBe(false)
  })

  it('renders a draft and enforces the output cap', () => {
    const draft: BidDraft = {
      tender: { projectName: '渲染项目' },
      sections: [
        { title: '章', level: 1, content: '段落\n\n- 列表项\n\n| a | b |\n| - | - |\n| 1 | 2 |', status: 'drafted' },
      ],
    }
    const bytes = renderBidDocx(draft, {}, DEFAULT_LIMITS)
    expect(bytes.byteLength).toBeGreaterThan(1000)
    expect(() => renderBidDocx(draft, {}, resolveLimits({ maxOutputBytes: 100 }))).toThrow(/rendered document/)
  })
})

describe('compareTenderDraft', () => {
  /** A tender with two scoring items and one fatal clause. */
  const tender: TenderDocument = {
    meta: {},
    sections: [],
    scoring: [
      { id: 's1', clause: '技术方案', points: 40, criteria: '技术方案完整先进，提供实施方案', category: 'technical', locator: '§评分办法' },
      { id: 's2', clause: '类似业绩', points: 15, criteria: '近三年类似项目合同业绩一览', category: 'qualification', locator: '§评分办法' },
      { id: 's3', clause: '价', criteria: '价', category: 'price', locator: '§评分办法' },
    ],
    fatalClauses: [
      { id: 'f1', kind: 'disqualification', clause: '投标文件必须加盖公章，否则作无效投标处理', locator: '§须知' },
    ],
    formatRequirements: ['正本一份副本四份'],
    warnings: [],
  }

  it('marks covered, partial, and missing scoring items', () => {
    const draft: BidDraft = {
      tender: {},
      sections: [
        {
          title: '技术方案',
          level: 1,
          status: 'drafted',
          content: '本技术方案完整先进，并随附详细的实施方案与进度计划。',
        },
        { title: '其他', level: 1, status: 'drafted', content: '其他内容。' },
      ],
    }
    const report = compareTenderDraft(tender, draft)
    const byId = new Map(report.coverage.map(item => [item.scoringItemId, item]))
    expect(byId.get('s1')!.status).toBe('covered')
    expect(byId.get('s1')!.evidenceSectionTitles).toContain('技术方案')
    expect(byId.get('s2')!.status).toBe('missing')
    expect(byId.get('s2')!.suggestion).toContain('补充')
    expect(byId.get('s3')!.status).toBe('unverifiable')
    expect(report.totals).toEqual({ scoringItems: 3, covered: 1, partial: 0, missing: 1 })
    expect(report.fatalClauseFindings[0]!.addressed).toBe(false)
    expect(report.formatIssues).toEqual(['正本一份副本四份'])
    expect(report.summary).toContain('确定性初筛')
  })

  it('detects fatal-clause responses and honors threshold overrides', () => {
    const draft: BidDraft = {
      tender: {},
      sections: [
        {
          title: '响应',
          level: 1,
          status: 'drafted',
          content: '本投标文件加盖公章，不作无效投标处理。',
        },
        {
          title: '技术',
          level: 1,
          status: 'drafted',
          // Exactly half of s1's tokens: covered at the default 0.5 ratio,
          // not covered once coveredRatio is tightened to 0.9.
          content: '技术方案与实施方案先进。',
        },
      ],
    }
    const report = compareTenderDraft(tender, draft, { coveredRatio: 0.9, partialRatio: 0.8 })
    expect(report.fatalClauseFindings[0]!.addressed).toBe(true)
    const covered = report.coverage.find(item => item.scoringItemId === 's1')!
    expect(covered.status).not.toBe('covered')
    const baseline = compareTenderDraft(tender, draft)
    expect(baseline.coverage.find(item => item.scoringItemId === 's1')!.status).toBe('covered')
  })

  it('round-trips: render a draft, parse it back, and compare chapters', () => {
    const draft: BidDraft = {
      tender: { projectName: '往返项目' },
      sections: [
        { title: '第一章 技术方案', level: 1, content: '本技术方案完整先进，提供实施方案。\n\n第二段继续。', status: 'drafted' },
        { title: '第二章 售后服务', level: 1, content: '服务承诺内容。', status: 'drafted' },
        { title: '2.1 响应时间', level: 2, content: '2 小时响应。', status: 'drafted' },
      ],
    }
    const bytes = renderDocx(draft, DEFAULT_RENDER_CONFIG)
    const parsed = parseBidDocument(parseDocx(bytes, 100), DEFAULT_LIMITS)
    const stripNumber = (title: string): string => title.replace(
      /^(第[0-9一二三四五六七八九十百千两]+[章篇]|[一二三四五六七八九十百千两]{1,3}[、.．:：]|（[一二三四五六七八九十百千两]{1,3}）|\d+(?:\.\d+)*)[\s、.．:：)]*/,
      '',
    )
    expect(parsed.sections.map(section => stripNumber(section.title))).toEqual(
      draft.sections.map(section => stripNumber(section.title)),
    )
    const report = compareTenderDraft(tender, parsed)
    const technical = report.coverage.find(item => item.scoringItemId === 's1')!
    expect(technical.status).toBe('covered')
  })
})
