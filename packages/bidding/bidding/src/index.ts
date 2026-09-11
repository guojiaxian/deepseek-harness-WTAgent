/**
 * Professional bid document authoring engine.
 *
 * Pure processors plus a zero-dependency OOXML format layer: parse tender
 * .docx files into structured projections, manage bid templates and a
 * historical material library, assemble and validate drafts, render them to
 * formatted Word documents, and pre-screen scoring-point coverage
 * deterministically. No Cordis dependency — the model-facing
 * `bidding_*` tools live in `@deepseek-ai/dsh-tool-bidding`.
 * @module @deepseek-ai/dsh-bidding
 */

export * from './types.ts'
export * from './errors.ts'
export * from './checksum.ts'
export * from './validate.ts'
export * from './format/zip.ts'
export * from './format/xml.ts'
export * from './format/docx-read.ts'
export * from './format/docx-write.ts'
export * from './templates/index.ts'
export * from './processors/index.ts'
export { parseTender as parseTenderDocument } from './processors/parse-tender.ts'
export { parseBidDocument } from './processors/parse-tender.ts'
export { renderTenderMarkdown } from './processors/parse-tender.ts'
export { listTemplates, loadTemplate, parseTemplate } from './processors/template.ts'
export type { BrokenTemplateFile, TemplateDiscovery } from './processors/template.ts'
export { saveMaterial, searchMaterials, loadMaterial, loadMaterials, resolveMaterials, normalizeCategory, parseMaterial } from './processors/material.ts'
export type { MaterialInput, SearchOptions, MaterialHit } from './processors/material.ts'
export { assembleDraft } from './processors/draft.ts'
export type { DraftReport } from './processors/draft.ts'
export { renderBidDocx, resolveRenderConfig, DEFAULT_RENDER_CONFIG } from './processors/render.ts'
export type { RenderConfig } from './processors/render.ts'
export { compareTenderDraft, tokenize, DEFAULT_COMPARE_THRESHOLDS } from './processors/compare.ts'
export type { CompareThresholds } from './processors/compare.ts'
