/**
 * Model-facing `paper_*` tools over the `@deepseek-ai/dsh-paper` engine's pure
 * processors. Every tool validates its arguments through the engine's own config
 * schemas, runs the matching processor, and returns a compact JSON paper plus
 * section/citation counts and provenance notes; the run tool returns the engine's
 * full traceability record. Named exports only (no default), preserving loader
 * injection metadata.
 * @module @deepseek-ai/dsh-tool-paper
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Limits, Paper, ProcessingInput, ProcessorResult } from '@deepseek-ai/dsh-paper'
import {
  cite, format, ingest, renderDocument, revise, runPipeline, validateDocumentConfig, validatePipeline,
} from '@deepseek-ai/dsh-paper'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-paper'

/** Services required by the tool plugin. */
export const inject = ['tools']

/** Resource-limit configuration of the model-facing paper tools. */
export interface Config {
  /** Maximum accepted input bytes; default 8 MiB. */
  maxInputBytes?: number
  /** Maximum sections after any step; default 200. */
  maxSections?: number
  /** Maximum paragraphs within a section; default 200. */
  maxParagraphs?: number
  /** Maximum citations; default 500. */
  maxCitations?: number
  /** Maximum suggestions and findings retained; default 200. */
  maxFindings?: number
  /** Maximum generated document size in bytes; default 16 MiB. */
  maxOutputBytes?: number
}

/** Schemastery config for the tool consumer. */
export const Config: z<Config> = z.object({
  maxInputBytes: z.number().default(8 * 1024 * 1024),
  maxSections: z.number().default(200),
  maxParagraphs: z.number().default(200),
  maxCitations: z.number().default(500),
  maxFindings: z.number().default(200),
  maxOutputBytes: z.number().default(16 * 1024 * 1024),
})

const DEFAULT_MAX_INPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_SECTIONS = 200
const DEFAULT_MAX_PARAGRAPHS = 200
const DEFAULT_MAX_CITATIONS = 500
const DEFAULT_MAX_FINDINGS = 200
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/**
 * Materialize the resource limits even when `apply` is called directly outside
 * Loader normalization.
 * @param config - plugin configuration.
 * @returns the fully populated limits.
 */
function resolveConfig(config: Config): Limits {
  return {
    maxInputBytes: config.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxSections: config.maxSections ?? DEFAULT_MAX_SECTIONS,
    maxParagraphs: config.maxParagraphs ?? DEFAULT_MAX_PARAGRAPHS,
    maxCitations: config.maxCitations ?? DEFAULT_MAX_CITATIONS,
    maxFindings: config.maxFindings ?? DEFAULT_MAX_FINDINGS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
}

/**
 * Rebuild a readonly engine {@link Paper} into a plain mutable JSON value.
 * The engine types are readonly and carry an open meta index signature, so the
 * cast records that the rebuilt object is JSON-safe by construction.
 * @param paper - engine paper to project.
 * @returns the paper as a plain JSON value.
 */
function paperToValue(paper: Paper): JsonValue {
  return {
    ...(paper.title !== undefined ? { title: paper.title } : {}),
    ...(paper.abstract !== undefined ? { abstract: paper.abstract } : {}),
    sections: paper.sections.map(section => ({
      kind: section.kind,
      ...(section.heading !== undefined ? { heading: section.heading } : {}),
      ...(section.level !== undefined ? { level: section.level } : {}),
      paragraphs: [...section.paragraphs],
    })),
    citations: paper.citations.map(citation => ({ ...citation })),
    meta: { ...paper.meta },
  } as unknown as JsonValue
}

/** The compact model-facing result every transform tool returns. */
interface TransformToolValue {
  paper: JsonValue
  sectionCount: number
  citationCount: number
  notes: string[]
}

/** Project one processor result into the compact transform value. */
function transformValue(result: ProcessorResult): TransformToolValue {
  return {
    paper: paperToValue(result.paper),
    sectionCount: result.paper.sections.length,
    citationCount: result.paper.citations.length,
    notes: [...result.notes],
  }
}

/** Re-export the engine's public types for host composition. */
export type {
  Paper, IngestConfig, ReviseConfig, FormatConfig, CiteConfig, DocumentConfig,
  RunRecord, Pipeline, ProcessingInput, Limits,
} from '@deepseek-ai/dsh-paper'

/** Shared output schema of the transform tools. */
const TRANSFORM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paper: { type: 'json', required: true },
    sectionCount: { type: 'integer', required: true },
    citationCount: { type: 'integer', required: true },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Output schema of the pipeline run tool. */
const RUN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runId: { type: 'string', required: true },
    pipelineName: { type: 'string', required: true },
    pipelineDescription: { type: 'string' },
    startedAt: { type: 'string', required: true },
    finishedAt: { type: 'string', required: true },
    durationMs: { type: 'number', required: true },
    status: { type: 'string', required: true, enum: ['completed', 'failed'] },
    error: { type: 'object', additionalProperties: true },
    input: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        format: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        characterCount: { type: 'integer', required: true },
        checksum: { type: 'string', required: true },
      },
    },
    steps: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
    output: { type: 'json', required: true },
    outputSummary: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        sectionCount: { type: 'integer', required: true },
        citationCount: { type: 'integer', required: true },
        characterCount: { type: 'integer', required: true },
        checksum: { type: 'string', required: true },
      },
    },
  },
} as const

/** Output schema of the document export tool. */
const EXPORT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fileName: { type: 'string', required: true },
    format: { type: 'string', required: true, enum: ['doc', 'docx'] },
    bytes: { type: 'integer', required: true },
    checksum: { type: 'string', required: true },
    dataBase64: { type: 'string', required: true },
  },
} as const

/** The compact model-facing pipeline run result. */
interface RunToolValue {
  runId: string
  pipelineName: string
  pipelineDescription?: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: 'completed' | 'failed'
  error?: Record<string, JsonValue>
  input: { format: string; bytes: number; characterCount: number; checksum: string }
  steps: Record<string, JsonValue>[]
  output: JsonValue
  outputSummary: { sectionCount: number; citationCount: number; characterCount: number; checksum: string }
}

/** Generic, args-only pending presentation shared by the paper tools. */
function present(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', rawInput }
}

/**
 * Register the six paper tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's resource-limit policy.
 */
export function apply(ctx: Context, config: Config): void {
  const limits = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'paper_ingest',
    description: 'Parse raw manuscript text (plain text or Markdown) into a structured paper with sections and references.',
    parameters: {
      format: {
        type: 'string',
        required: true,
        enum: ['text', 'markdown'],
        description: 'Input manuscript format.',
      },
      data: { type: 'string', required: true, description: 'The raw manuscript text.' },
      source: { type: 'string', description: 'Optional source label recorded in the paper meta.' },
      config: { type: 'json', description: 'Ingest options (markdownHeadings, detectTitle, sectionPattern).' },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (args, value) => [{
        type: 'text',
        text: `Ingested ${args.format} as ${value.sectionCount} sections, ${value.citationCount} references — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = ingest.validate(args.config ?? {})
      const input: ProcessingInput = {
        format: args.format,
        data: args.data,
        ...(args.source !== undefined ? { source: args.source } : {}),
      }
      return Promise.resolve(transformValue(ingest.run(input, cfg, limits)))
    },
    presentCall: args => present('Ingest manuscript', args),
  }))

  ctx.tools.register(defineTool({
    name: 'paper_revise',
    description: 'Analyze a paper for content-revision suggestions: clarity rewrites, passive-voice detection, and cliché flagging.',
    parameters: {
      paper: { type: 'json', required: true, description: 'The paper JSON from a prior paper_* tool.' },
      config: {
        type: 'json',
        required: true,
        description: 'Revise options (clarity, flagPassiveVoice, flagClichés, maxFindings).',
      },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Revised ${value.sectionCount} sections, ${value.citationCount} references — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = revise.validate(args.config)
      return Promise.resolve(transformValue(revise.run(args.paper as unknown as Paper, cfg, limits)))
    },
    presentCall: args => present('Revise manuscript', args),
  }))

  ctx.tools.register(defineTool({
    name: 'paper_format',
    description: 'Standardize a paper: number headings, normalize spacing, curve ambiguous quotes, and complete citation marks.',
    parameters: {
      paper: { type: 'json', required: true, description: 'The paper JSON from a prior paper_* tool.' },
      config: {
        type: 'json',
        description: 'Format options (numberedHeadings, spacing, typographicQuotes, citationMarks, maxFindings).',
      },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Formatted ${value.sectionCount} sections, ${value.citationCount} references — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = format.validate(args.config ?? {})
      return Promise.resolve(transformValue(format.run(args.paper as unknown as Paper, cfg, limits)))
    },
    presentCall: args => present('Format manuscript', args),
  }))

  ctx.tools.register(defineTool({
    name: 'paper_cite',
    description: 'Format a paper\'s references in a target style (GB/T 7714, APA, or MLA), optionally sorting entries.',
    parameters: {
      paper: { type: 'json', required: true, description: 'The paper JSON from a prior paper_* tool.' },
      config: {
        type: 'json',
        required: true,
        description: 'Cite options (style: gb7714|apa|mla, sort, maxCitations).',
      },
    },
    output: {
      schema: TRANSFORM_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Cited ${value.citationCount} references — ${value.notes.join('; ')}`,
      }],
    },
    execute(args) {
      const cfg = cite.validate(args.config)
      return Promise.resolve(transformValue(cite.run(args.paper as unknown as Paper, cfg, limits)))
    },
    presentCall: args => present('Format references', args),
  }))

  ctx.tools.register(defineTool({
    name: 'paper_run',
    description: 'Run a full paper pipeline (ingest first, then revise/format/cite steps) and return the traceability record.',
    parameters: {
      format: {
        type: 'string',
        required: true,
        enum: ['text', 'markdown'],
        description: 'Input manuscript format.',
      },
      data: { type: 'string', required: true, description: 'The raw manuscript text.' },
      source: { type: 'string', description: 'Optional source label recorded in the ingested paper meta.' },
      pipeline: { type: 'json', required: true, description: 'Named pipeline whose first step is ingest.' },
    },
    output: {
      schema: RUN_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Run ${value.runId} [${value.pipelineName}] ${value.status}: ${value.steps.length} steps, output ${value.outputSummary.sectionCount} sections / ${value.outputSummary.citationCount} references`,
      }],
    },
    execute(args) {
      const pipeline = validatePipeline(args.pipeline)
      const input: ProcessingInput = {
        format: args.format,
        data: args.data,
        ...(args.source !== undefined ? { source: args.source } : {}),
      }
      // The engine's traceability record is readonly and holds an open Paper;
      // it is JSON-safe by construction and matches RUN_OUTPUT_SCHEMA, so the
      // cast only bridges the readonly engine types to the mutable JSON value.
      return Promise.resolve(runPipeline(input, pipeline, limits, randomUUID()) as unknown as RunToolValue)
    },
    presentCall: args => present('Run paper pipeline', args),
  }))

  ctx.tools.register(defineTool({
    name: 'paper_export',
    description: 'Generate a .docx or .doc document from a paper with structured layout (headers, footers, page numbers, fonts, spacing, margins).',
    parameters: {
      paper: { type: 'json', required: true, description: 'The paper JSON from a prior paper_* tool.' },
      format: {
        type: 'string',
        required: true,
        enum: ['doc', 'docx'],
        description: 'Output document format.',
      },
      config: {
        type: 'json',
        description: 'Document layout (headerText, footerText, pageNumbers, fontFamily, fontSizePt, lineSpacing, paragraphSpacingPt, marginsMm).',
      },
    },
    output: {
      schema: EXPORT_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `Exported ${value.bytes} byte ${value.format} document as ${value.fileName} (sha256 ${value.checksum.slice(0, 8)})`,
      }],
    },
    execute(args) {
      const config = validateDocumentConfig(args.config ?? {})
      const output = renderDocument(args.paper as unknown as Paper, args.format, config, limits)
      const paper = args.paper as { readonly title?: string } | null | undefined
      return Promise.resolve({
        fileName: `${safeFileBase(paper?.title)}.${output.format}`,
        format: output.format,
        bytes: output.bytes,
        checksum: output.checksum,
        dataBase64: Buffer.from(output.data).toString('base64'),
      })
    },
    presentCall: args => present('Export document', args),
  }))
}

/**
 * Derive a URL-safe file base name from a paper title, falling back to
 * `document` when the title is absent or contains only punctuation.
 * @param title - paper title.
 * @returns a filesystem-safe base name without an extension.
 */
function safeFileBase(title: string | undefined): string {
  const base = (title ?? 'document').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return base === '' ? 'document' : base
}
