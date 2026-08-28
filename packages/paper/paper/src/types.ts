/**
 * Domain model and configuration types of the academic paper-writing engine.
 *
 * The engine is deliberately dependency-free pure TypeScript: every processor is a
 * pure function over {@link Paper} values, so revision heuristics, format
 * normalization, and citation formatting are unit-testable in isolation and can be
 * embedded by any host without a Cordis runtime. The plugin in `index.ts` mounts the
 * same functions behind the `ctx.paper` service.
 * @module @deepseek-ai/dsh-paper
 */

/** Logical role of one manuscript section. */
export type SectionKind = 'abstract' | 'heading' | 'paragraph'

/** Step processor types. `ingest` turns raw manuscript text into a paper; the rest transform one. */
export type StepType = 'ingest' | 'revise' | 'format' | 'cite'

/** Source kind of a cited reference, used by the citation formatters. */
export type ReferenceSourceKind = 'journal' | 'book' | 'conference' | 'thesis' | 'web'

/** Citation style supported by the `cite` processor. */
export type CitationStyle = 'gb7714' | 'apa' | 'mla'

/** One manuscript section: an optional heading plus its paragraphs. */
export interface PaperSection {
  /** Section kind; sections without a heading are plain paragraphs. */
  readonly kind: SectionKind
  /** Section heading, when the parsed line was a heading. */
  readonly heading?: string
  /** Heading level (number of `#` marks), for markdown-sourced sections. */
  readonly level?: number
  /** Paragraph texts in order. */
  readonly paragraphs: readonly string[]
}

/** A raw cited reference: a stable id plus unformatted text. */
export interface InputCitation {
  /** Stable in-document reference id (e.g. `[1]` or `@smith2020`). */
  readonly id: string
  /** Unformatted reference text as it appears in the manuscript. */
  readonly text: string
}

/** A parsed, optionally reformatted reference entry. */
export interface Citation {
  /** Stable in-document reference id. */
  readonly id: string
  /** Raw reference text the citation was parsed from. */
  readonly raw: string
  /** Source kind detected by the reference parser. */
  readonly kind: ReferenceSourceKind
  /** Author names in source order. */
  readonly authors: readonly string[]
  /** Publication year, as a string. */
  readonly year: string
  /** Title of the work. */
  readonly title: string
  /** Journal, conference proceedings, or website name. */
  readonly source?: string
  /** Volume, for journal and monograph references. */
  readonly volume?: string
  /** Issue, for journal references. */
  readonly issue?: string
  /** Page range, for journal and conference references. */
  readonly pages?: string
  /** Publisher and location, for books and theses. */
  readonly publisher?: string
  /** Edition, for books. */
  readonly edition?: string
  /** Digital Object Identifier, when present. */
  readonly doi?: string
  /** Access URL, for web references. */
  readonly url?: string
  /** Formatted citation string for the target style, set by the `cite` processor. */
  readonly formatted?: string
}

/**
 * A manuscript under edit. The declared keys are maintained by the engine; the
 * `meta` index signature carries extension keys (revision suggestions, format
 * findings) owned by processors.
 */
export interface Paper {
  /** Document title, parsed from the first heading line. */
  readonly title?: string
  /** Abstract text, when the manuscript had an abstract section. */
  readonly abstract?: string
  /** Ordered sections parsed from the manuscript. */
  readonly sections: readonly PaperSection[]
  /** Cited references; ingest parses the raw list, cite re-formats it. */
  readonly citations: readonly Citation[]
  /** Free-form extension keys owned by processors or the ingest layer. */
  readonly meta: {
    readonly provenance?: readonly string[]
    readonly suggestions?: readonly Suggestion[]
    readonly findings?: readonly FormatFinding[]
    readonly [key: string]: unknown
  }
}

/** One detected editing suggestion from a `revise` step. */
export interface Suggestion {
  /** Section index the suggestion applies to. */
  readonly sectionIndex: number
  /** Paragraph index within the section. */
  readonly paragraphIndex: number
  /** Rule id that produced the suggestion. */
  readonly rule: string
  /** Human-readable explanation. */
  readonly message: string
  /** Original matched text. */
  readonly before: string
  /** Suggested replacement text. */
  readonly after: string
}

/** One format finding from a `format` step. */
export interface FormatFinding {
  /** Rule id that produced the finding. */
  readonly rule: string
  /** Human-readable message. */
  readonly message: string
}

/** Result of one processor invocation: the transformed paper plus audit notes. */
export interface ProcessorResult {
  readonly paper: Paper
  readonly notes: readonly string[]
}

/** A named, ordered processing pipeline. The first step must be `ingest`. */
export interface Pipeline {
  /** Pipeline name, unique within the service registry. */
  readonly name: string
  /** Optional pipeline description. */
  readonly description?: string
  /** Ordered step list; the first step must be `ingest`. */
  readonly steps: readonly PipelineStep[]
}

/** One pipeline step: a processor type plus its configuration. */
export interface PipelineStep {
  /** Step id, unique within its pipeline. */
  readonly id: string
  /** Processor type that handles this step. */
  readonly type: StepType
  /** Processor-specific configuration object. */
  readonly config: unknown
  /** Optional human-readable step description. */
  readonly description?: string
}

/** Raw manuscript input handed to an `ingest` step. */
export interface ProcessingInput {
  /** Input format: `text` or `markdown` (case-insensitive). */
  readonly format: string
  /** Manuscript text. */
  readonly data: string
  /** Optional source label recorded in the paper meta. */
  readonly source?: string
}

/** Resource limits enforced by the paper engine. */
export interface Limits {
  /** Maximum accepted input byte length. */
  readonly maxInputBytes: number
  /** Maximum section count after any step. */
  readonly maxSections: number
  /** Maximum paragraph count within a section. */
  readonly maxParagraphs: number
  /** Maximum citation count. */
  readonly maxCitations: number
  /** Maximum revision suggestions and format findings retained. */
  readonly maxFindings: number
  /** Maximum generated document size in bytes; default 16 MiB. */
  readonly maxOutputBytes?: number
}

/** Compact shape of a paper, used for traceability records. */
export interface PaperSummary {
  readonly sectionCount: number
  readonly citationCount: number
  readonly characterCount: number
  /** sha256 over the canonical paper serialization. */
  readonly checksum: string
}

/** Input fingerprint recorded at the start of a run. */
export interface InputSummary {
  readonly format: string
  readonly bytes: number
  readonly characterCount: number
  readonly checksum: string
}

/** Traceability record of one completed pipeline step. */
export interface StepRecord {
  readonly id: string
  readonly type: StepType
  readonly description?: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly status: 'completed' | 'failed'
  /** Error message when this step failed; the run record carries the full code. */
  readonly error?: string
  /** sha256 of the step's input paper (raw input bytes for an ingest step). */
  readonly inputHash: string
  readonly outputSummary: PaperSummary
  readonly notes: readonly string[]
}

/** Structured error detail attached to a failed run record. */
export interface RunError {
  readonly code: string
  readonly message: string
  /** Failing step id, when the failure happened inside a step. */
  readonly stepId?: string
}

/**
 * Full traceability record of one pipeline execution. `output` is the paper state
 * after the last completed step (empty for a failure during ingest).
 */
export interface RunRecord {
  readonly runId: string
  readonly pipelineName: string
  readonly pipelineDescription?: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly status: 'completed' | 'failed'
  readonly error?: RunError
  readonly input: InputSummary
  readonly steps: readonly StepRecord[]
  readonly output: Paper
  readonly outputSummary: PaperSummary
}

// Processor configuration types. These are the shared contract between the engine
// API, the model-facing tools, and declarative pipeline configs.

/** Configuration for an `ingest` step. */
export interface IngestConfig {
  /** Parse markdown headings (`#`) as section headings; default true. */
  readonly markdownHeadings?: boolean
  /** Treat a first line of `# Title` as the document title; default true. */
  readonly detectTitle?: boolean
  /** Lines that match this pattern start a new section heading. */
  readonly sectionPattern?: string
}

/** Configuration for a `revise` step (论文内容智能修改与优化). */
export interface ReviseConfig {
  /** Apply wordiness and clarity rewrite rules; default true. */
  readonly clarity?: boolean
  /** Detect and flag passive-voice clauses; default false. */
  readonly flagPassiveVoice?: boolean
  /** Detect flag/cliché phrasing the engine cannot safely rewrite; default true. */
  readonly flagClichés?: boolean
  /** Maximum suggestions retained; overrides the engine limit. */
  readonly maxFindings?: number
}

/** Configuration for a `format` step (学术论文格式标准化校正). */
export interface FormatConfig {
  /** Normalize heading numbering (`1`, `1.1`, `2`); default true. */
  readonly numberedHeadings?: boolean
  /** Normalize inter-word and inter-sentence spacing; default true. */
  readonly spacing?: boolean
  /** Normalize ambiguous English quotes to curved pairs; default true. */
  readonly typographicQuotes?: boolean
  /** Attach a period to every citation marker in running text; default true. */
  readonly citationMarks?: boolean
  /** Maximum findings retained; overrides the engine limit. */
  readonly maxFindings?: number
}

/** Configuration for a `cite` step (参考文献格式自动化整理与规范化). */
export interface CiteConfig {
  /** Target citation style: `gb7714`, `apa`, or `mla`. */
  readonly style: CitationStyle
  /** Sort entries, keyed by author + year; default false preserves source order. */
  readonly sort?: boolean
  /** Maximum citations to format; overrides the engine limit. */
  readonly maxCitations?: number
}

/** Resource-limit configuration of the paper service. */
export interface PaperConfig {
  /** Named pipelines registered at load; registered names must be unique. */
  readonly pipelines?: Pipeline[]
  /** Maximum accepted input bytes; default 8 MiB. */
  readonly maxInputBytes?: number
  /** Maximum sections after any step; default 200. */
  readonly maxSections?: number
  /** Maximum paragraphs within a section; default 200. */
  readonly maxParagraphs?: number
  /** Maximum citations; default 500. */
  readonly maxCitations?: number
  /** Maximum suggestions and findings retained; default 200. */
  readonly maxFindings?: number
  /** Maximum generated document size in bytes; default 16 MiB. */
  readonly maxOutputBytes?: number
}
