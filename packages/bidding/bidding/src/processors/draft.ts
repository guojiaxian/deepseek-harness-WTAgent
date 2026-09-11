/**
 * Draft assembly: validate and normalize a model-authored {@link BidDraft}
 * before rendering or comparison.
 *
 * Validation is loud and structured: level continuity (a level may only drop
 * by one at a time), required template chapter coverage, and material
 * provenance references all land in a report the model can act on; only
 * structurally malformed input (wrong types, empty titles) throws.
 * @module @deepseek-ai/dsh-bidding
 */

import { BiddingError } from '../errors.ts'
import type { BidDraft, BidTemplate, DraftSection, Material } from '../types.ts'
import { asArray, asEnum, asNumber, asObject, asOptionalString, asString } from '../validate.ts'

/** Maximum characters of one draft section title. */
const TITLE_CHARS = 120

/** The validation report returned next to the normalized draft. */
export interface DraftReport {
  /** Structural issues that block rendering (also thrown for hard errors). */
  readonly errors: readonly string[]
  /** Soft findings the model should address before finalizing. */
  readonly warnings: readonly string[]
  /** Sections that outline only — no content yet. */
  readonly outlineSectionTitles: readonly string[]
  /** Required template chapters without a matching draft section. */
  readonly missingChapterTitles: readonly string[]
}

/**
 * Validate one raw draft section value.
 * @param value - the raw section object.
 * @param index - section position for error messages.
 * @returns the normalized section.
 * @throws BiddingError `VALIDATION_ERROR` on malformed input.
 */
function parseSection(value: unknown, index: number): DraftSection {
  const what = `draft section ${String(index)}`
  const section = asObject(value, what)
  const title = asString(section.title, `${what} title`).slice(0, TITLE_CHARS)
  const level = asNumber(section.level, `${what} level`)
  if (!Number.isInteger(level) || level < 1 || level > 4) {
    throw new BiddingError(`${what} level must be an integer 1-4`, { code: 'VALIDATION_ERROR' })
  }
  const content = typeof section.content === 'string' ? section.content : ''
  const status = asEnum(section.status ?? (content.trim() === '' ? 'outline' : 'drafted'), ['outline', 'drafted'] as const, `${what} status`)
  const materialIds = asArray(section.materialIds ?? [], `${what} materialIds`)
    .map((id, materialIndex) => asString(id, `${what} materialIds ${String(materialIndex)}`))
  const templateChapterId = asOptionalString(section.templateChapterId, `${what} templateChapterId`)
  return {
    ...(templateChapterId !== undefined ? { templateChapterId } : {}),
    title,
    level,
    content,
    ...(materialIds.length > 0 ? { materialIds } : {}),
    status,
  }
}

/**
 * Assemble (validate + normalize) one bid draft.
 * @param value - the raw draft JSON.
 * @param template - the referenced template, when the draft carries one.
 * @param materials - the resolved material provenance map.
 * @returns the normalized draft plus its validation report.
 * @throws BiddingError `VALIDATION_ERROR` on structurally malformed input.
 */
export function assembleDraft(value: unknown, template: BidTemplate | undefined, materials: ReadonlyMap<string, Material>): {
  readonly draft: BidDraft
  readonly report: DraftReport
} {
  const object = asObject(value, 'draft')
  const tenderValue = asObject(object.tender, 'draft tender')
  const projectName = asOptionalString(tenderValue.projectName, 'draft tender projectName')
  const tenderNo = asOptionalString(tenderValue.tenderNo, 'draft tender tenderNo')
  const purchaser = asOptionalString(tenderValue.purchaser, 'draft tender purchaser')
  const templateId = asOptionalString(object.templateId, 'draft templateId')
  const sectionsValue = asArray(object.sections ?? [], 'draft sections')
  if (sectionsValue.length === 0) {
    throw new BiddingError('draft has no sections', { code: 'VALIDATION_ERROR' })
  }
  const sections = sectionsValue.map((section, index) => parseSection(section, index))

  const errors: string[] = []
  const warnings: string[] = []
  const outlineSectionTitles: string[] = []

  // Level continuity: a level may drop by at most one heading level at a time.
  let previousLevel = 0
  for (const section of sections) {
    if (section.level > previousLevel + 1) {
      errors.push(`章节「${section.title}」层级 ${String(section.level)} 跳级（上一层级 ${String(previousLevel)}）`)
    }
    previousLevel = section.level
    if (section.status === 'outline') outlineSectionTitles.push(section.title)
    else if (section.content.trim() === '') warnings.push(`章节「${section.title}」标记为 drafted 但内容为空`)
    if (section.content.length > 200_000) warnings.push(`章节「${section.title}」内容超长，渲染前建议精简`)
  }

  // Material provenance: every referenced id must resolve.
  const missingMaterialIds = new Set<string>()
  for (const section of sections) {
    for (const id of section.materialIds ?? []) {
      if (!materials.has(id)) missingMaterialIds.add(id)
    }
  }
  if (missingMaterialIds.size > 0) {
    errors.push(`素材引用不存在：${[...missingMaterialIds].join('、')}`)
  }

  // Required template chapters must each map to one draft section.
  const missingChapterTitles: string[] = []
  if (template !== undefined) {
    const linked = new Set(sections.map(section => section.templateChapterId).filter(id => id !== undefined))
    for (const chapter of template.chapters) {
      if (chapter.required && !linked.has(chapter.id)) missingChapterTitles.push(chapter.title)
    }
    for (const section of sections) {
      if (section.templateChapterId !== undefined
        && !template.chapters.some(chapter => chapter.id === section.templateChapterId)) {
        errors.push(`章节「${section.title}」引用了模板中不存在的章节 id "${section.templateChapterId}"`)
      }
    }
  } else if (templateId !== undefined) {
    warnings.push(`草稿声明模板 ${templateId} 但未传入模板内容，跳过必选章节检查`)
  }

  const draft: BidDraft = {
    ...(templateId !== undefined ? { templateId } : {}),
    tender: {
      ...(projectName !== undefined ? { projectName } : {}),
      ...(tenderNo !== undefined ? { tenderNo } : {}),
      ...(purchaser !== undefined ? { purchaser } : {}),
    },
    sections,
  }
  return {
    draft,
    report: { errors, warnings, outlineSectionTitles, missingChapterTitles },
  }
}
