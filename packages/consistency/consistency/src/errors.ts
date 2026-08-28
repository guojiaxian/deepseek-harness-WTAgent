/**
 * Structured errors raised by the consistency-test engine.
 *
 * Every processor and pipeline step throws {@link ConsistencyError} carrying a
 * stable machine-readable `code` and optional run/step context. The pipeline
 * records the message, code, and step on the failed {@link RunRecord} instead of
 * propagating the exception, so a failing step never aborts the rest of a run.
 * @module @deepseek-ai/dsh-consistency
 */

/** Stable machine-readable error codes of the consistency engine. */
export type ConsistencyErrorCode =
  | 'INVALID_ARGUMENT'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_STEP'
  | 'UNKNOWN_PIPELINE'
  | 'DATA_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'INCOMPLETE_DATA'

/**
 * An error raised by the consistency engine. The `code` is stable API surface;
 * the message is human-readable and safe to surface to a caller.
 */
export class ConsistencyError extends Error {
  /** Stable machine-readable error code. */
  readonly code: ConsistencyErrorCode
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
    readonly code: ConsistencyErrorCode
    readonly runId?: string
    readonly stepId?: string
    readonly details?: unknown
  }) {
    super(message)
    this.name = 'ConsistencyError'
    this.code = options.code
    // exactOptionalPropertyTypes: optional fields are only assigned when present.
    if (options.runId !== undefined) this.runId = options.runId
    if (options.stepId !== undefined) this.stepId = options.stepId
    if (options.details !== undefined) this.details = options.details
  }
}
