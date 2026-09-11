# Agent Note: Bid document authoring agent (dsh-bidding)

Status: proposed

English | [中文](2026-09-02-dsh-bidding-agent.zh.md)

## Problem

As technology-transfer projects enter their growth phase, frequent tendering produces a heavy, repetitive bid-document workload. Bid authoring reuses the same material over and over (company qualifications, track record, technical approach), must satisfy strict per-market formatting templates (each trading center and agency has its own), is slow, and manual self-checks against the scoring criteria miss items — with disqualification as the failure mode.

The framework already ships two structurally identical professional agents: the [exploration data-processing agent](../../../../packages/preset/agent-presets/presets/exploration/agent.cordis.yml) and the [academic paper-writing agent](../../../../packages/preset/agent-presets/presets/paper/agent.cordis.yml), both built as "engine pure processors + model-facing tools + preset composition". Bid authoring is the same shape of problem (professional domain, structured document input/output, traceable processing), but no bidding engine, tools, or preset exist today. The Web client also accepts image uploads only: tender documents (.docx binaries of several MiB) cannot enter, and generated bids cannot leave — remote browser users cannot reach the server filesystem.

## Proposal

Add a **bid document authoring agent (bidding preset)** that reuses the proven exploration/paper three-layer architecture and closes four capability gaps:

1. **Tender parsing**: a dependency-free .docx reader (node:zlib inflate + a lightweight OOXML parser) that decomposes the chapter structure and extracts scoring items, disqualification/star clauses, and a key-facts table;
2. **Template management**: four built-in generic chapter skeletons (government procurement / engineering / goods / services), extensible with custom templates in `$DSH_HOME/bidding/templates/` (same shipped + user dual-root pattern as presets);
3. **Material reuse**: a material library persisted under `$DSH_HOME/bidding/materials/`, shared across sessions and projects; retrieval is deterministic tag/keyword matching, with semantic selection done by the model;
4. **Word generation and comparison**: one-shot rendering of a format-accurate .docx from a structured draft (cover, TOC field, multi-level headings, tables, headers/footers, page numbers); `bidding_compare` runs a deterministic scoring-point coverage pre-screen between tender requirements and bid content, producing a structured coverage matrix that the agent turns into a final omissions-and-risk report.

The model surface is seven `bidding_*` tools (matching exploration's seven). Web integration is phased: phase 1 rides the existing preset surfaces (new-session chip, default setting, session-header label, management section) at zero UI cost; phase 2 adds document upload (browser drop → materialized into the session workspace); phase 3 adds a download affordance on export-shaped tool results.

## Overall architecture

### Three layers and package topology

Aligned strictly with `packages/exploration/` and `packages/paper/`:

| Layer | Package | Responsibility | Reference |
|---|---|---|---|
| Engine | `@deepseek-ai/dsh-bidding` (`packages/bidding/bidding/`) | Pure processors + docx read/write format layer + built-in templates; no Cordis dependency | `packages/exploration/exploration/` |
| Tools | `@deepseek-ai/dsh-tool-bidding` (`packages/bidding/tool-bidding/`) | `defineTool` × 7, `inject = ['tools', 'fs']` | `packages/exploration/tool-exploration/` |
| Composition | `presets/bidding/` (agent.cordis.yml + preset.yml) | AGENT-PLANE composition: persona + shell/fs tools + bidding tools | `presets/exploration/` |

The single deviation from exploration: bidding tools must read tender files from the session workspace, so the tool plugin additionally injects the `fs` service (`tool-fs` itself is `inject = ['tools', 'fs', 'systemPrompt']` — injecting the host sandboxed filesystem into an agent scope is established practice). Reads go through `ctx.fs.readBytes` under sandbox policy; no existing defense line is bypassed.

### Directory plan

```
packages/bidding/
├── bidding/                        # @deepseek-ai/dsh-bidding engine
│   ├── src/
│   │   ├── index.ts                # named exports + type re-exports
│   │   ├── types.ts                # TenderDocument / BidTemplate / Material / BidDraft / ComparisonReport / Limits
│   │   ├── errors.ts               # BiddingError (machine code + recovery guidance)
│   │   ├── limits.ts               # Limits resolution and defaults
│   │   ├── format/
│   │   │   ├── zip-read.ts         # ZIP reading: local-header walk + inflateRaw, zip-bomb hardening
│   │   │   ├── zip-write.ts        # store-only ZIP writer (table-driven CRC-32, paper pattern)
│   │   │   ├── xml.ts              # lightweight XML state machine (no DTD/external entities → XXE-immune)
│   │   │   ├── docx-read.ts        # docx → RawDocument (paragraph/style/table block stream)
│   │   │   └── docx-write.ts       # BidDocument → OOXML (tables/cover/TOC field)
│   │   ├── processors/
│   │   │   ├── parse-tender.ts     # RawDocument → TenderDocument (chapter tree/scoring/fatal clauses/key facts)
│   │   │   ├── template.ts         # template discovery (dual root)/validation/read
│   │   │   ├── material.ts         # material CRUD/search (trusted IO, fixed root)
│   │   │   ├── draft.ts            # draft assembly/validation/material-reference resolution
│   │   │   ├── render.ts           # BidDraft → docx bytes
│   │   │   └── compare.ts          # coverage comparison / risk pre-screen (deterministic)
│   │   └── templates/              # built-in templates (shipped via package files)
│   │       ├── government-procurement.json
│   │       ├── engineering.json
│   │       ├── goods.json
│   │       └── services.json
│   └── tests/
└── tool-bidding/                   # @deepseek-ai/dsh-tool-bidding
    ├── src/index.ts                # the seven bidding_* tools
    └── tests/

packages/preset/agent-presets/presets/bidding/
├── agent.cordis.yml                # persona + tool-bash/pwsh + tool-fs(-search) + tool-bidding + ask-user/todo/web
└── preset.yml                      # name: 标书制作 Agent / order: 7
```

The tool package depends on the engine (workspace dependency), peer-depends on `dsh-tools` and `cordis`, and starts at `0.1.0-rc.1` — mirroring `tool-exploration`'s package.json shape.

## Data model

Core readonly types in engine `types.ts` (all JSON-safe, directly usable as tool output):

```ts
/** Key facts extracted from the tender (best-effort; absent fields omitted). */
interface TenderMeta {
  projectName?: string; tenderNo?: string; purchaser?: string; agency?: string
  deadline?: string; openAt?: string; bond?: string; contact?: string
  qualification?: string[]   // qualification requirement summaries
  deliverables?: string[]
}

/** Tender chapter-tree node. */
interface TenderSection {
  id: string                 // stable hash id (title + numbering)
  level: number              // heading level (1-based)
  number: string             // original numbering (e.g. "三", "（二）", "3.1")
  title: string
  summary: string            // first-paragraph summary, truncated to 200 chars
  charCount: number
  locator: string            // e.g. "§3.1 投标须知", for report references
}

/** Scoring item (from the scoring-methods chapter). */
interface ScoringItem {
  id: string; clause: string; points?: number
  criteria: string           // verbatim scoring criterion
  category: 'technical' | 'commercial' | 'price' | 'qualification'
  locator: string
}

/** Disqualification / rejection / starred clause. */
interface FatalClause {
  id: string; clause: string; locator: string
  kind: 'disqualification' | 'star' | 'mandatory'
}

interface TenderDocument {
  meta: TenderMeta
  sections: TenderSection[]          // flat array; level carries hierarchy
  scoring: ScoringItem[]
  fatalClauses: FatalClause[]
  formatRequirements: string[]       // verbatim format/binding/signature requirements
  warnings: string[]                 // low-confidence hints for model-side fallback
}

/** Bid template. */
interface BidTemplateChapter {
  id: string; level: number; title: string
  requirements?: string              // writing guidance for the chapter
  required: boolean
  materialCategories?: string[]      // suggested material categories
}
interface BidTemplate {
  id: string                         // filename without extension, PRESET_ID-style constraint
  name: string; description?: string
  category: 'government-procurement' | 'engineering' | 'goods' | 'services' | 'custom'
  chapters: BidTemplateChapter[]
}

/** Reusable material. */
interface Material {
  id: string                         // m-<16hex>
  category: string                   // normalized kebab-case (open set)
  title: string; content: string     // Markdown text
  tags: string[]; source?: string    // originating bid/project name
  createdAt: string; updatedAt: string
}

/** Bid draft (authored chapter by chapter by the model; tools validate and normalize). */
interface DraftSection {
  templateChapterId?: string         // linked template chapter
  title: string; level: number
  content: string                    // Markdown (tables allowed)
  materialIds?: string[]             // provenance references to reused material
  status: 'outline' | 'drafted'
}
interface BidDraft {
  templateId?: string
  tender: { projectName?: string; tenderNo?: string; purchaser?: string }
  sections: DraftSection[]
}

/** Comparison report (deterministic pre-screen portion). */
interface CoverageItem {
  scoringItemId: string; clause: string; points?: number
  status: 'covered' | 'partial' | 'missing' | 'unverifiable'
  evidenceSectionTitles: string[]    // draft sections with hits
  keywordHits: string[]
  suggestion?: string
}
interface ComparisonReport {
  coverage: CoverageItem[]
  fatalClauseFindings: { clause: string; addressed: boolean; locator: string }[]
  formatIssues: string[]
  totals: { scoringItems: number; covered: number; partial: number; missing: number }
  summary: string
}
```

## Tool surface

Seven model-facing tools (naming, parameter style, and `presentCall`/`render` conventions identical to `exploration_*`; every output schema `additionalProperties: false`):

| Tool | Key parameters | Output highlights |
|---|---|---|
| `bidding_parse_tender` | `path?` (workspace-relative) or `dataBase64?`+`fileName?` | `TenderDocument` projection; also writes a full-text Markdown sidecar `<source>.extracted.md` into the workspace (when sandbox policy permits) for later tool-fs chapter reads |
| `bidding_list_templates` | none | full `BidTemplate[]` merged from both roots (templates are small; no summary/detail split) |
| `bidding_save_material` | `category`, `title`, `content`, `tags?`, `source?` | `{materialId, category, title}` |
| `bidding_search_materials` | `query?`, `category?`, `tags?`, `includeContent?` | scored material summaries (200-char preview by default; full text with `includeContent: true`) |
| `bidding_assemble_draft` | `draft` (BidDraft JSON) | validation (level continuity, material references exist, required template chapters present) + normalized `BidDraft` and a validation report |
| `bidding_render_docx` | `draft`, `config?` (header/footer/font/margins, paper DocumentConfig style) | `{fileName, format:'docx', bytes, checksum(sha256), dataBase64}` — the download anchor (consumed by phase-3 UI) |
| `bidding_compare` | `tender` (TenderDocument JSON), `draft` or `bidPath?` (finished bid docx path) | `ComparisonReport` (deterministic pre-screen; semantic conclusions are the agent's narrative) |

Error handling follows the engine error-code convention: `UNSUPPORTED_FORMAT`, `INVALID_INPUT`, `LIMIT_EXCEEDED` (carrying measured value, cap, and recovery guidance), `MATERIAL_NOT_FOUND`, `TEMPLATE_NOT_FOUND`, `FS_SANDBOX_DENIED` (sidecar-write denial degrades to a warning rather than failure).

## Template management

- **Shipped root**: `packages/bidding/bidding/templates/*.json`, published with the package (`files` gains the directory). The four built-in templates are generic chapter skeletons (structured after the PRC government-procurement and tendering-bidding legal framework), each chapter carrying `requirements` writing guidance and `materialCategories` suggestions;
- **User root**: `$DSH_HOME/bidding/templates/*.json`, discovered at runtime (same as preset discovery: rescan per call, no cache);
- **Merge rule**: shipped first, user second; on id collision the first wins (shipped templates cannot be silently shadowed); ids constrained to `^[a-z0-9][a-z0-9-]*$`;
- **Validation**: fail loud on load — unknown keys, wrong types, or an empty chapter tree raise; broken files surface as broken entries rather than being swallowed;
- Trading-center/agency-specific templates: users drop structured JSON into the user root; a later `bidding_import_template` (parse a chapter tree from a .docx template) is a phase-2 candidate.

## Material library

- **Storage**: `$DSH_HOME/bidding/materials/<id>.json`, one file per material, atomic writes (tmp + rename), no index file (directory scan per call; capacity cap `maxMaterials`, default 5000);
- **Ingest**: the agent calls `bidding_save_material` during authoring to persist reusable content (qualifications, track record, technical approach passages, team, service commitments); `category` is an open but normalized kebab-case string;
- **Retrieval**: deterministic scoring (exact/prefix hits on title and tags > keyword hits in content > term frequency), available across sessions and projects; "does this material fit this scoring item" is a semantic judgment the model makes over the hit list — no embedding/vector index (see alternatives);
- **Security boundary**: material IO is trusted engine-internal work rooted at `dshHomePath('bidding/materials')`; model parameters only supply id/category/title/tags (whitelist-validated characters) — no arbitrary-path write surface exists.

## Word generation engine

`docx-write.ts` follows the dependency-free pattern already proven by [paper document generation](../../implemented/feature/2026-08-25-dsh-paper-doc-generation.md) (handwritten OOXML + store-only ZIP), extended with bid-critical elements:

- **Cover page**: project name / tender no. / bidder / date, large centered type, its own section;
- **Table of contents**: an OOXML `TOC` field (Word prompts to update fields on open and computes real page numbers — the standard zero-dependency approach);
- **Multi-level headings**: Heading 1–4 styles (Hei/Song typeface ladder, spacing) mapped from `DraftSection.level`;
- **Tables**: `w:tbl` (Markdown table syntax → OOXML table with bold header row and equal column widths);
- **Headers/footers**: paper's header/footer parts plus the `PAGE` number field;
- **CJK fonts**: default Song body / Hei headings, with `w:eastAsia` font attributes declared correctly.

Generated files must open in both Microsoft Word and LibreOffice (an acceptance item).

## Comparison and scoring-point checking

Two deliberate layers:

1. **Engine layer (deterministic, `compare.ts`)**: scoring-item clauses are tokenized (CJK bigrams + a domain term list) and matched against draft chapter content; hit counts, hit sections, and content length yield a `covered/partial/missing` pre-verdict (thresholds configurable via Limits); fatal clauses are checked one by one for a responsive passage; the engine aggregates the coverage matrix, missing list, and format hints;
2. **Model layer (semantic)**: the agent reviews each pre-verdict (covered-but-irrelevant, missing-but-covered-in-other-words) and writes the final omissions-and-risk report in the session, optionally rendered to a Word report via `bidding_render_docx`.

Scoring-item extraction (`parse-tender.ts`) is likewise dual-channel: prefer the scoring table inside the scoring-methods chapter (columns carrying clause/points/criteria), with a regex for point values (`(\d+(\.\d+)?)\s*分`); fall back to list mode outside tables; low confidence lands in `warnings` for model-side fallback. Chapter detection is dual-channel too: Heading styles plus CJK numbering patterns (`一、`/`（一）`/`1.`/`第X章`).

## Web integration

- **Phase 1 (preset mechanism, zero UI code)**: the `bidding` preset enters the roster and gains the four existing surfaces — new-session hero chip, General-settings default row, session-header read-only label, and the settings management section (copy/view composition);
- **Phase 2 (document upload)**: `PromptContentPart` gains `{type:'document', mediaType, data(base64), name}`; attachment admission accepts document types (new limits: 32 MiB per file, 4 documents per message, independent of image limits); the SessionController materializes documents into the session workspace `uploads/` subdirectory (host-side node:fs, normalized and de-duplicated filenames), the prompt tells the model where they landed, and `bidding_parse_tender` reads them by path; the composer UI accepts .docx drops and renders a document chip;
- **Phase 3 (download)**: the generic tool-result renderer recognizes export-shaped outputs (convention: a result carrying `dataBase64`+`fileName`+`checksum`+`bytes`) and renders a download button (Blob URL + `<a download>`, with a sha256 verification hint). The convention also benefits `paper_export` — a generic capability, not bidding-specific UI.

Phase-1 file exchange relies on the session workspace directory (users place tender files server-side); phases 2–3 complete the pure-browser workflow. When the sandbox defaults to read-only, the sidecar write is denied — `bidding_parse_tender` degrades gracefully (structured result + warning); workspace-write arrives through the existing sandbox/mode escalation, and the preset never loosens policy itself.

## Security and resource limits

- **docx parse hardening**: zip bombs (≤ 512 entries, ≤ 64 MiB per entry inflated, ≤ 128 MiB total, compression ratio > 100 rejected), path traversal (`../`/absolute entries rejected), XXE (the XML state machine parses no DTD or external entities);
- **Limits** (overridable via tool Config): `maxInputBytes` 32 MiB, `maxSections` 2000, `maxScoringItems` 500, `maxMaterials` 5000, `maxMaterialBytes` 256 KiB, `maxOutputBytes` 16 MiB (as paper);
- **Untrusted content**: tender body text is untrusted input — it flows only as document data (parse/render/compare); the persona explicitly does not follow instructions embedded in document content;
- **Trusted IO boundary**: template/material library reads and writes stay inside engine-fixed roots with whitelist-validated parameters; workspace reads go through the `ctx.fs` sandbox.

## Testing plan

| Layer | Coverage |
|---|---|
| engine-format | zip read/write round trip, malicious samples (bomb/traversal/malformed headers), XML state-machine edges, docx-read block-stream assertions on fixtures |
| engine-processors | every processor's happy/edge/error branches; dual-channel chapter-numbering case set; scoring table and list modes; **round-trip fidelity** (render → parse → identical chapter structure); comparison threshold matrix |
| engine-library | template dual-root merge and fail-loud behavior; material CRUD atomicity and search ordering |
| tools | parameter-validation branches, Limits branches, error codes, sidecar degradation branch |
| preset | discovery roster includes bidding, health check passes, mount succeeds (aligned with existing preset tests) |
| web (phases 2–3) | upload e2e (drop → materialize → agent-readable), download-button e2e |

New-module unit coverage follows the repo convention (100%). Tender .docx fixtures are produced by the engine's own render pipeline (self-contained; no binary sample files checked in).

## Delivery phases

1. **Phase 1 (core)**: engine + tools + preset + full unit tests — the bid agent is fully usable with workspace-directory file exchange;
2. **Phase 2**: web document upload (host: prompt parts + materialization; client: composer);
3. **Phase 3**: web download button (client: generic export rendering);
4. **Phase-2 candidates** (separate proposals): PDF tender input, `bidding_import_template` (docx template import), comparison report rendered to Word, semantic material retrieval.

## Alternatives considered

**Third-party docx parsing (mammoth/jszip).** Rejected. Engine packages stay dependency-free (the paper engine's handwritten OOXML is the precedent, and a dependency swap has already been rejected by an NIH audit); node:zlib covers deflate, and a hand-written parser is controllable and supply-chain-free. Compatibility risk is mitigated by round-trip tests plus plain-text degradation.

**A host-plane engine service row (named pipelines).** Rejected. A preset is an AGENT-PLANE composition and may not publish to the ROOT realm; bidding processors work on inline arguments, so no engine service row is needed (same reasoning as the exploration preset shipping without one).

**A `bidding_run` pipeline tool (mirroring exploration_run/paper_run).** Rejected. Exploration/paper are deterministic data pipelines replayable as fixed step sequences; bid authoring is a model-led interactive process (chapter-by-chapter drafting, multi-turn confirmation). Traceability comes from each tool's structured results, `warnings`, and provenance references.

**Tools writing the rendered document directly to the workspace.** Rejected. The fs interface offers `writeText` only (no binary writes); tools return JSON and the session log is the source of truth (consistent with paper_export), so downloads replay from the base64 record.

**Material library inside the session workspace.** Rejected. Cross-project/cross-session reuse is the core requirement, and workspaces rotate per project; DSH_HOME is the established home for deployment-persistent data (credentials/settings/attachments).

**Semantic material retrieval (embeddings + vector index).** Rejected for phase 1. It needs an embedding service and persistent indexing for unclear gain (bid material libraries are small); deterministic tag/keyword pre-screening plus model-side semantic review covers the need. A phase-2 candidate.

## Acceptance criteria

1. The `bidding` preset appears in the web roster (order 7), mounts in new sessions, and exposes the seven `bidding_*` tools to the model;
2. Fixture tender parsing yields a complete chapter tree, scoring items (both table and list modes), fatal clauses, and the key-facts table; `warnings` is non-empty when rule confidence is low;
3. The four built-in templates list; a custom template dropped into the user root is visible without restart;
4. The material save → search → draft-reference → render loop works, and materials survive a service restart;
5. Generated docx opens in Word and LibreOffice with cover/TOC field/multi-level headings/tables/headers/footers/page numbers; the render → parse round-trip fidelity test passes;
6. `bidding_compare` produces a coverage matrix on fixtures, and missing items reproduce after a deliberately deleted chapter;
7. Engine and tool unit tests fully cover the new modules; preset discovery/mount tests pass;
8. Phase 2: dropping a .docx in the browser materializes it under `uploads/` and `bidding_parse_tender` parses it by path; phase 3: render tool results show a download button whose file's sha256 matches the result.

## Risks

- **Hand-written parser compatibility**: unconventional docx from WPS/older Word (nonstandard style names, floating text boxes) may degrade. Mitigation: dual-channel chapter detection + warnings + a plain-text degradation path; regression tests with real-world samples.
- **Regional variation in scoring-methods formats**: scoring-table column layouts differ across trading centers. Mitigation: parameterized extraction rules (parse options), common shapes covered in phase 1, edge formats falling back to the model with in-session human confirmation.
- **base64 result bloat in session logs**: repeated 10 MiB-class renders amplify logs. Mitigation: the `maxOutputBytes` cap and persona guidance toward a single final render; on-disk referencing of exports can be evaluated later.
- **CJK numbering misdetection**: wrong levels distort the chapter tree. Mitigation: style channel first, pattern channel second; on conflict prefer styles and record a warning.
- **Filename collisions in upload materialization**: duplicate uploads of the same document. Mitigation: host-side normalization plus suffix de-duplication (e.g. `招标文件(2).docx`).
- **Prompt injection inside tender documents**: body text may contain instructions aimed at the model. Mitigation: the persona states that document content is data only; tool results never enter the instruction channel.
