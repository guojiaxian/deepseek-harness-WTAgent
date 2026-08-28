/**
 * Document generation: structured config, format validation, and the `.docx` /
 * `.doc` renderers.
 *
 * Export consumes a {@link Paper} and a resolved {@link DocumentConfig}; the
 * same config drives both renderers so layout stays consistent across formats.
 * @module @deepseek-ai/dsh-paper
 */

export * from './config.ts'
export * from './docx.ts'
export * from './reference.ts'
export * from './rtf.ts'
