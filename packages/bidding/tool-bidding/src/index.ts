/**
 * Model-facing `bidding_*` tools over the `@deepseek-ai/dsh-bidding` engine's
 * processors: parse a tender .docx from the session workspace or base64,
 * list bid templates (shipped plus user root), save and search historical
 * materials, assemble and render a bid draft to Word, and compare a tender
 * against a draft with a deterministic scoring-point coverage pre-screen.
 * Named exports only (no default), preserving loader injection metadata.
 * @module @deepseek-ai/dsh-tool-bidding
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_LIMITS, parseBidDocument, parseDocx, parseTenderDocument, renderBidDocx,
  renderTenderMarkdown, resolveLimits, listTemplates, loadTemplate, saveMaterial,
  searchMaterials, resolveMaterials, assembleDraft, compareTenderDraft,
} from '@deepseek-ai/dsh-bidding'
import type { BidDraft, Limits, LimitsInput, TenderDocument } from '@deepseek-ai/dsh-bidding'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-bidding'

/** Services required by the tool plugin: the tool registry plus the host
 * sandboxed filesystem, through which tender files enter from the session
 * workspace. */
export const inject = ['tools', 'fs']

/** Resource-limit configuration of the model-facing bidding tools. */
export interface Config extends LimitsInput {
  /** User template root override; default `$DSH_HOME/bidding/templates`. */
  readonly templateUserRoot?: string
  /** Material library root override; default `$DSH_HOME/bidding/materials`. */
  readonly materialRoot?: string
}

/** Schemastery config for the tool consumer. */
export const Config: z<Config> = z.object({
  maxInputBytes: z.number().default(DEFAULT_LIMITS.maxInputBytes),
  maxBlocks: z.number().default(DEFAULT_LIMITS.maxBlocks),
  maxSections: z.number().default(DEFAULT_LIMITS.maxSections),
  maxScoringItems: z.number().default(DEFAULT_LIMITS.maxScoringItems),
  maxFatalClauses: z.number().default(DEFAULT_LIMITS.maxFatalClauses),
  maxFormatRequirements: z.number().default(DEFAULT_LIMITS.maxFormatRequirements),
  maxMaterials: z.number().default(DEFAULT_LIMITS.maxMaterials),
  maxMaterialBytes: z.number().default(DEFAULT_LIMITS.maxMaterialBytes),
  maxOutputBytes: z.number().default(DEFAULT_LIMITS.maxOutputBytes),
  maxWarnings: z.number().default(DEFAULT_LIMITS.maxWarnings),
  templateUserRoot: z.string(),
  materialRoot: z.string(),
})

/** Resolved deployment policy: limits plus the two trusted roots. */
interface ResolvedPolicy {
  readonly limits: Limits
  readonly templateUserRoot: string | undefined
  readonly materialRoot: string
}

/**
 * Materialize the deployment policy even when `apply` is called directly
 * outside Loader normalization.
 * @param config - plugin configuration.
 * @returns the fully populated policy.
 */
function resolvePolicy(config: Config): ResolvedPolicy {
  return {
    limits: resolveLimits(config),
    templateUserRoot: config.templateUserRoot ?? dshHomePath('bidding/templates'),
    materialRoot: config.materialRoot ?? dshHomePath('bidding/materials'),
  }
}

/** Re-export the engine's public types for host composition. */
export type {
  BidDraft, BidTemplate, BidTemplateChapter, ComparisonReport, CoverageItem, CoverageStatus,
  DraftSection, DraftSectionStatus, FatalClause, FatalClauseKind, Limits, LimitsInput, Material,
  ScoringCategory, ScoringItem, TenderDocument, TenderMeta, TenderSection, TemplateCategory,
} from '@deepseek-ai/dsh-bidding'

/** Shared output schema fragment of the parse tool. */
const PARSE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tender: { type: 'json', required: true },
    sectionCount: { type: 'integer', required: true },
    scoringCount: { type: 'integer', required: true },
    fatalClauseCount: { type: 'integer', required: true },
    sidecarPath: { type: 'string' },
    warnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Output schema of the template list tool. */
const TEMPLATES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    templates: { type: 'json', required: true },
    broken: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
  },
} as const

/** Output schema of the material save tool. */
const SAVE_MATERIAL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    materialId: { type: 'string', required: true },
    category: { type: 'string', required: true },
    title: { type: 'string', required: true },
  },
} as const

/** Output schema of the material search tool. */
const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hits: { type: 'json', required: true },
    count: { type: 'integer', required: true },
  },
} as const

/** Output schema of the draft assembly tool. */
const ASSEMBLE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    draft: { type: 'json', required: true },
    sectionCount: { type: 'integer', required: true },
    report: { type: 'json', required: true },
  },
} as const

/** Output schema of the render tool. */
const RENDER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fileName: { type: 'string', required: true },
    format: { type: 'string', required: true, enum: ['docx'] },
    bytes: { type: 'integer', required: true },
    checksum: { type: 'string', required: true },
    dataBase64: { type: 'string', required: true },
  },
} as const

/** Output schema of the compare tool. */
const COMPARE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    report: { type: 'json', required: true },
  },
} as const

/** Generic, args-only pending presentation shared by the bidding tools. */
function present(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/** The compact model-facing result of the parse tool. */
interface ParseToolValue {
  tender: JsonValue
  sectionCount: number
  scoringCount: number
  fatalClauseCount: number
  sidecarPath?: string
  warnings: string[]
}

/**
 * Read tender bytes from the session workspace through the sandboxed
 * filesystem.
 * @param ctx - registrant context carrying the fs service.
 * @param exec - the tool execution supplying session cwd and cancellation.
 * @param path - the workspace-relative path.
 * @param limits - resource limits.
 * @returns the raw file bytes.
 */
async function readWorkspaceBytes(ctx: Context, exec: ToolExecution, path: string, limits: Limits): Promise<Uint8Array> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(path, {
    ...(cwd !== undefined ? { cwd } : {}),
    signal: exec.signal,
  })
  return ctx.fs.readBytes(target, exec.signal, limits.maxInputBytes)
}

/**
 * Register the seven bidding tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and fs service.
 * @param config - deployment's resource-limit and root policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const policy = resolvePolicy(config)

  ctx.tools.register(defineTool({
    name: 'bidding_parse_tender',
    description: 'Parse a tender .docx file into its structured projection: chapter tree, scoring items, fatal clauses, and key facts. Provide a workspace path or base64 bytes.',
    parameters: {
      path: { type: 'string', description: 'Workspace-relative path of the tender .docx file (preferred when the file is in the workspace).' },
      dataBase64: { type: 'string', description: 'Base64-encoded tender .docx bytes, as an alternative to path.' },
      fileName: { type: 'string', description: 'File name used for the sidecar when dataBase64 is given.' },
    },
    output: {
      schema: PARSE_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Parsed tender: ${value.sectionCount} sections, ${value.scoringCount} scoring items, ${value.fatalClauseCount} fatal clauses — ${value.warnings.length} warning(s)`,
      }],
    },
    async execute(args, exec) {
      let bytes: Uint8Array
      let sourceName: string | undefined
      if (args.path !== undefined && args.path.trim() !== '') {
        bytes = await readWorkspaceBytes(ctx, exec, args.path, policy.limits)
        sourceName = args.path
      } else if (args.dataBase64 !== undefined && args.dataBase64 !== '') {
        bytes = Buffer.from(args.dataBase64, 'base64')
        if (bytes.byteLength > policy.limits.maxInputBytes) {
          throw new Error(`tender input is ${String(bytes.byteLength)} bytes, exceeding the ${String(policy.limits.maxInputBytes)}-byte cap`)
        }
        sourceName = args.fileName
      } else {
        throw new Error('provide either path (workspace-relative tender .docx) or dataBase64 (+ fileName)')
      }
      const raw = parseDocx(bytes, policy.limits.maxBlocks)
      const tender = parseTenderDocument(raw, policy.limits)
      const value: ParseToolValue = {
        // The engine projection is readonly; it is JSON-safe by construction,
        // so the cast only bridges the readonly engine types to JsonValue.
        tender: tender as unknown as JsonValue,
        sectionCount: tender.sections.length,
        scoringCount: tender.scoring.length,
        fatalClauseCount: tender.fatalClauses.length,
        warnings: [...tender.warnings],
      }
      // Best-effort Markdown sidecar next to the source; a read-only sandbox
      // denies the write, which degrades to a warning instead of failing.
      if (sourceName !== undefined && sourceName.trim() !== '') {
        const sidecarRelative = `${sourceName}.extracted.md`
        try {
          const markdown = renderTenderMarkdown(raw, tender)
          const cwd = exec.agent?.session.header.cwd
          const target = await ctx.fs.resolve(sidecarRelative, {
            ...(cwd !== undefined ? { cwd } : {}),
            signal: exec.signal,
          })
          await ctx.fs.writeText(target, markdown, undefined, exec.signal)
          value.sidecarPath = sidecarRelative
        } catch {
          value.warnings.push(`无法写入全文提取 sidecar「${sidecarRelative}」（工作区可能为只读），如需逐章细读请提供写权限或直接使用本结果`)
        }
      }
      return value
    },
    presentCall: args => present('Parse tender document', args),
  }))

  ctx.tools.register(defineTool({
    name: 'bidding_list_templates',
    description: 'List every available bid template: the four built-in skeletons plus any custom templates dropped into the user template root.',
    parameters: {},
    output: {
      schema: TEMPLATES_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Found ${(value.templates as unknown as unknown[]).length} templates (${value.broken.length} broken user file(s))`,
      }],
    },
    async execute() {
      const discovery = await listTemplates(policy.templateUserRoot)
      return {
        templates: discovery.templates as unknown as JsonValue,
        broken: [...discovery.broken] as unknown as Record<string, JsonValue>[],
      }
    },
    presentCall: () => present('List bid templates', {}),
  }))

  ctx.tools.register(defineTool({
    name: 'bidding_save_material',
    description: 'Save a reusable material (company qualification, project reference, technical passage, team profile, service commitment) into the persistent library for later bids.',
    parameters: {
      category: { type: 'string', required: true, description: 'Kebab-case category, e.g. company-qualification, performance-proof, technical-proposal.' },
      title: { type: 'string', required: true, description: 'Short material title.' },
      content: { type: 'string', required: true, description: 'Markdown content of the material (tables allowed).' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Search tags.' },
      source: { type: 'string', description: 'Originating bid or project name.' },
    },
    output: {
      schema: SAVE_MATERIAL_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Saved material ${value.materialId} (${value.category}: ${value.title})`,
      }],
    },
    async execute(args) {
      const material = await saveMaterial(policy.materialRoot, args, policy.limits)
      return { materialId: material.id, category: material.category, title: material.title }
    },
    presentCall: args => present('Save bidding material', args),
  }))

  ctx.tools.register(defineTool({
    name: 'bidding_search_materials',
    description: 'Search the persistent material library with deterministic keyword/category/tag scoring; rank hits then judge semantic fit yourself.',
    parameters: {
      query: { type: 'string', description: 'Free-text query matched against titles, tags, and content.' },
      category: { type: 'string', description: 'Exact kebab-case category filter.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Material must carry at least one of these tags.' },
      includeContent: { type: 'boolean', description: 'Return full content instead of a 200-character preview; default false.' },
    },
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Matched ${value.count} material(s)`,
      }],
    },
    async execute(args) {
      const hits = await searchMaterials(policy.materialRoot, {
        ...(args.query !== undefined ? { query: args.query } : {}),
        ...(args.category !== undefined ? { category: args.category } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
        ...(args.includeContent !== undefined ? { includeContent: args.includeContent } : {}),
      }, policy.limits)
      return {
        // Search hits are JSON-safe by construction; the cast bridges the
        // readonly engine types to the JsonValue schema field.
        hits: hits.map(hit => ({
          id: hit.material.id,
          category: hit.material.category,
          title: hit.material.title,
          tags: [...hit.material.tags],
          ...(hit.material.source !== undefined ? { source: hit.material.source } : {}),
          updatedAt: hit.material.updatedAt,
          score: hit.score,
          ...(hit.preview !== undefined ? { preview: hit.preview } : {}),
          ...(args.includeContent === true ? { content: hit.material.content } : {}),
        })) as unknown as JsonValue,
        count: hits.length,
      }
    },
    presentCall: args => present('Search bidding materials', args),
  }))

  ctx.tools.register(defineTool({
    name: 'bidding_assemble_draft',
    description: 'Validate and normalize a bid draft: section-level continuity, template required-chapter coverage, and material provenance references.',
    parameters: {
      draft: { type: 'json', required: true, description: 'The BidDraft JSON (templateId, tender facts, sections).' },
    },
    output: {
      schema: ASSEMBLE_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Assembled draft with ${value.sectionCount} sections — ${(value.report as unknown as { errors: unknown[]; warnings: unknown[] }).errors.length} error(s), ${(value.report as unknown as { errors: unknown[]; warnings: unknown[] }).warnings.length} warning(s)`,
      }],
    },
    async execute(args) {
      const raw = args.draft as Record<string, unknown>
      const templateId = typeof raw.templateId === 'string' ? raw.templateId : undefined
      const template = templateId !== undefined ? await loadTemplate(templateId, policy.templateUserRoot) : undefined
      const referencedIds: string[] = []
      for (const section of Array.isArray(raw.sections) ? raw.sections as Record<string, unknown>[] : []) {
        for (const id of Array.isArray(section.materialIds) ? section.materialIds as unknown[] : []) {
          if (typeof id === 'string') referencedIds.push(id)
        }
      }
      const materials = await resolveMaterials(policy.materialRoot, referencedIds)
      const assembled = assembleDraft(args.draft, template, materials)
      return {
        draft: assembled.draft as unknown as JsonValue,
        sectionCount: assembled.draft.sections.length,
        report: assembled.report as unknown as JsonValue,
      }
    },
    presentCall: args => present('Assemble bid draft', args),
  }))

  ctx.tools.register(defineTool({
    name: 'bidding_render_docx',
    description: 'Render a bid draft into a formatted .docx (cover page, TOC field, heading styles, tables, header/footer, page numbers).',
    parameters: {
      draft: { type: 'json', required: true, description: 'The BidDraft JSON to render.' },
      config: {
        type: 'json',
        description: 'Layout options (headerText, footerText, pageNumbers, bodyFontFamily, headingFontFamily, fontSizePt, lineSpacing, paragraphSpacingPt, marginsMm).',
      },
    },
    output: {
      schema: RENDER_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered ${value.bytes} byte docx as ${value.fileName} (sha256 ${value.checksum.slice(0, 8)})`,
      }],
    },
    async execute(args) {
      const { createHash } = await import('node:crypto')
      // Rendering only needs the normalized structure; provenance checks are
      // the assemble tool's job.
      const assembled = assembleDraft(args.draft, undefined, new Map())
      const bytes = renderBidDocx(assembled.draft, args.config ?? {}, policy.limits)
      const tenderName = (args.draft as { tender?: { projectName?: string } } | null | undefined)?.tender?.projectName
      return {
        fileName: `${fileBaseOf(tenderName)}.docx`,
        format: 'docx' as const,
        bytes: bytes.byteLength,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        dataBase64: Buffer.from(bytes).toString('base64'),
      }
    },
    presentCall: args => present('Render bid document', args),
  }))

  ctx.tools.register(defineTool({
    name: 'bidding_compare',
    description: 'Deterministically pre-screen a bid against a tender: scoring-point coverage matrix, fatal-clause response findings, and format checklist. Review the matrix semantically before concluding.',
    parameters: {
      tender: { type: 'json', required: true, description: 'The TenderDocument JSON from bidding_parse_tender.' },
      draft: { type: 'json', description: 'The BidDraft JSON to compare (preferred).' },
      bidPath: { type: 'string', description: 'Workspace-relative path of a finished bid .docx, as an alternative to draft.' },
    },
    output: {
      schema: COMPARE_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: (value.report as unknown as { summary: string }).summary,
      }],
    },
    async execute(args, exec) {
      let draft: BidDraft | undefined
      if (args.draft !== undefined) {
        draft = assembleDraft(args.draft, undefined, new Map()).draft
      } else if (args.bidPath !== undefined && args.bidPath.trim() !== '') {
        const bytes = await readWorkspaceBytes(ctx, exec, args.bidPath, policy.limits)
        draft = parseBidDocument(parseDocx(bytes, policy.limits.maxBlocks), policy.limits)
      }
      if (draft === undefined) {
        throw new Error('provide either draft (BidDraft JSON) or bidPath (finished bid .docx path)')
      }
      const report = compareTenderDraft(args.tender as unknown as TenderDocument, draft)
      return { report: report as unknown as JsonValue }
    },
    presentCall: args => present('Compare tender and bid', args),
  }))
}

/**
 * Derive a filesystem-safe base name from a tender project name.
 * @param projectName - tender project name, when known.
 * @returns a filesystem-safe base name without an extension.
 */
function fileBaseOf(projectName: string | undefined): string {
  const base = (projectName ?? 'bid-document').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
  return base === '' ? 'bid-document' : base
}
