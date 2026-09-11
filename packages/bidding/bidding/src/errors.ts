/**
 * Structured errors raised by the bidding engine.
 *
 * Every processor throws {@link BiddingError} carrying a stable
 * machine-readable `code` and optional structured detail, so the model-facing
 * tools can surface a recovery hint instead of a bare stack trace.
 * @module @deepseek-ai/dsh-bidding
 */

/** Stable machine-readable error codes of the bidding engine. */
export type BiddingErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_FORMAT'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'MATERIAL_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'

/**
 * An error raised by the bidding engine. The `code` is stable API surface; the
 * message is human-readable and safe to surface to a caller.
 */
export class BiddingError extends Error {
  /** Stable machine-readable error code. */
  readonly code: BiddingErrorCode
  /** Optional structured detail attached by the raising processor. */
  readonly details?: unknown

  /**
   * @param message - human-readable error message.
   * @param options - error code and optional structured detail.
   */
  constructor(message: string, options: {
    readonly code: BiddingErrorCode
    readonly details?: unknown
  }) {
    super(message)
    this.name = 'BiddingError'
    this.code = options.code
    // exactOptionalPropertyTypes: optional fields are only assigned when present.
    if (options.details !== undefined) this.details = options.details
  }
}
