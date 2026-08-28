/**
 * Structured errors raised by the paper engine.
 *
 * Every processor and pipeline step throws {@link PaperError} carrying a stable
 * machine-readable `code` and optional run/step context. The pipeline records the
 * message, code, and step on the failed {@link RunRecord} instead of propagating
 * the exception, so a failing step never aborts the rest of a run.
 * @module @deepseek-ai/dsh-paper
 */

/** Stable machine-readable error codes of the paper engine. */
export type PaperErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_FORMAT'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_STEP'
  | 'UNKNOWN_PIPELINE'
  | 'DATA_ERROR'
  | 'LIMIT_EXCEEDED'

/**
 * An error raised by the paper engine. The `code` is stable API surface;
 * the message is human-readable and safe to surface to a caller.
 */
export class PaperError extends Error {
  /** Stable machine-readable error code. */
  readonly code: PaperErrorCode
  /** Run id of the pipeline execution that raised this error, when known. */
  readonly runId?: string
  /** Id of the step that raised this error, when known. */
  readonly stepId?: string
  /** Optional structured detail attached by the raising processor. */
  readonly details?: unknown

  /**
   * @param message - human-readable error message.
   * @param options - error code and optional run/step context.
   */
  constructor(message: string, options: {
    readonly code: PaperErrorCode
    readonly runId?: string
    readonly stepId?: string
    readonly details?: unknown
  }) {
    super(message)
    this.name = 'PaperError'
    this.code = options.code
    // exactOptionalPropertyTypes: optional fields are only assigned when present.
    if (options.runId !== undefined) this.runId = options.runId
    if (options.stepId !== undefined) this.stepId = options.stepId
    if (options.details !== undefined) this.details = options.details
  }
}
