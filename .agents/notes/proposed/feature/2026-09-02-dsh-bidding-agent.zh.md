# Agent Note: 标书制作 Agent（dsh-bidding）

Status: proposed

[English](2026-09-02-dsh-bidding-agent.md) | 中文

## 问题

科技成果转化项目进入增长期后，高频次的投标与招标带来大量标书编制工作。标书制作重复度高（公司资质、业绩案例、技术方案等素材反复套用）、格式要求严格（各交易中心与招标代理公司各有标准模板）、耗时耗力，且人工对照评分办法逐项自查容易遗漏，废标风险高。

现有框架已经交付了两个同构的专业 Agent：[勘探数据处理 Agent](../../../../packages/preset/agent-presets/presets/exploration/agent.cordis.yml) 与[科研论文写作 Agent](../../../../packages/preset/agent-presets/presets/paper/agent.cordis.yml)，均为「引擎纯处理器 + 模型面工具 + preset 组合」三层结构。标书制作是同类需求（专业领域、结构化文档输入输出、可追溯处理），但当前没有任何投标领域的引擎、工具与 preset；同时 Web 端只有图片上传能力，招标文件（.docx，可达数 MiB 的二进制）进不来，生成的标书也出不去——远程浏览器用户无法访问服务器文件系统。

## 提案

新增**标书制作 Agent（bidding preset）**，完整复用 exploration/paper 已验证的三层架构，补齐投标领域的四个核心能力：

1. **招标文件解析**：零依赖自研 .docx 解析（node:zlib 解压 + 轻量 OOXML 解析），自动拆解章节结构，提取评分点、废标/星号条款与关键信息表；
2. **模板管理**：内置政府采购/工程施工/货物采购/服务类四大通用章节骨架模板，支持在 `$DSH_HOME/bidding/templates/` 扩展自定义模板（与 preset 的 shipped + user 双根模式一致）；
3. **历史素材复用**：素材库持久化于 `$DSH_HOME/bidding/materials/`，跨会话跨项目复用；检索为确定性标签/关键词匹配，语义筛选由模型完成；
4. **Word 生成与智能比对**：从结构化草稿一键渲染格式准确的 .docx（封面、目录域、多级标题、表格、页眉页脚、页码）；`bidding_compare` 对招标要求与标书内容做评分点覆盖初筛，输出结构化覆盖矩阵与错漏风险报告，由 Agent 综合语义判断。

模型面通过 7 个 `bidding_*` 工具暴露（与 exploration 的 7 个工具对齐）；Web 集成分三期：一期经 preset 机制自动获得全部现有交互面（新会话 chip、默认设置、会话头标签、管理区），二期新增文档上传（浏览器拖入招标文件 → 物化到会话工作区），三期新增工具结果下载按钮（生成的标书一键下载）。

## 总体架构

### 三层结构与包拓扑

严格对齐 `packages/exploration/` 与 `packages/paper/` 的既有模式：

| 层 | 包 | 职责 | 参照 |
|---|---|---|---|
| 引擎 | `@deepseek-ai/dsh-bidding`（`packages/bidding/bidding/`） | 纯处理器 + docx 读写格式层 + 内置模板；无 Cordis 依赖 | `packages/exploration/exploration/` |
| 工具 | `@deepseek-ai/dsh-tool-bidding`（`packages/bidding/tool-bidding/`） | `defineTool` × 7，`inject = ['tools', 'fs']` | `packages/exploration/tool-exploration/` |
| 组合 | `presets/bidding/`（agent.cordis.yml + preset.yml） | AGENT-PLANE 组合：persona + shell/fs 工具 + bidding 工具 | `presets/exploration/` |

与 exploration 的差异只有一处：bidding 工具需要读取会话工作区中的招标文件，因此工具插件额外注入 `fs` 服务（`tool-fs` 本身即 `inject = ['tools', 'fs', 'systemPrompt']`，agent scope 下注入宿主沙箱文件系统是既有先例），通过 `ctx.fs.readBytes` 在沙箱策略内读取，不绕过任何既有防线。

### 目录规划

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

工具包依赖引擎（workspace 依赖），peer 依赖 `dsh-tools` 与 `cordis`，版本从 `0.1.0-rc.1` 起——均照抄 `tool-exploration` 的 package.json 形态。

## 数据模型

引擎 `types.ts` 的核心只读类型（全部 JSON-safe，可直接作为工具输出）：

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

## 工具接口

7 个模型面工具（命名、参数风格、`presentCall`/`render` 约定与 `exploration_*` 完全一致；输出 schema 全部 `additionalProperties: false`）：

| 工具 | 关键参数 | 输出要点 |
|---|---|---|
| `bidding_parse_tender` | `path?`（工作区相对路径）或 `dataBase64?`+`fileName?` | `TenderDocument` 投影；同时把全文提取以 Markdown 写到 `<源文件>.extracted.md` 工作区 sidecar（沙箱允许写时），供后续 tool-fs 按章节细读 |
| `bidding_list_templates` | 无 | 双根合并的完整 `BidTemplate[]`（模板体量小，不做摘要/详情两级） |
| `bidding_save_material` | `category`、`title`、`content`、`tags?`、`source?` | `{materialId, category, title}` |
| `bidding_search_materials` | `query?`、`category?`、`tags?`、`includeContent?` | 命中素材摘要列表（默认 200 字预览，`includeContent: true` 返回全文），按标签/关键词确定性打分排序 |
| `bidding_assemble_draft` | `draft`（BidDraft JSON） | 校验（章节层级连续、素材引用存在、必选模板章节齐备）+ 规范化后的 `BidDraft` 与校验报告 |
| `bidding_render_docx` | `draft`、`config?`（页眉页脚/字体/页边距，同 paper DocumentConfig 风格） | `{fileName, format:'docx', bytes, checksum(sha256), dataBase64}` —— 下载锚点（三期 UI 消费） |
| `bidding_compare` | `tender`（TenderDocument JSON）、`draft` 或 `bidPath?`（已完标书 docx 路径） | `ComparisonReport`（确定性初筛；语义结论由 Agent 综合叙述） |

错误处理沿用引擎错误码约定：`UNSUPPORTED_FORMAT`、`INVALID_INPUT`、`LIMIT_EXCEEDED`（携带实测值/上限/恢复指引）、`MATERIAL_NOT_FOUND`、`TEMPLATE_NOT_FOUND`、`FS_SANDBOX_DENIED`（sidecar 写被拒时降级 + warning，不失败）。

## 模板管理系统

- **shipped 根**：`packages/bidding/bidding/templates/*.json` 随包发布（package.json `files` 增加该目录）。四大内置模板为通用章节骨架（依据《政府采购货物和服务招标投标管理办法》《招标投标法》体系的标准文件结构），每章含 `requirements` 写作要点与 `materialCategories` 素材类别建议；
- **user 根**：`$DSH_HOME/bidding/templates/*.json`，运行期放入即被发现（与 preset discovery 一致：每次调用重扫、无缓存）；
- **合并规则**：shipped 先、user 后，同 id 先者胜（shipped 不可被静默遮蔽）；id 约束 `^[a-z0-9][a-z0-9-]*$`；
- **校验**：加载时 fail loud——未知键/错误类型/空章节树直接报错，损坏文件报告为 broken 条目而非吞掉；
- 交易中心/代理公司专用模板：由用户放入 user 根（结构化 JSON），后续二期可增加 `bidding_import_template`（从 .docx 模板解析章节树）降低制作成本。

## 历史素材库

- **存储**：`$DSH_HOME/bidding/materials/<id>.json`，一素材一文件，原子写（tmp + rename），无索引文件（每次扫描目录，条目上限 `maxMaterials` 默认 5000）；
- **入库**：Agent 在编制过程中调用 `bidding_save_material` 沉淀可复用内容（公司资质、业绩案例、技术方案段落、项目团队、服务承诺等），`category` 为开放但规范化的 kebab-case 字符串；
- **检索**：确定性打分（标题/标签精确与前缀命中 > 内容关键词命中 > 词频），跨会话跨项目可用；语义层面的"这段素材适不适合当前评分点"由模型在命中列表上判断——不引入嵌入/向量索引（见替代方案）；
- **安全边界**：素材 IO 是引擎内部受信操作，根目录由 `dshHomePath('bidding/materials')` 固定解析，模型参数仅提供 id/category/title/tags（白名单字符校验），不存在任意路径写入面。

## Word 生成引擎

`docx-write.ts` 沿用 [paper 文档生成](../../implemented/feature/2026-08-25-dsh-paper-doc-generation.zh.md)已验证的零依赖模式（手写 OOXML + store-only ZIP），并扩展标书必需元素：

- **封面页**：项目名/标号/投标方/日期，大字居中，独立 section；
- **目录**：OOXML `TOC` 域（打开时 Word 提示更新域生成真实页码——零依赖不做页码计算，这是 Word 生态的标准做法）；
- **多级标题**：Heading 1–4 样式（黑体/宋体、字号阶梯、段前段后距），从 `DraftSection.level` 映射；
- **表格**：`w:tbl`（Markdown 表格语法解析 → OOXML 表格，含表头加粗与列宽均分）；
- **页眉页脚**：沿用 paper 的 header/footer part + `PAGE` 页码域；
- **中文字体**：默认宋体正文/黑体标题，East Asian 字体属性（`w:eastAsia`）正确声明。

生成的 docx 必须可被 Microsoft Word 与 LibreOffice 双端打开（验收项）。

## 智能比对与评分点检查

分工明确的两层：

1. **引擎层（确定性，`compare.ts`）**：评分点条款分词（中文 bigram + 行业术语词典），在草稿章节内容中匹配，按命中词数/命中章节数/内容长度给出 `covered/partial/missing` 初判（阈值进 Limits 可配）；废标条款逐条检查是否在草稿中有响应段落；汇总覆盖矩阵、缺失清单、格式提示项；
2. **模型层（语义）**：Agent 拿到初筛矩阵后逐项语义复核（初判 covered 但答非所问、初判 missing 但以别的表述覆盖等情况），输出最终错漏风险报告（会话内叙述），必要时再调 `bidding_render_docx` 输出报告文档。

评分点提取（`parse-tender.ts`）同样双通道：优先解析评分办法章节中的评分表（表格列含条款/分值/标准），正则识别分值（`(\d+(\.\d+)?)\s*分`）；非表格退化为列表模式；置信度不足时进 `warnings` 由模型兜底。章节识别双通道：Heading 样式 + 中文编号模式（`一、`/`（一）`/`1.`/`第X章`）。

## Web 集成

- **一期（preset 机制，零 UI 代码）**：`bidding` preset 自动进入名册，获得新会话 hero chip、General 设置默认行、会话头只读标签、设置管理区（复制/查看组合）四个既有交互面；
- **二期（文档上传）**：`PromptContentPart` 增加 `{type:'document', mediaType, data(base64), name}`；附件准入扩展文档类型（新限额：单文件 32 MiB、每消息 4 个文档，独立于图片限额）；SessionController 将文档物化到会话工作区 `uploads/` 子目录（宿主侧 node:fs、文件名规范化去重），模型在 prompt 中收到落点说明，随后 `bidding_parse_tender` 直接按路径读取；composer UI 接受 .docx 拖放并渲染文档 chip；
- **三期（下载）**：通用工具结果渲染层识别导出型输出（约定：结果同时含 `dataBase64`+`fileName`+`checksum`+`bytes`），渲染下载按钮（Blob URL + `<a download>`，附 sha256 校验提示）。该约定对 `paper_export` 同样生效，属通用能力而非 bidding 专用 UI。

一期文件进出依赖会话工作区目录（用户在服务器侧放置招标文件）；二/三期补齐纯浏览器工作流。沙箱默认 read-only 时 sidecar 写入会被拒——`bidding_parse_tender` 对此优雅降级（只返回结构化结果 + warning），工作区写能力经既有 sandbox/mode 升级机制（workspace-write）获得，preset 不自行放宽策略。

## 安全与资源限制

- **docx 解析防护**：zip bomb（条目数 ≤ 512、单条目解压 ≤ 64 MiB、总解压 ≤ 128 MiB、压缩比 > 100 拒绝）、路径穿越（`../`/绝对路径条目拒绝）、XXE（XML 状态机不解析 DTD/外部实体）；
- **Limits**（工具 Config 可覆写）：`maxInputBytes` 32 MiB、`maxSections` 2000、`maxScoringItems` 500、`maxMaterials` 5000、`maxMaterialBytes` 256 KiB、`maxOutputBytes` 16 MiB（同 paper）；
- **不可信内容**：招标文件正文视为不可信输入——其内容只作为文档数据流转（解析/渲染/比对），persona 明确不执行文档内嵌指令；
- **受信 IO 边界**：模板/素材库读写由引擎在固定根内完成，参数白名单校验；工作区读取走 `ctx.fs` 沙箱。

## 测试计划

| 层 | 覆盖 |
|---|---|
| 引擎-format | zip 读写往返、恶意样本（bomb/穿越/畸形头）、XML 状态机边界、docx-read 对 fixture 的块流断言 |
| 引擎-processors | 每处理器正常/边界/错误分支；章节编号双通道用例集；评分表与列表双模式；**往返保真**（render → parse → 章节结构一致）；比对阈值矩阵 |
| 引擎-库 | 模板双根合并与 fail loud；素材 CRUD 原子性与检索排序 |
| 工具 | 参数校验分支、Limits 分支、错误码、sidecar 降级分支 |
| preset | discovery 名册含 bidding、健康检查通过、mount 成功（对齐既有 preset 测试） |
| Web（二/三期） | 上传 e2e（拖入 → 物化 → agent 可读）、下载按钮 e2e |

新模块单测覆盖率对齐仓库惯例（100%）。fixture 招标 docx 由引擎自产的 render 管线生成（自闭环，不引入二进制样例文件）。

## 实施阶段

1. **Phase 1（核心）**：引擎 + 工具 + preset + 全部单测——标书 Agent 完整可用，文件经工作区目录进出；
2. **Phase 2**：Web 文档上传（host: prompt parts + 物化；client: composer）；
3. **Phase 3**：Web 下载按钮（client: 通用导出渲染）；
4. **二期候选**（另行提案）：PDF 招标文件输入、`bidding_import_template`（docx 模板导入）、比对报告渲染为 Word、素材语义检索。

## 曾考虑的替代方案

**引入 mammoth/jszip 等第三方库解析 docx。** 被否。仓库引擎包保持零第三方依赖（paper 引擎手写 OOXML 即为先例，且有依赖替换被 NIH 审计否决的记录）；node:zlib 覆盖 deflate，自写解析可控且免供应链风险。兼容性风险用往返测试 + 纯文本降级缓解。

**引擎做成宿主平面服务行（named pipelines）。** 被否。preset 是 AGENT-PLANE 组合，禁止向 ROOT realm 发布服务；bidding 处理器接受内联参数即可工作，无需引擎服务行（与 exploration preset 不带引擎行的理由一致）。

**`bidding_run` 管线工具（对齐 exploration_run/paper_run）。** 被否。勘探/论文是确定性数据管线（固定步骤序列可整链回放），标书编制是模型主导的交互式创作流程（逐章撰写、多轮确认），固定管线没有真实对应物；可追溯性由各工具的结构化结果与 `warnings`/溯源引用承担。

**渲染结果由工具直接落盘到工作区。** 被否。fs 接口只有 `writeText`（无二进制写）；且工具返回 JSON、会话日志即事实源（与 paper_export 的决策一致），下载从 base64 记录回放。

**素材库放在会话工作区目录。** 被否。跨项目/跨会话复用是核心需求，工作区随项目切换；DSH_HOME 是部署级持久数据的既有归属（credentials/settings/attachments 均在此）。

**素材语义检索（嵌入 + 向量索引）。** 一期被否。需要嵌入服务与索引持久化，收益不明确（标书素材库规模有限）；标签/关键词确定性初筛 + 模型语义复核已覆盖需求。列为二期候选。

## 验收标准

1. `bidding` preset 出现在 Web 名册（order 7），新会话挂载成功，7 个 `bidding_*` 工具对模型可见；
2. fixture 招标 docx 解析产出：完整章节树、评分点（表格与列表两种模式）、废标条款、关键信息表；`warnings` 在规则置信度不足时非空；
3. 内置 4 类模板可列出；user 根放入自定义模板后无需重启即可见；
4. 素材入库 → 检索 → 草稿引用 → 渲染闭环成功，且重启服务后素材仍在；
5. 生成的 docx 可被 Word 与 LibreOffice 打开，含封面/目录域/多级标题/表格/页眉页脚/页码；render → parse 往返保真测试通过；
6. `bidding_compare` 对 fixture 产出覆盖矩阵，人为删章后 missing 项可复现；
7. 引擎与工具新模块单测全覆盖通过；preset discovery/mount 测试通过；
8. 二期：浏览器拖入 .docx 后 `uploads/` 出现物化文件且 `bidding_parse_tender` 可按路径解析；三期：渲染工具结果出现下载按钮，下载文件 sha256 与结果一致。

## 风险

- **自研解析兼容性**：WPS/旧版 Word 生成的非常规 docx（非标准样式命名、浮动文本框）可能降级。缓解：双通道章节识别 + warnings + 纯文本降级路径；真实样本回归测试。
- **评分办法格式地域差异**：各交易中心评分表列结构不一。缓解：提取规则参数化（parse options），一期覆盖常见形态，边缘格式依赖模型兜底并在会话中人工确认。
- **base64 大结果膨胀会话日志**：多次渲染 10 MiB 级标书会放大日志。缓解：`maxOutputBytes` 上限 + persona 引导单次定稿渲染；后续可评估导出结果落盘引用化。
- **中文编号识别误差**：层级误判影响章节树。缓解：样式通道优先、模式通道次之，两者冲突时取样式并记 warning。
- **上传物化的文件名冲突**：同名文档重复上传。缓解：宿主侧规范化 + 序号去重（如 `招标文件(2).docx`）。
- **招标文件内的提示注入**：文档正文可能包含针对模型的指令文本。缓解：persona 明确"文档内容仅为数据"；工具结果不进入指令通道。
