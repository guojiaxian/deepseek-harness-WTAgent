/**
 * Deterministic comparison pre-screen between a parsed tender and a bid
 * draft.
 *
 * Scoring clauses are tokenized (CJK bigrams plus latin words plus a small
 * domain-term dictionary) and matched against the draft text; hit ratio and
 * hit-section count drive a `covered`/`partial`/`missing`/`unverifiable`
 * verdict that the model then re-checks semantically. Fatal clauses are
 * checked for any responsive passage; format requirements pass through as a
 * manual checklist. No embeddings, no network — fully reproducible.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidDraft, ComparisonReport, CoverageItem, CoverageStatus, ScoringItem, TenderDocument } from '../types.ts'

/** Tunable thresholds of the deterministic pre-screen. */
export interface CompareThresholds {
  /** Minimum token-hit ratio for `covered`; default 0.5. */
  readonly coveredRatio: number
  /** Minimum token-hit ratio (above zero) for `partial`; default 0.2. */
  readonly partialRatio: number
  /** Minimum tokens a clause must yield to be judged at all; below it the
   * verdict is `unverifiable`; default 3. */
  readonly minTokens: number
}

/** Default thresholds. */
export const DEFAULT_COMPARE_THRESHOLDS: CompareThresholds = {
  coveredRatio: 0.5,
  partialRatio: 0.2,
  minTokens: 3,
}

/**
 * Minimum token-hit ratio for a fatal clause to count as addressed. Kept fixed
 * (not a tunable threshold): a fatal clause only needs one responsive passage,
 * and threshold overrides meant to tighten coverage scoring must not loosen or
 * harden the fatal-clause safety net.
 */
const FATAL_ADDRESSED_RATIO = 0.5

/** Domain terms matched as whole units before bigram tokenization. */
const DOMAIN_TERMS = [
  '技术方案', '施工方案', '实施方案', '售后服务', '服务承诺', '项目团队', '人员配置',
  '资质等级', '营业执照', '业绩证明', '合同业绩', '质量保证', '质量管理体系', '安全生产',
  '环境保护', '绿色低碳', '应急预案', '培训方案', '交付时间', '交付计划', '进度计划',
  '施工组织', '验收标准', '知识产权', '信息安全', '保密协议', '信用证明', '财务状况',
  '纳税证明', '社保缴纳', '认证证书', '检测报告', '样品测试', '运行维护', '备品备件',
]

/**
 * Tokenize clause text: domain terms first, then CJK bigrams, then latin
 * words. Stopword bigrams (pure digits/punctuation) are dropped.
 * @param text - the clause text.
 * @returns the distinct tokens.
 */
export function tokenize(text: string): string[] {
  const tokens = new Set<string>()
  let rest = text
  for (const term of DOMAIN_TERMS) {
    if (rest.includes(term)) {
      tokens.add(term)
      rest = rest.split(term).join(' ')
    }
  }
  for (const word of rest.match(/[A-Za-z][A-Za-z0-9-]{1,}/g) ?? []) {
    tokens.add(word.toLowerCase())
  }
  const cjk = rest.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    for (let index = 0; index + 1 < run.length; index++) {
      tokens.add(run.slice(index, index + 2))
    }
    if (run.length === 1) tokens.add(run)
  }
  return [...tokens]
}

/** One draft section flattened for matching. */
interface DraftText {
  readonly title: string
  readonly text: string
}

/**
 * Flatten a draft into per-section match targets.
 * @param draft - the bid draft.
 * @returns the per-section title+content texts.
 */
function draftTexts(draft: BidDraft): DraftText[] {
  return draft.sections.map(section => ({
    title: section.title,
    text: `${section.title}\n${section.content}`,
  }))
}

/**
 * Compare one scoring item's tokens against the draft texts.
 * @param item - the scoring item.
 * @param texts - flattened draft sections.
 * @param thresholds - tunable thresholds.
 * @returns the coverage row.
 */
function coverageOf(item: ScoringItem, texts: readonly DraftText[], thresholds: CompareThresholds): CoverageItem {
  const tokens = tokenize(`${item.clause} ${item.criteria}`)
  if (tokens.length < thresholds.minTokens) {
    return {
      scoringItemId: item.id,
      clause: item.clause,
      ...(item.points !== undefined ? { points: item.points } : {}),
      status: 'unverifiable',
      evidenceSectionTitles: [],
      keywordHits: [],
      suggestion: '评分条款过短，无法确定性匹配，请人工核对',
    }
  }
  const evidenceSectionTitles: string[] = []
  const keywordHits = new Set<string>()
  for (const text of texts) {
    let sectionHits = 0
    for (const token of tokens) {
      if (text.text.includes(token)) {
        sectionHits++
        keywordHits.add(token)
      }
    }
    if (sectionHits > 0) evidenceSectionTitles.push(text.title)
  }
  const ratio = keywordHits.size / tokens.length
  let status: CoverageStatus
  if (ratio >= thresholds.coveredRatio) status = 'covered'
  else if (ratio >= thresholds.partialRatio) status = 'partial'
  else status = 'missing'
  return {
    scoringItemId: item.id,
    clause: item.clause,
    ...(item.points !== undefined ? { points: item.points } : {}),
    status,
    evidenceSectionTitles,
    keywordHits: [...keywordHits],
    ...(status !== 'covered' ? { suggestion: suggestionFor(status, evidenceSectionTitles) } : {}),
  }
}

/**
 * Compose the recovery suggestion of one non-covered row.
 * @param status - the row status.
 * @param evidence - sections that carried partial hits.
 * @returns the suggestion text.
 */
function suggestionFor(status: CoverageStatus, evidence: readonly string[]): string {
  if (status === 'partial' && evidence.length > 0) {
    return `部分覆盖（${evidence.slice(0, 3).join('、')}），请补全该评分点的针对性响应内容`
  }
  return '未在标书中找到对应响应内容，请按评分办法逐项补充'
}

/**
 * Deterministically compare a tender against a bid draft.
 * @param tender - the parsed tender document.
 * @param draft - the bid draft (or a draft projected from a rendered bid).
 * @param thresholdsValue - optional threshold overrides.
 * @returns the comparison report.
 */
export function compareTenderDraft(
  tender: TenderDocument,
  draft: BidDraft,
  thresholdsValue?: Partial<CompareThresholds>,
): ComparisonReport {
  const thresholds: CompareThresholds = { ...DEFAULT_COMPARE_THRESHOLDS, ...thresholdsValue }
  const texts = draftTexts(draft)
  const coverage = tender.scoring.map(item => coverageOf(item, texts, thresholds))

  const fatalClauseFindings = tender.fatalClauses.map((clause) => {
    const tokens = tokenize(clause.clause)
    const addressed = tokens.length === 0
      ? false
      : tokens.filter(token => texts.some(text => text.text.includes(token))).length / tokens.length >= FATAL_ADDRESSED_RATIO
    return { clause: clause.clause, addressed, locator: clause.locator }
  })

  const totals = {
    scoringItems: coverage.length,
    covered: coverage.filter(item => item.status === 'covered').length,
    partial: coverage.filter(item => item.status === 'partial').length,
    missing: coverage.filter(item => item.status === 'missing').length,
  }
  const unaddressed = fatalClauseFindings.filter(finding => !finding.addressed).length
  const summary = `评分点 ${String(totals.scoringItems)} 项：覆盖 ${String(totals.covered)}、部分覆盖 ${String(totals.partial)}、缺失 ${String(totals.missing)}；` +
    `废标/实质性条款未响应 ${String(unaddressed)} 条（以上为确定性初筛，语义复核请逐项确认）`
  return {
    coverage,
    fatalClauseFindings,
    formatIssues: [...tender.formatRequirements],
    totals,
    summary,
  }
}
