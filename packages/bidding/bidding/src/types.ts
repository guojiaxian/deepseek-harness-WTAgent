/**
 * Domain types of the bidding engine.
 *
 * Every type is readonly and JSON-safe so a value can travel through the
 * model-facing tools unmodified: `TenderDocument` is the parsed projection of
 * one tender file, `BidTemplate` and `Material` come from the template and
 * material libraries, `BidDraft` is the model-authored work-in-progress, and
 * `ComparisonReport` is the deterministic scoring-point coverage pre-screen.
 * @module @deepseek-ai/dsh-bidding
 */

/** Resource limits shared by the engine's processors. */
export interface Limits {
  /** Maximum accepted tender input bytes; default 32 MiB. */
  readonly maxInputBytes: number
  /** Maximum blocks (paragraphs + tables) in one parsed document; default 50 000. */
  readonly maxBlocks: number
  /** Maximum tender sections; default 2000. */
  readonly maxSections: number
  /** Maximum scoring items; default 500. */
  readonly maxScoringItems: number
  /** Maximum fatal clauses; default 200. */
  readonly maxFatalClauses: number
  /** Maximum format requirement entries; default 20. */
  readonly maxFormatRequirements: number
  /** Maximum materials in the library; default 5000. */
  readonly maxMaterials: number
  /** Maximum bytes of one material's content; default 256 KiB. */
  readonly maxMaterialBytes: number
  /** Maximum generated document bytes; default 16 MiB. */
  readonly maxOutputBytes: number
  /** Maximum warnings collected by one parse; default 20. */
  readonly maxWarnings: number
}

/** A user-supplied partial over {@link Limits}; omitted fields take defaults. */
export type LimitsInput = Partial<Limits>

/** Default resource limits of the bidding engine. */
export const DEFAULT_LIMITS: Limits = {
  maxInputBytes: 32 * 1024 * 1024,
  maxBlocks: 50_000,
  maxSections: 2000,
  maxScoringItems: 500,
  maxFatalClauses: 200,
  maxFormatRequirements: 20,
  maxMaterials: 5000,
  maxMaterialBytes: 256 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
  maxWarnings: 20,
}

/**
 * Resolve a {@link LimitsInput} against the defaults.
 * @param input - user-supplied partial limits.
 * @returns the fully populated limits.
 */
export function resolveLimits(input: LimitsInput): Limits {
  return { ...DEFAULT_LIMITS, ...input }
}

/** Key facts extracted from a tender (best-effort; absent fields omitted). */
export interface TenderMeta {
  /** Name of the tendered project. */
  readonly projectName?: string
  /** Tender / procurement number. */
  readonly tenderNo?: string
  /** Purchaser (采购人/招标人). */
  readonly purchaser?: string
  /** Procurement agency (代理机构). */
  readonly agency?: string
  /** Bid submission deadline. */
  readonly deadline?: string
  /** Bid opening time. */
  readonly openAt?: string
  /** Bid bond / security deposit. */
  readonly bond?: string
  /** Contact person. */
  readonly contact?: string
  /** Qualification requirement excerpts. */
  readonly qualification?: readonly string[]
  /** Delivery / period requirement excerpts. */
  readonly deliverables?: readonly string[]
}

/** One node of the tender chapter tree (flat; `level` carries hierarchy). */
export interface TenderSection {
  /** Stable hash id derived from numbering and title. */
  readonly id: string
  /** Heading level, 1-based. */
  readonly level: number
  /** Original numbering text (e.g. "三", "（二）", "3.1"). */
  readonly number: string
  /** Chapter title without the numbering prefix. */
  readonly title: string
  /** First-paragraph summary, truncated to 200 characters. */
  readonly summary: string
  /** Body character count under this chapter. */
  readonly charCount: number
  /** Report-friendly locator, e.g. "§3.1 投标须知". */
  readonly locator: string
}

/** Category of one scoring item. */
export type ScoringCategory = 'technical' | 'commercial' | 'price' | 'qualification'

/** One scoring item from the tender's scoring-methods chapter. */
export interface ScoringItem {
  /** Stable hash id. */
  readonly id: string
  /** The scored clause (short label). */
  readonly clause: string
  /** Point value, when the tender states one. */
  readonly points?: number
  /** Verbatim scoring criterion text. */
  readonly criteria: string
  /** Category derived from clause keywords. */
  readonly category: ScoringCategory
  /** Report-friendly locator of the source chapter. */
  readonly locator: string
}

/** Kind of a fatal (disqualification-relevant) clause. */
export type FatalClauseKind = 'disqualification' | 'star' | 'mandatory'

/** A disqualification / rejection / starred / mandatory clause of the tender. */
export interface FatalClause {
  /** Stable hash id. */
  readonly id: string
  /** Clause text (capped). */
  readonly clause: string
  /** Report-friendly locator of the source chapter. */
  readonly locator: string
  /** Classification of the clause. */
  readonly kind: FatalClauseKind
}

/** The parsed projection of one tender document. */
export interface TenderDocument {
  /** Best-effort key facts. */
  readonly meta: TenderMeta
  /** Chapter tree (flat, `level` carries hierarchy). */
  readonly sections: readonly TenderSection[]
  /** Scoring items. */
  readonly scoring: readonly ScoringItem[]
  /** Fatal clauses. */
  readonly fatalClauses: readonly FatalClause[]
  /** Verbatim format / binding / signature requirement entries. */
  readonly formatRequirements: readonly string[]
  /** Low-confidence hints for model-side fallback. */
  readonly warnings: readonly string[]
}

/** One chapter of a bid template. */
export interface BidTemplateChapter {
  /** Stable chapter id, unique inside the template. */
  readonly id: string
  /** Heading level, 1-based. */
  readonly level: number
  /** Chapter title. */
  readonly title: string
  /** Writing guidance for the chapter. */
  readonly requirements?: string
  /** Whether the chapter must be present in the bid. */
  readonly required: boolean
  /** Suggested material categories for the chapter. */
  readonly materialCategories?: readonly string[]
}

/** Template category. */
export type TemplateCategory = 'government-procurement' | 'engineering' | 'goods' | 'services' | 'custom'

/** A bid document template: an ordered chapter skeleton. */
export interface BidTemplate {
  /** Template id (directory/file name constrained like preset ids). */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Short description. */
  readonly description?: string
  /** Template category. */
  readonly category: TemplateCategory
  /** Ordered chapters. */
  readonly chapters: readonly BidTemplateChapter[]
}

/** One reusable material of the library. */
export interface Material {
  /** Material id, `m-<16 hex>`. */
  readonly id: string
  /** Normalized kebab-case category (open set). */
  readonly category: string
  /** Material title. */
  readonly title: string
  /** Markdown content. */
  readonly content: string
  /** Search tags. */
  readonly tags: readonly string[]
  /** Originating bid/project name. */
  readonly source?: string
  /** Creation timestamp (ISO 8601). */
  readonly createdAt: string
  /** Last-update timestamp (ISO 8601). */
  readonly updatedAt: string
}

/** Status of one draft section. */
export type DraftSectionStatus = 'outline' | 'drafted'

/** One section of a model-authored bid draft. */
export interface DraftSection {
  /** Linked template chapter id, when the section follows a template. */
  readonly templateChapterId?: string
  /** Section title. */
  readonly title: string
  /** Heading level, 1-based (1-4). */
  readonly level: number
  /** Markdown content (tables allowed). */
  readonly content: string
  /** Provenance references to reused materials. */
  readonly materialIds?: readonly string[]
  /** Section status. */
  readonly status: DraftSectionStatus
}

/** A bid draft under construction. */
export interface BidDraft {
  /** Template the draft follows, when known. */
  readonly templateId?: string
  /** Tender key facts echoed onto the cover. */
  readonly tender: {
    readonly projectName?: string
    readonly tenderNo?: string
    readonly purchaser?: string
  }
  /** Ordered sections. */
  readonly sections: readonly DraftSection[]
}

/** Coverage status of one scoring item against a bid. */
export type CoverageStatus = 'covered' | 'partial' | 'missing' | 'unverifiable'

/** One row of the coverage matrix. */
export interface CoverageItem {
  /** The scored scoring item id. */
  readonly scoringItemId: string
  /** The scored clause. */
  readonly clause: string
  /** Point value, when known. */
  readonly points?: number
  /** Pre-verdict status (deterministic keyword matching). */
  readonly status: CoverageStatus
  /** Draft sections with keyword hits. */
  readonly evidenceSectionTitles: readonly string[]
  /** Keyword tokens that hit the bid text. */
  readonly keywordHits: readonly string[]
  /** Recovery suggestion for non-covered items. */
  readonly suggestion?: string
}

/** Deterministic comparison report between a tender and a bid. */
export interface ComparisonReport {
  /** Scoring-point coverage matrix. */
  readonly coverage: readonly CoverageItem[]
  /** Fatal-clause response findings. */
  readonly fatalClauseFindings: readonly {
    readonly clause: string
    readonly addressed: boolean
    readonly locator: string
  }[]
  /** Format requirements to verify manually. */
  readonly formatIssues: readonly string[]
  /** Coverage totals. */
  readonly totals: {
    readonly scoringItems: number
    readonly covered: number
    readonly partial: number
    readonly missing: number
  }
  /** One-line human summary. */
  readonly summary: string
}
