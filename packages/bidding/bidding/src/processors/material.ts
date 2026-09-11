/**
 * Historical material library: trusted CRUD plus deterministic search over a
 * caller-pinned root directory (the tool layer resolves it to
 * `$DSH_HOME/bidding/materials/`, so materials persist across sessions and
 * projects). One material per `<id>.json` file, atomic tmp+rename writes, no
 * index files — every operation rescans the directory, capped by
 * `limits.maxMaterials`.
 *
 * Search scoring is deliberately deterministic: title/tag exact and prefix
 * hits outweigh content keyword hits; semantic "does this material fit this
 * scoring item" stays with the model, which sees the ranked candidate list.
 * @module @deepseek-ai/dsh-bidding
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { checksumText } from '../checksum.ts'
import { BiddingError } from '../errors.ts'
import type { Limits, Material } from '../types.ts'
import { asArray, asBoolean, asObject, asOptionalString, asString } from '../validate.ts'

/** Material id pattern: `m-<16 hex>`. */
const MATERIAL_ID_PATTERN = /^m-[0-9a-f]{16}$/
/** Maximum characters of one material title. */
const TITLE_CHARS = 120
/** Preview length of search results without `includeContent`. */
const PREVIEW_CHARS = 200
/** Maximum characters of one material source label. */
const SOURCE_CHARS = 120

/** Input of {@link saveMaterial}. */
export interface MaterialInput {
  readonly category: string
  readonly title: string
  readonly content: string
  readonly tags?: readonly string[]
  readonly source?: string
}

/** Options of {@link searchMaterials}. */
export interface SearchOptions {
  readonly query?: string
  readonly category?: string
  readonly tags?: readonly string[]
  readonly includeContent?: boolean
}

/** One search hit. */
export interface MaterialHit {
  readonly material: Material
  readonly score: number
  readonly preview?: string
}

/** Entropy for material ids so identical payloads saved twice stay distinct. */
function materialEntropy(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Normalize a category label to kebab-case (lowercase, ASCII letters/digits,
 * dashes; CJK runs collapse to single dashes and are trimmed).
 * @param category - raw category label.
 * @returns the normalized category.
 */
export function normalizeCategory(category: string): string {
  return category.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Validate an unknown JSON value as a {@link Material}.
 * @param value - the parsed JSON value of one material file.
 * @param file - source file name for error messages.
 * @returns the validated material.
 * @throws BiddingError `VALIDATION_ERROR` on malformed fields.
 */
export function parseMaterial(value: unknown, file: string): Material {
  const object = asObject(value, `material "${file}"`)
  const id = asString(object.id, `material "${file}" id`)
  if (!MATERIAL_ID_PATTERN.test(id)) {
    throw new BiddingError(`material file "${file}" has malformed id "${id}"`, { code: 'VALIDATION_ERROR' })
  }
  const category = asString(object.category, `material "${id}" category`)
  const title = asString(object.title, `material "${id}" title`).slice(0, TITLE_CHARS)
  const content = asString(object.content, `material "${id}" content`)
  const tagsValue = asArray(object.tags ?? [], `material "${id}" tags`)
  const tags = tagsValue.map((tag, index) => asString(tag, `material "${id}" tag ${String(index)}`).slice(0, 60))
  const source = asOptionalString(object.source, `material "${id}" source`)?.slice(0, SOURCE_CHARS)
  const createdAt = asString(object.createdAt, `material "${id}" createdAt`)
  const updatedAt = asString(object.updatedAt, `material "${id}" updatedAt`)
  return {
    id,
    category,
    title,
    content,
    tags,
    ...(source !== undefined ? { source } : {}),
    createdAt,
    updatedAt,
  }
}

/**
 * Save one material into the library root (create or replace by id).
 * @param root - the library root directory.
 * @param input - the material payload.
 * @param limits - resource limits.
 * @returns the saved material.
 * @throws BiddingError `VALIDATION_ERROR` on malformed input;
 * `LIMIT_EXCEEDED` when content size or library size caps are hit.
 */
export async function saveMaterial(root: string, input: unknown, limits: Limits): Promise<Material> {
  const object = asObject(input, 'material')
  const category = normalizeCategory(asString(object.category, 'material category'))
  if (category === '') {
    throw new BiddingError('material category is empty after normalization', { code: 'VALIDATION_ERROR' })
  }
  const title = asString(object.title, 'material title').slice(0, TITLE_CHARS)
  const content = asString(object.content, 'material content')
  if (content.trim() === '') {
    throw new BiddingError('material content must not be empty', { code: 'VALIDATION_ERROR' })
  }
  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes > limits.maxMaterialBytes) {
    throw new BiddingError(`material content is ${String(contentBytes)} bytes, exceeding the ${String(limits.maxMaterialBytes)}-byte cap`, {
      code: 'LIMIT_EXCEEDED',
      details: { measured: contentBytes, cap: limits.maxMaterialBytes, recovery: 'split the material or raise maxMaterialBytes' },
    })
  }
  const tags = asArray(object.tags ?? [], 'material tags')
    .map((tag, index) => asString(tag, `material tag ${String(index)}`).slice(0, 60))
    .map(tag => tag.toLowerCase())
  const source = asOptionalString(object.source, 'material source')?.slice(0, SOURCE_CHARS)

  await mkdir(root, { recursive: true })
  const existing = await readdir(root).catch(() => [] as string[])
  const count = existing.filter(name => name.endsWith('.json') && !name.startsWith('.')).length
  if (count >= limits.maxMaterials) {
    throw new BiddingError(`material library holds ${String(count)} materials, refusing to grow it`, {
      code: 'LIMIT_EXCEEDED',
      details: { measured: count, cap: limits.maxMaterials, recovery: 'remove unused materials or raise maxMaterials' },
    })
  }
  const id = `m-${checksumText(`${title}|${content}|${Date.now().toString(36)}|${materialEntropy()}`).slice(0, 16)}`
  const now = new Date().toISOString()
  const material: Material = {
    id,
    category,
    title,
    content,
    tags,
    ...(source !== undefined ? { source } : {}),
    createdAt: now,
    updatedAt: now,
  }
  const finalPath = join(root, `${id}.json`)
  const tempPath = join(root, `.${id}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(material, null, 2)}\n`, 'utf8')
  await rename(tempPath, finalPath)
  return material
}

/**
 * Load every material in the library root.
 * @param root - the library root directory.
 * @returns the materials (broken files skipped).
 */
export async function loadMaterials(root: string): Promise<readonly Material[]> {
  let names: string[] = []
  try {
    names = (await readdir(root)).filter(name => name.endsWith('.json') && !name.startsWith('.')).sort()
  } catch {
    return []
  }
  const materials: Material[] = []
  for (const name of names) {
    try {
      const text = await readFile(join(root, name), 'utf8')
      materials.push(parseMaterial(JSON.parse(text) as unknown, name))
    } catch {
      // A single broken file never blinds the whole library; the search
      // result count simply excludes it.
    }
  }
  return materials
}

/**
 * Deterministically score one material against the search options.
 * @param material - the candidate material.
 * @param query - free-text query, when present.
 * @returns the score; higher is better.
 */
function scoreOf(material: Material, query: string | undefined): number {
  if (query === undefined || query === '') return 1
  const normalized = query.trim().toLowerCase()
  if (normalized === '') return 1
  let score = 0
  if (material.title.toLowerCase() === normalized) score += 60
  else if (material.title.toLowerCase().includes(normalized)) score += 30
  else if (material.title.toLowerCase().startsWith(normalized.slice(0, 2))) score += 8
  const tags = material.tags.map(tag => tag.toLowerCase())
  if (tags.includes(normalized)) score += 50
  else if (tags.some(tag => tag.includes(normalized))) score += 25
  if (material.category.toLowerCase().includes(normalized)) score += 15
  if (material.content.toLowerCase().includes(normalized)) score += 12
  return score
}

/**
 * Search the material library with deterministic scoring.
 * @param root - the library root directory.
 * @param options - search options.
 * @param limits - resource limits.
 * @returns the ranked hits (highest score first).
 */
export async function searchMaterials(root: string, options: SearchOptions, limits: Limits): Promise<readonly MaterialHit[]> {
  const includeContent = asBoolean(options.includeContent ?? false, 'includeContent')
  const category = options.category !== undefined ? normalizeCategory(options.category) : undefined
  const tags = options.tags?.map(tag => tag.toLowerCase()) ?? []
  const materials = await loadMaterials(root)
  const hits: MaterialHit[] = []
  for (const material of materials.slice(0, limits.maxMaterials)) {
    if (category !== undefined && material.category !== category) continue
    if (tags.length > 0 && !tags.some(tag => material.tags.map(candidate => candidate.toLowerCase()).includes(tag))) continue
    const score = scoreOf(material, options.query) + tags.reduce(
      (bonus, tag) => bonus + (material.tags.map(candidate => candidate.toLowerCase()).includes(tag) ? 10 : 0),
      0,
    )
    if (score <= 0) continue
    hits.push({
      material,
      score,
      // exactOptionalPropertyTypes: preview only appears when truncated.
      ...(includeContent ? {} : { preview: material.content.slice(0, PREVIEW_CHARS) }),
    })
  }
  hits.sort((a, b) => b.score - a.score || a.material.id.localeCompare(b.material.id))
  return hits
}

/**
 * Resolve material ids against the library root for draft provenance checks.
 * @param root - the library root directory.
 * @param ids - the referenced material ids.
 * @returns the id → material map (missing ids absent).
 */
export async function resolveMaterials(root: string, ids: readonly string[]): Promise<Map<string, Material>> {
  const materials = await loadMaterials(root)
  const byId = new Map(materials.map(material => [material.id, material]))
  const resolved = new Map<string, Material>()
  for (const id of ids) {
    const material = byId.get(id)
    if (material !== undefined) resolved.set(id, material)
  }
  return resolved
}

/**
 * Look up one material by id.
 * @param root - the library root directory.
 * @param id - the material id.
 * @returns the material.
 * @throws BiddingError `MATERIAL_NOT_FOUND` when absent or unreadable.
 */
export async function loadMaterial(root: string, id: string): Promise<Material> {
  try {
    const text = await readFile(join(root, `${id}.json`), 'utf8')
    return parseMaterial(JSON.parse(text) as unknown, `${id}.json`)
  } catch {
    throw new BiddingError(`material "${id}" not found`, { code: 'MATERIAL_NOT_FOUND' })
  }
}
