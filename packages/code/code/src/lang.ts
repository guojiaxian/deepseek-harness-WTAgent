/**
 * Deterministic language detection.
 *
 * Detection prefers a known file extension over content heuristics, so a `.py`
 * file is always reported as Python regardless of how much it resembles another
 * language. When no extension matches (inline snippets, shell paste), a small set
 * of distinctive, low-collision tokens narrows the choice; otherwise the source
 * is classified as `unknown` and the complexity/function analyzers fall back to a
 * language-agnostic scan.
 * @module @deepseek-ai/dsh-code
 */

import type { Language } from './types.ts'

/** Extension → language mapping for the supported analyzers. */
const EXTENSIONS: Readonly<Record<string, Language>> = {
  '.py': 'python',
  '.pyi': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescript',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
}

/**
 * Resolve a language from its file extension case-insensitively.
 * @param fileName - file name to inspect.
 * @returns the language, or `unknown` when no extension matches.
 */
export function languageFromFileName(fileName: string | undefined): Language {
  if (fileName === undefined) return 'unknown'
  const lower = fileName.toLowerCase()
  for (const [ext, lang] of Object.entries(EXTENSIONS)) {
    if (lower.endsWith(ext)) return lang
  }
  return 'unknown'
}

/**
 * Classify source text by content when no extension is available.
 * @param source - source text to classify.
 * @returns the most likely language, or `unknown` when no hint matches.
 */
export function languageFromSource(source: string): Language {
  const head = source.slice(0, 4096)
  // Go's `func`, `:=`, and empty `select {}` are distinctive and rare in other C-family.
  if (/\bfunc\s+[A-Za-z_]\w*\s*\(/.test(head) || /:=\s*[A-Za-z_]\w*\s*\(/.test(head)) return 'go'
  // Rust's `use crate::` paths and `fn name(` signatures are distinctive.
  if (/\buse\s+[A-Za-z0-9_:]+::/.test(head) || /\bfn\s+[A-Za-z_]\w*\s*\(/.test(head)) return 'rust'
  if (/\b(def|class|elif|lambda|if __name__)\b/.test(head)) return 'python'
  if (/\b(package |public class|public static void main|interface |abstract class)\b/.test(head)) return 'java'
  return 'unknown'
}

/**
 * Detect the language of a source file.
 * @param fileName - optional file name; a known extension wins.
 * @param source - source text used as a fallback for extensionless input.
 * @returns the detected language.
 */
export function detectLanguage(fileName: string | undefined, source: string): Language {
  const byExtension = languageFromFileName(fileName)
  return byExtension === 'unknown' ? languageFromSource(source) : byExtension
}

/**
 * Whether a language has a dedicated function/complexity analyzer.
 * @param language - detected language to test.
 * @returns true when the language is known, false for the generic analyzer.
 */
export function hasFunctionAnalyzer(language: Language): boolean {
  return language !== 'unknown'
}
