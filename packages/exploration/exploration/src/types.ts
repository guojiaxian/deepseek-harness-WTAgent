/**
 * Domain model and configuration types of the exploration data processing engine.
 *
 * The engine is deliberately dependency-free pure TypeScript: every processor is a
 * pure function over {@link Dataset} values, so precision-sensitive work (SEG-Y
 * decoding, unit conversion, statistics) is unit-testable in isolation and can be
 * embedded by any host without a Cordis runtime. The plugin in `index.ts` mounts the
 * same functions behind the `ctx.exploration` service.
 * @module @deepseek-ai/dsh-exploration
 */

/** Logical cell type of one column. `datetime` marks ISO-8601-like strings. */
export type CellType = 'number' | 'string' | 'boolean' | 'datetime' | 'unknown'

/** One cell value. `null` is a missing value, distinct from `0`, `''`, and `false`. */
export type CellValue = number | string | boolean | null

/** Column metadata of a tabular exploration dataset. */
export interface Column {
  /** Column name; unique within a dataset. */
  readonly name: string
  /** Logical cell type of the column. */
  readonly type: CellType
  /** Optional physical unit (e.g. `m`, `g/cm3`, `mV`, `us`). */
  readonly unit?: string
  /** Optional geophysical role (e.g. `depth`, `inline`, `amplitude`). */
  readonly role?: string
  /** Optional free-form description. */
  readonly description?: string
}

/**
 * Dataset metadata. The declared keys are maintained by the engine; processors add
 * extension keys (e.g. `statistics`, `anomalies`, SEG-Y header fields) under the
 * index signature.
 */
export interface DatasetMeta {
  /** Source file name or inline label the dataset was ingested from. */
  readonly source?: string
  /** Number of data rows, kept in sync by every processor. */
  readonly rowCount?: number
  /** Ordered provenance notes; the pipeline appends one line per step. */
  readonly provenance?: readonly string[]
  /** Free-form extension keys owned by processors or the ingest layer. */
  readonly [key: string]: unknown
}

/**
 * Positional table: `rows[r][c]` is the cell at column `c` of row `r`. Processors
 * treat values as immutable and always return a fresh {@link Dataset}.
 */
export interface Dataset {
  readonly columns: readonly Column[]
  readonly rows: readonly (readonly CellValue[])[]
  readonly meta: DatasetMeta
}

/** Step processor types. `ingest` turns raw input into a dataset; the rest transform or render one. */
export type StepType = 'ingest' | 'clean' | 'convert' | 'extract' | 'detect' | 'profile'

/** One pipeline step: a processor type plus its configuration. */
export interface PipelineStep {
  /** Step id, unique within its pipeline. */
  id: string
  /** Processor type that handles this step. */
  type: StepType
  /** Processor-specific configuration object. */
  config: unknown
  /** Optional human-readable step description. */
  description?: string
}

/** A named, ordered processing pipeline. The first step must be `ingest`. */
export interface Pipeline {
  /** Pipeline name, unique within the service registry. */
  name: string
  /** Optional pipeline description. */
  description?: string
  /** Ordered step list; the first step must be `ingest`. */
  steps: PipelineStep[]
}

/** Raw input handed to an `ingest` step. Text formats may also pass a decoded string. */
export interface ProcessingInput {
  /** Input format: `csv`, `json`, or `segy` (case-insensitive). */
  readonly format: string
  /** Raw bytes for binary formats; UTF-8 text may also be passed for `csv`/`json`. */
  readonly data: Uint8Array | string
  /** Optional source label recorded in the ingested dataset's meta. */
  readonly source?: string
}

/** Resource limits enforced after every processing step. */
export interface Limits {
  /** Maximum accepted input byte length. */
  readonly maxInputBytes: number
  /** Maximum row count after any step. */
  readonly maxRows: number
  /** Maximum column count after any step. */
  readonly maxColumns: number
  /** Maximum number of anomaly records kept in one detection result. */
  readonly maxAnomalyRecords: number
}

/** Compact shape of a dataset, used for traceability records. */
export interface DatasetSummary {
  readonly rowCount: number
  readonly columnCount: number
  /** `rows x columns` shape string. */
  readonly shape: string
  /** sha256 over the canonical dataset serialization. */
  readonly checksum: string
}

/** Input fingerprint recorded at the start of a run. */
export interface InputSummary {
  readonly format: string
  readonly rowCount: number
  readonly bytes: number
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
  /** sha256 of the step's input dataset (raw input bytes for an ingest step). */
  readonly inputHash: string
  readonly outputSummary: DatasetSummary
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
 * Full traceability record of one pipeline execution. `output` is the dataset state
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
  readonly output: Dataset
  readonly outputSummary: DatasetSummary
}

/** One detected anomaly record. `row` is the 0-based row index into the dataset. */
export interface AnomalyRecord {
  readonly column: string
  readonly row: number
  readonly value: CellValue
  readonly kind: 'zscore' | 'iqr' | 'threshold' | 'spike' | 'deadTrace' | 'null'
  readonly detail: string
}

/** Result of one processor invocation: the transformed dataset plus audit notes. */
export interface ProcessorResult {
  readonly dataset: Dataset
  readonly notes: readonly string[]
}

// Processor configuration types. These are the shared contract between the engine
// API, the model-facing tools, and declarative pipeline configs. They are written
// as mutable input contracts (hosts build and hand them in); processors never
// mutate the values they receive.

/** Configuration for an `ingest` step. */
export interface IngestConfig {
  /** CSV field delimiter; default `,`. */
  delimiter?: string
  /** Whether the first CSV line names the columns; default true. */
  hasHeader?: boolean
  /** Trim surrounding whitespace from unquoted CSV fields and header names; default true. */
  trim?: boolean
  /** Infer per-column cell types; default true. */
  inferTypes?: boolean
  /** SEG-Y: emit long format (`trace`, `sampleIndex`, `value`, geometry); default true. */
  longFormat?: boolean
  /** SEG-Y: parse at most this many samples per trace when present. */
  sampleLimit?: number
}

/** Configuration for a `clean` step. */
export interface CleanConfig {
  /** Missing-value policy; default keeps missing cells untouched. */
  missing?: {
    action: 'drop' | 'fill' | 'keep'
    /** Fill value for `action: 'fill'`; required then. */
    value?: CellValue
  }
  /** Numeric range rules applied per column. */
  ranges?: {
    column: string
    min?: number
    max?: number
    action: 'clamp' | 'drop' | 'error'
  }[]
  /** Remove duplicate rows; `{ columns }` restricts the key. */
  dedupe?: boolean | { columns?: string[] }
  /** Drop the named columns. */
  dropColumns?: string[]
  /** Rename columns from → to. */
  renameColumns?: { from: string; to: string }[]
  /** Trim surrounding whitespace from string cells. */
  trimStrings?: boolean
  /** Coerce named columns to a target cell type. */
  columnTypes?: { column: string; type: 'number' | 'string' | 'boolean' }[]
}

/** Configuration for a `convert` step. */
export interface ConvertConfig {
  /** Linear/affine unit conversions applied per column. */
  units?: { column: string; from: string; to: string }[]
  /** Depth ↔ two-way-time (TWT) conversion, `t = 2d/v` with `v` in m/s. */
  depthTime?: {
    mode: 'depth-to-time' | 'time-to-depth'
    depthColumn: string
    timeColumn: string
    /** Seismic velocity in m/s. */
    velocity: number
    /** TWT output unit for `depth-to-time`; default `ms`. */
    outputUnit?: 'ms' | 's'
  }
  /** Keep only the named columns, in order. */
  selectColumns?: string[]
}

/** Configuration for an `extract` step. */
export interface ExtractConfig {
  /** Per-column descriptive statistics; default computes over all numeric columns. */
  statistics?: {
    /** Columns to summarize; default all numeric columns. */
    columns?: string[]
  }
  /** Rolling-window columns to compute over a numeric column. */
  rolling?: {
    column: string
    window: number
    operation: 'mean' | 'std' | 'min' | 'max'
    /** Output column name. */
    output: string
  }[]
  /** Rolling RMS amplitude columns. */
  rms?: {
    column: string
    window: number
    output?: string
  }[]
}

/** Configuration for a `detect` step. */
export interface DetectConfig {
  /** Flag values deviating more than `threshold` standard deviations from the mean. */
  zscore?: { column: string; threshold?: number }[]
  /** Flag values outside the IQR `k`-rule (default k = 1.5). */
  iqr?: { column: string; k?: number }[]
  /** Flag values outside a hard `[min, max]` window. */
  threshold?: { column: string; min?: number; max?: number }[]
  /** Flag short-window spikes (default window 3, 5× median absolute diff). */
  spike?: { column: string; window?: number; threshold?: number }[]
  /** Flag dead traces: a trace group whose samples are all equal. */
  deadTrace?: { sampleColumns?: string[] }[]
  /** Flag rows containing missing cells. */
  nulls?: { columns?: string[] }[]
}

/** Configuration for a `profile` step: seismic section rendering. */
export interface ProfileConfig {
  /** Output formats; default `['svg', 'png']`. */
  formats?: ('svg' | 'png')[]
  /** Raster width in pixels; default 640, at most 1024. */
  width?: number
  /** Raster height in pixels; default 480, at most 1024. */
  height?: number
  /** Color map applied to the amplitude section; default `seismic`. */
  colorMap?: 'seismic' | 'grayscale' | 'jet'
  /** Optional title rendered on the SVG output. */
  title?: string
}

/** Rendering summary attached to the dataset meta as `profile`. */
export interface ProfileOutput {
  /** The formats actually rendered. */
  readonly formats: readonly ('svg' | 'png')[]
  /** Raster width in pixels. */
  readonly width: number
  /** Raster height in pixels. */
  readonly height: number
  /** Color map used for the amplitude section. */
  readonly colorMap: 'seismic' | 'grayscale' | 'jet'
  /** Section kind; only seismic sections are supported. */
  readonly kind: 'seismic'
  /** Number of traces in the section. */
  readonly traceCount: number
  /** Number of samples per trace in the section. */
  readonly sampleCount: number
  /** SVG document with the embedded raster, when `svg` is in `formats`. */
  readonly svg?: string
  /** Base64-encoded PNG of the raster, when `png` is in `formats`. */
  readonly png?: string
  /** Optional title carried from the profile config. */
  readonly title?: string
}

/** Resource-limit configuration of the exploration service. */
export interface ExplorationConfig {
  /** Named pipelines registered at load; registered names must be unique. */
  pipelines?: Pipeline[]
  /** Maximum accepted input bytes; default 8 MiB. */
  maxInputBytes?: number
  /** Maximum rows after any step; default 50 000. */
  maxRows?: number
  /** Maximum columns after any step; default 1024. */
  maxColumns?: number
  /** Maximum anomaly records kept per detection; default 500. */
  maxAnomalyRecords?: number
}
