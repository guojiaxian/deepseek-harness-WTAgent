/**
 * `revise` step processor: 论文内容智能修改与优化 (intelligent content revision).
 *
 * Detects and applies deterministic clarity rewrites to paragraph prose, then
 * optionally flags passive-voice and cliché phrasing that the engine cannot
 * safely rewrite itself. Every rewrite or flag is recorded as a structured
 * {@link Suggestion} so a host (or the model-facing tools) can show, accept, or
 * reject each edit. Parallel wordiness fixes (double spaces) are folded into the
 * clarity pass. The `maxFindings` budget caps retained suggestions.
 * @module @deepseek-ai/dsh-paper
 */

import { carryMeta, withMeta } from '../manuscript.ts'
import type { Limits, Paper, ProcessorResult, ReviseConfig, Suggestion } from '../types.ts'
import { asBoolean, asNumber, checkKeys, checkObject } from './validate.ts'

/** Wordiness → concise replacement rules, applied in declaration order. */
const CLARITY_RULES: ReadonlyArray<{ pattern: RegExp; replacement: string; rule: string; message: string }> = [
  { pattern: /\bdue to the fact that\b/gi, replacement: 'because', rule: 'wordy.due-to', message: 'replaced "due to the fact that" with "because"' },
  { pattern: /\bin order to\b/gi, replacement: 'to', rule: 'wordy.in-order-to', message: 'replaced "in order to" with "to"' },
  { pattern: /\ba number of\b/gi, replacement: 'several', rule: 'wordy.a-number-of', message: 'replaced "a number of" with "several"' },
  { pattern: /\bat this point in time\b/gi, replacement: 'now', rule: 'wordy.at-this-point-in-time', message: 'replaced "at this point in time" with "now"' },
  { pattern: /\bwith regard to\b/gi, replacement: 'regarding', rule: 'wordy.with-regard-to', message: 'replaced "with regard to" with "regarding"' },
  { pattern: /\bconsensus of opinion\b/gi, replacement: 'consensus', rule: 'pleonasm.consensus', message: 'removed redundant "of opinion"' },
  { pattern: /\s{2,}/g, replacement: ' ', rule: 'spacing.double', message: 'collapsed double spaces' },
]

/** Cliché phrases the engine flags but does not rewrite. */
const CLICHÉS: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /\bin this day and age\b/i, message: 'cliché "in this day and age" reads as tired phrasing' },
  { pattern: /\bat the end of the day\b/i, message: 'cliché "at the end of the day" adds no precision' },
  { pattern: /\bthink outside the box\b/i, message: 'cliché "think outside the box" is vague' },
]

/** Passive-voice markers: a be-verb followed by a past participle. */
const PASSIVE = /\b(?:is|are|was|were|be|been|being)\s+(\w+ed)\b/gi

/**
 * Validate a `revise` step config.
 * @param config - raw config value.
 * @returns the typed config.
 */
export function validate(config: unknown): ReviseConfig {
  const obj = checkObject(config, 'revise config')
  checkKeys(obj, ['clarity', 'flagPassiveVoice', 'flagClichés', 'maxFindings'], 'revise')
  return {
    ...(obj.clarity !== undefined ? { clarity: asBoolean(obj.clarity, 'revise.clarity') } : {}),
    ...(obj.flagPassiveVoice !== undefined ? { flagPassiveVoice: asBoolean(obj.flagPassiveVoice, 'revise.flagPassiveVoice') } : {}),
    ...(obj.flagClichés !== undefined ? { flagClichés: asBoolean(obj.flagClichés, 'revise.flagClichés') } : {}),
    ...(obj.maxFindings !== undefined ? { maxFindings: asNumber(obj.maxFindings, 'revise.maxFindings') } : {}),
  }
}

/**
 * Run a `revise` step.
 * @param paper - input paper.
 * @param config - validated revise config.
 * @param limits - resource limits; `maxFindings` caps retained suggestions.
 * @returns the revised paper plus audit notes.
 */
export function run(paper: Paper, config: ReviseConfig, limits: Limits): ProcessorResult {
  const clarity = config.clarity ?? true
  const flagPassive = config.flagPassiveVoice ?? false
  const flagClichés = config.flagClichés ?? true
  const maxFindings = Math.floor(Math.min(config.maxFindings ?? limits.maxFindings, limits.maxFindings))
  const suggestions: Suggestion[] = []

  const sections = paper.sections.map((section, si) => {
    const paragraphs = section.paragraphs.map((paragraph, pi) => {
      let text = paragraph
      if (clarity) text = applyClarity(text, si, pi, suggestions, maxFindings)
      if (flagPassive) flagPassiveIn(text, si, pi, suggestions, maxFindings)
      if (flagClichés) flagClichésIn(text, si, pi, suggestions, maxFindings)
      return text
    })
    return {
      kind: section.kind,
      ...(section.heading !== undefined ? { heading: section.heading } : {}),
      paragraphs,
    }
  })

  const meta = carryMeta(paper.meta)
  if (suggestions.length > 0) meta.suggestions = suggestions
  const revised = withMeta({ ...paper, sections }, meta)
  const notes = suggestions.length > 0
    ? [`revised ${suggestions.length} passage${suggestions.length === 1 ? '' : 's'}`]
    : ['no clarity revisions suggested']
  return { paper: revised, notes }
}

/** Apply all clarity rewrite rules to a paragraph, recording each change. */
function applyClarity(text: string, si: number, pi: number, suggestions: Suggestion[], max: number): string {
  let out = text
  for (const rule of CLARITY_RULES) {
    out = out.replace(rule.pattern, (match) => {
      pushSuggestion(suggestions, si, pi, rule.rule, rule.message, match, rule.replacement, max)
      return rule.replacement
    })
  }
  return out.trim()
}

/** Find and flag passive-voice clauses without rewriting them. */
function flagPassiveIn(text: string, si: number, pi: number, suggestions: Suggestion[], max: number): void {
  text.replace(PASSIVE, (match) => {
    pushSuggestion(suggestions, si, pi, 'voice.passive', `passive clause "${match}" — consider active voice`, match, '', max)
    return match
  })
}

/** Find and flag cliché phrases without rewriting them. */
function flagClichésIn(text: string, si: number, pi: number, suggestions: Suggestion[], max: number): void {
  for (const cliché of CLICHÉS) {
    text.replace(cliché.pattern, (match) => {
      pushSuggestion(suggestions, si, pi, 'cliche', cliché.message, match, '', max)
      return match
    })
  }
}

/** Append a suggestion, truncating to the retained budget. */
function pushSuggestion(
  list: Suggestion[], si: number, pi: number, rule: string,
  message: string, before: string, after: string, max: number,
): void {
  if (list.length >= max) return
  list.push({
    sectionIndex: si,
    paragraphIndex: pi,
    rule,
    message,
    before,
    after,
  })
}
