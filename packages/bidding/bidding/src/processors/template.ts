/**
 * Bid template management: dual-root discovery with fail-loud validation.
 *
 * Shipped templates are compiled into the engine; user templates are JSON
 * files under a caller-provided root (the tool layer pins it to
 * `$DSH_HOME/bidding/templates/`). Both roots are rescanned on every call —
 * a template dropped into the user root is visible without a restart. Merge
 * rule: shipped first, user second, same id first-wins (a shipped template
 * can never be silently shadowed). Broken user files surface as `broken`
 * entries instead of being swallowed.
 * @module @deepseek-ai/dsh-bidding
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BiddingError } from '../errors.ts'
import type { BidTemplate, BidTemplateChapter, TemplateCategory } from '../types.ts'
import { SHIPPED_TEMPLATES } from '../templates/index.ts'
import { asArray, asBoolean, asEnum, asObject, asOptionalString, asString } from '../validate.ts'

/** Permitted template id pattern (preset-id style). */
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Permitted template categories. */
const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  'government-procurement', 'engineering', 'goods', 'services', 'custom',
]

/** Maximum characters of one chapter title. */
const TITLE_CHARS = 80
/** Maximum characters of one chapter's requirements text. */
const REQUIREMENT_CHARS = 1000

/** One broken user template file reported by discovery. */
export interface BrokenTemplateFile {
  readonly file: string
  readonly reason: string
}

/** The discovery result of {@link listTemplates}. */
export interface TemplateDiscovery {
  readonly templates: readonly BidTemplate[]
  readonly broken: readonly BrokenTemplateFile[]
}

/**
 * Validate an unknown JSON value as a {@link BidTemplate}.
 * @param value - the parsed JSON value of one template file.
 * @param file - source file name for error messages.
 * @returns the validated template.
 * @throws BiddingError `VALIDATION_ERROR` on any malformed field.
 */
export function parseTemplate(value: unknown, file: string): BidTemplate {
  const object = asObject(value, `template "${file}"`)
  const id = asString(object.id, `template "${file}" id`)
  if (!TEMPLATE_ID_PATTERN.test(id)) {
    throw new BiddingError(`template "${file}" id "${id}" must match ${TEMPLATE_ID_PATTERN.source}`, { code: 'VALIDATION_ERROR' })
  }
  const name = asString(object.name, `template "${id}" name`)
  const description = asOptionalString(object.description, `template "${id}" description`)
  const category = asEnum(object.category ?? 'custom', TEMPLATE_CATEGORIES, `template "${id}" category`)
  const chaptersValue = asArray(object.chapters, `template "${id}" chapters`)
  if (chaptersValue.length === 0) {
    throw new BiddingError(`template "${id}" has no chapters`, { code: 'VALIDATION_ERROR' })
  }
  const chapters: BidTemplateChapter[] = chaptersValue.map((chapterValue, index) => {
    const what = `template "${id}" chapter ${String(index)}`
    const chapter = asObject(chapterValue, what)
    const chapterId = asString(chapter.id, `${what} id`)
    const level = chapter.level
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 4) {
      throw new BiddingError(`${what} level must be an integer 1-4`, { code: 'VALIDATION_ERROR' })
    }
    const title = asString(chapter.title, `${what} title`).slice(0, TITLE_CHARS)
    const requirements = asOptionalString(chapter.requirements, `${what} requirements`)?.slice(0, REQUIREMENT_CHARS)
    const required = asBoolean(chapter.required ?? true, `${what} required`)
    const categoriesValue = asArray(chapter.materialCategories ?? [], `${what} materialCategories`)
    const materialCategories = categoriesValue.map(
      (item, categoryIndex) => asString(item, `${what} materialCategories ${String(categoryIndex)}`).toLowerCase(),
    )
    return {
      id: chapterId,
      level,
      title,
      ...(requirements !== undefined ? { requirements } : {}),
      required,
      ...(materialCategories.length > 0 ? { materialCategories } : {}),
    }
  })
  const seen = new Set<string>()
  for (const chapter of chapters) {
    if (seen.has(chapter.id)) {
      throw new BiddingError(`template "${id}" has duplicate chapter id "${chapter.id}"`, { code: 'VALIDATION_ERROR' })
    }
    seen.add(chapter.id)
  }
  return {
    id,
    name,
    ...(description !== undefined ? { description } : {}),
    category,
    chapters,
  }
}

/**
 * Load one template by id from the merged dual-root registry.
 * @param id - template id.
 * @param userRoot - user template root directory, when discovery includes it.
 * @returns the template.
 * @throws BiddingError `TEMPLATE_NOT_FOUND` when absent.
 */
export async function loadTemplate(id: string, userRoot?: string): Promise<BidTemplate> {
  const { templates } = await listTemplates(userRoot)
  const found = templates.find(template => template.id === id)
  if (found === undefined) {
    throw new BiddingError(`template "${id}" not found`, { code: 'TEMPLATE_NOT_FOUND' })
  }
  return found
}

/**
 * Discover templates from the shipped registry plus one user root.
 * @param userRoot - user template root directory; `undefined` skips the user
 * root entirely.
 * @returns merged templates (shipped first, same-id first-wins) plus broken
 * user file reports.
 */
export async function listTemplates(userRoot?: string): Promise<TemplateDiscovery> {
  const byId = new Map<string, BidTemplate>()
  const ordered: BidTemplate[] = []
  const put = (template: BidTemplate): void => {
    if (byId.has(template.id)) return
    byId.set(template.id, template)
    ordered.push(template)
  }
  for (const template of SHIPPED_TEMPLATES) put(template)

  const broken: BrokenTemplateFile[] = []
  if (userRoot !== undefined) {
    let names: string[] = []
    try {
      names = (await readdir(userRoot)).filter(name => name.endsWith('.json')).sort()
    } catch {
      // A missing or unreadable user root is not an error: the shipped
      // registry still serves, and the root materializes on first write.
      return { templates: ordered, broken }
    }
    for (const name of names) {
      try {
        const text = await readFile(join(userRoot, name), 'utf8')
        put(parseTemplate(JSON.parse(text) as unknown, name))
      } catch (error) {
        broken.push({
          file: name,
          reason: error instanceof BiddingError
            ? error.message
            : `unreadable or invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }
  return { templates: ordered, broken }
}
