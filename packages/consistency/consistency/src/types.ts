/**
 * Domain model and configuration types of the consistency-test engineering engine.
 *
 * The engine is deliberately dependency-free pure TypeScript: every processor is a
 * pure function over a {@link Workflow} value, so precision-sensitive work (台站
 * 重命名 → SAC 转换 → 裁波 → 绘图编排) is unit-testable in isolation and can be
 * embedded by any host without a Cordis runtime. The plugin in `index.ts` mounts
 * the same functions behind the `ctx.consistency` service.
 *
 * The engine only computes error-prone *domain* decisions (命名规则、北京时间→UTC、
 * 时间窗、文件名约定、批次分组) and a traceability {@link RunRecord}; the actual file
 * I/O (目录重命名、跑 mseed2sac 转换器、跑 obspy 裁波/绘图) is delegated to the agent
 * preset's `tool-bash`/`tool-fs`/`tool-web` tools guided by the engine's outputs.
 * @module @deepseek-ai/dsh-consistency
 */

/** Step processor types of the dense-array consistency pipeline. */
export type StepType = 'ingest' | 'rename' | 'convert' | 'cut' | 'plot' | 'exclude'

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

/** Seed file kind selected by the convert converter (mseed2sac vs e-mseed2sac). */
export type SeedKind = 'C' | 'E' | 'other'

/** One seed (mini-SEED) file discovered under a station directory. */
export interface SeedFile {
  /** Seed file name, e.g. `C0756_260818_...`. */
  readonly name: string
  /** Kind derived from the leading `C`/`E` prefix; selects the converter. */
  readonly kind: SeedKind
}

/** One dense-array station directory before/after the rename step. */
export interface Station {
  /** Original directory name, e.g. `C0756_260818`. */
  readonly sourceName: string
  /** Renamed target of `sourceName`: `C` stripped, else first 4 chars. */
  readonly targetName: string
  /** Whether the rename step changed this station's name. */
  readonly renameApplied: boolean
  /** Seed files discovered under the station directory. */
  readonly seedFiles: readonly SeedFile[]
}

/** One parsed arrival time window cut out of the continuous streams. */
export interface Arrival {
  /** The raw arrival line as written in `datetime.dat` (北京时间). */
  readonly line: string
  /** UTC ISO instant derived by subtracting the timezone offset. */
  readonly utc: string
  /** UTC label `YYYY-MM-DDTHHMMSS` used in the cut output file name. */
  readonly label: string
  /** Seconds to keep before the arrival (window start). */
  readonly cutBefore: number
  /** Seconds to keep after the arrival (window end). */
  readonly cutAfter: number
}

/** One plot batch: a group of stations rendered over one arrival window. */
export interface PlotBatch {
  /** UTC arrival label this batch belongs to. */
  readonly arrivalLabel: string
  /** 0-based batch index within an arrival directory. */
  readonly batchIndex: number
  /** Stations rendered in this batch, in rendering order. */
  readonly stations: readonly string[]
  /** Y-axis labels `WT.<station[:4]>`. */
  readonly yLabels: readonly string[]
  /** Vertical stack offsets (samples); the first station sits at the top. */
  readonly offsets: readonly number[]
  /** Maximum offset value in this batch (top of the canvas). */
  readonly yMax: number
  /** Vertical spacing between stacked traces. */
  readonly ySpacing: number
}

/** Metric the measured per-station offset was expressed in. */
export type OffsetMetric = 'samples' | 'dc-offset' | 'amplitude'

/** One measured per-station offset handed to an `exclude` step (by the preset). */
export interface StationOffset {
  /** Station target name the measured offset belongs to. */
  readonly station: string
  /** Measured offset magnitude under the metric's unit. */
  readonly value: number
  /** Optional human-readable measurement / provenance description. */
  readonly source?: string
}

/** One station reported by an `exclude` step as needing exclusion. */
export interface Exclusion {
  /** Station target name reported for exclusion. */
  readonly station: string
  /** Measured offset magnitude that reached the threshold. */
  readonly offset: number
  /** The configured threshold it met. */
  readonly threshold: number
  /** Metric the offset was measured under. */
  readonly metric: OffsetMetric
  /** Human-readable reason recorded for traceability. */
  readonly reason: string
  /** Restricting arrival slice (plot batch arrivalLabel) when scoped. */
  readonly arrivalLabel?: string
}

/** Workflow metadata: extension keys owned by processors or the ingest layer. */
export interface WorkflowMeta {
  /** Raw `datetime.dat` arrival lines awaiting the cut step's UTC parse. */
  readonly rawArrivalLines?: readonly string[]
  /** Ordered provenance notes appended by the pipeline. */
  readonly provenance?: readonly string[]
  /** Measured per-station offsets consumed by an `exclude` step. */
  readonly offsets?: readonly StationOffset[]
  /** Free-form extension keys. */
  readonly [key: string]: unknown
}

/**
 * The flowing state of a consistency pipeline. Each step reads and returns a
 * fresh {@link Workflow}; processors never mutate the value they receive.
 */
export interface Workflow {
  /** Project label, e.g. `0756_260818` (already rename-normalized). */
  readonly project: string
  /** Absolute base directory all relative roots resolve against. */
  readonly baseDir: string
  /** Directory containing the raw arrival directories (input). */
  readonly inputRoot: string
  /** Directory where SAC files are written after conversion. */
  readonly outputSacRoot: string
  /** Directory where cut waveforms are written. */
  readonly outputCutRoot: string
  /** Directory where plot figures are written. */
  readonly outputFigRoot: string
  /** Converter command for `C`-kind seeds (mseed2sac); may be null. */
  readonly converterC: string | null
  /** Converter command for `E`-kind seeds (e-mseed2sac); may be null. */
  readonly converterE: string | null
  /** Component channel (default `Z`) used by the cut/plot naming. */
  readonly channel: string
  /** Seconds to keep before the arrival; default 1. */
  readonly cutBefore: number
  /** Seconds to keep after the arrival; default 2. */
  readonly cutAfter: number
  /** Timezone offset hours (北京时间 −8 h → UTC); default 8. */
  readonly timezoneOffsetHours: number
  /** Stations per plot batch; default 40. */
  readonly batchSize: number
  /** Renamed (or as-ingested) stations. */
  readonly stations: readonly Station[]
  /** Arrival windows computed by the cut step. */
  readonly arrivals: readonly Arrival[]
  /** Plot batches computed by the plot step. */
  readonly plotBatches: readonly PlotBatch[]
  /** Stations reported by the exclude step as needing exclusion (manual removal). */
  readonly exclusions: readonly Exclusion[]
  /** Workflow metadata. */
  readonly meta: WorkflowMeta
}

/** Raw input handed to an `ingest` step. Text formats may also pass a decoded string. */
export interface ProcessingInput {
  /** Input format; the consistency ingest accepts `json` (interchange only). */
  readonly format: string
  /** Raw bytes for binary formats; UTF-8 text may also be passed for `json`. */
  readonly data: Uint8Array | string
  /** Optional source label recorded in the ingested workflow's meta. */
  readonly source?: string
}

/** Resource limits enforced after every processing step. */
export interface Limits {
  /** Maximum accepted input byte length. */
  readonly maxInputBytes: number
  /** Maximum number of stations kept. */
  readonly maxStations: number
  /** Maximum number of seed files kept across all stations. */
  readonly maxSeedFiles: number
  /** Maximum number of arrival windows kept. */
  readonly maxArrivals: number
}

/** Compact shape of a workflow, used for traceability records. */
export interface WorkflowSummary {
  readonly stationCount: number
  readonly seedFileCount: number
  readonly arrivalCount: number
  readonly plotBatchCount: number
  /** sha256 over the canonical workflow serialization. */
  readonly checksum: string
}

/** Input fingerprint recorded at the start of a run. */
export interface InputSummary {
  readonly format: string
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
  /** sha256 of the step's input workflow (raw input bytes for an ingest step). */
  readonly inputHash: string
  readonly outputSummary: WorkflowSummary
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
 * Full traceability record of one pipeline execution. `output` is the workflow
 * state after the last completed step (empty for a failure during ingest).
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
  readonly output: Workflow
  readonly outputSummary: WorkflowSummary
}

/** Result of one processor invocation: the transformed workflow plus audit notes. */
export interface ProcessorResult {
  readonly workflow: Workflow
  readonly notes: readonly string[]
}

/** Configuration for an `ingest` step: directory roots and timing defaults. */
export interface IngestConfig {
  /** Base directory the relative roots resolve against. */
  baseDir?: string
  /** Directory containing the raw arrival directories (input). */
  inputRoot?: string
  /** Directory where SAC files are written after conversion. */
  outputSacRoot?: string
  /** Directory where cut waveforms are written. */
  outputCutRoot?: string
  /** Directory where plot figures are written. */
  outputFigRoot?: string
  /** Converter command for `C`-kind seeds; may be null to defer validation. */
  converterC?: string | null
  /** Converter command for `E`-kind seeds; may be null to defer validation. */
  converterE?: string | null
  /** Component channel used by the cut/plot naming; default `Z`. */
  channel?: string
  /** Seconds to keep before the arrival; default 1. */
  cutBefore?: number
  /** Seconds to keep after the arrival; default 2. */
  cutAfter?: number
  /** Timezone offset hours (北京时间 −8 h → UTC); default 8. */
  timezoneOffsetHours?: number
  /** Stations per plot batch; default 40. */
  batchSize?: number
}

/** Configuration for a `rename` step; renames operate on workflow fields only. */
export interface RenameConfig {
  /** No tunables; the rename rule (strip `C`, else first 4 chars) is fixed. */
  [key: string]: never
}

/** Configuration for a `convert` step; converter validation reuses workflow fields. */
export interface ConvertConfig {
  /** Override converter command for `C`-kind seeds for this step. */
  converterC?: string | null
  /** Override converter command for `E`-kind seeds for this step. */
  converterE?: string | null
}

/** Configuration for a `cut` step: arrival window and output timing. */
export interface CutConfig {
  /** Seconds to keep before the arrival; default 1. */
  cutBefore?: number
  /** Seconds to keep after the arrival; default 2. */
  cutAfter?: number
  /** Timezone offset hours (北京时间 −8 h → UTC); default 8. */
  timezoneOffsetHours?: number
  /** Output root for cut waveforms; defaults to the workflow root. */
  outputCutRoot?: string
}

/** Configuration for a `plot` step: figure root, channel and batch size. */
export interface PlotConfig {
  /** Output root for plot figures; defaults to the workflow root. */
  outputFigRoot?: string
  /** Component channel used for the `*.chan.SAC` file name; default `Z`. */
  channel?: string
  /** Stations per plot batch; default 40. */
  batchSize?: number
}

/** Configuration for an `exclude` step: offset threshold and measurement metric. */
export interface ExcludeConfig {
  /** Absolute offset magnitude at or above which a station is reported for exclusion. */
  threshold: number
  /** Metric the offsets were measured under; default `samples`. */
  metric?: OffsetMetric
  /** Restrict exclusion reporting to one arrival slice (plot batch arrival label). */
  arrivalLabel?: string
}

/** Resource-limit configuration of the consistency service. */
export interface ConsistencyConfig {
  /** Named pipelines registered at load; registered names must be unique. */
  pipelines?: Pipeline[]
  /** Maximum accepted input bytes; default 8 MiB. */
  maxInputBytes?: number
  /** Maximum stations kept; default 10 000. */
  maxStations?: number
  /** Maximum seed files kept; default 100 000. */
  maxSeedFiles?: number
  /** Maximum arrival windows kept; default 10 000. */
  maxArrivals?: number
}
