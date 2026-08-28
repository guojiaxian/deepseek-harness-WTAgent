/**
 * Structured errors raised by the code analysis engine.
 *
 * Every analyzer throws {@link CodeError} carrying a stable machine-readable
 * `code`, so the model-facing tools can surface a consistent error shape whether
 * the failure comes from validation, an unsupported language, or a resource cap.
 * @module @deepseek-ai/dsh-code
 */

/** Stable machine-readable error codes of the code engine. */
export type CodeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'LIMIT_EXCEEDED'
  | 'UNSUPPORTED_LANGUAGE'

/**
 * An error raised by the code analysis engine. The `code` is stable API surface;
 * the message is human-readable and safe to surface to a caller.
 */
export class CodeError extends Error {
  /** Stable machine-readable error code. */
  readonly code: CodeErrorCode
  /** Optional structured detail attached by the raising analyzer. */
  readonly details?: unknown

  /**
   * @param message - human-readable error message.
   * @param options - error code and optional structured detail.
   */
  constructor(message: string, options: { readonly code: CodeErrorCode; readonly details?: unknown }) {
    super(message)
    this.name = 'CodeError'
    this.code = options.code
    // exactOptionalPropertyTypes: optional fields are only assigned when present.
    if (options.details !== undefined) this.details = options.details
  }
}
