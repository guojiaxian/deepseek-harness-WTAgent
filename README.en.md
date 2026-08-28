# deepseek-harness-WTAgent

English | [中文](README.md)

**deepseek-harness-WTAgent** (WTAgent or `dsh` for short) is an agent harness that forks and continues to evolve [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It keeps the upstream **everything is a plugin** architecture, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

On top of the full upstream capability set (sessions, system prompts, tools, the agent loop, LLM capabilities, the complete capability seams for shell/subprocess/filesystem/LSP/Web, plus the SDK / Web UI / ACP / JSON-RPC surfaces), this project adds domain-specific modules, plugins, and agent presets — see [Modules and plugins added relative to upstream](#modules-and-plugins-added-relative-to-upstream).

## Developer preview

This project is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Modules and plugins added relative to upstream

This section lists every module, plugin, and agent preset this project adds relative to the upstream [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (master branch).

| Module / plugin | Kind | Purpose | Model-facing tools |
| --- | --- | --- | --- |
| [`@deepseek-ai/dsh-code`](#1-code-module-deepseek-aidsh-code) | Engine (service + pure functions) | Static analysis for Python / JavaScript / Java | — |
| [`@deepseek-ai/dsh-tool-code`](#2-tool-code-plugin-deepseek-aidsh-tool-code) | Model-facing tool plugin | Exposes the `code_analyze` / `code_check` tools | `code_analyze`, `code_check` |
| [`@deepseek-ai/dsh-exploration`](#3-exploration-module-deepseek-aidsh-exploration) | Engine (service + pure functions) | Exploration data (CSV/JSON/SEG-Y) processing | — |
| [`@deepseek-ai/dsh-tool-exploration`](#4-tool-exploration-plugin-deepseek-aidsh-tool-exploration) | Model-facing tool plugin | Exposes 7 `exploration_*` tools | `exploration_ingest`, `exploration_clean`, `exploration_convert`, `exploration_extract`, `exploration_detect`, `exploration_run`, `exploration_profile` |
| [`@deepseek-ai/dsh-consistency`](#5-consistency-module-deepseek-aidsh-consistency) | Engine (service + pure functions) | Dense-array consistency testing (station naming / SAC conversion planning / cut / plot / offset analysis report) | — |
| [`@deepseek-ai/dsh-tool-consistency`](#6-tool-consistency-plugin-deepseek-aidsh-tool-consistency) | Model-facing tool plugin | Exposes 7 `consistency_*` tools | `consistency_ingest`, `consistency_rename`, `consistency_convert`, `consistency_cut`, `consistency_plot`, `consistency_exclude`, `consistency_run` |
| [`@deepseek-ai/dsh-paper`](#7-paper-module-deepseek-aidsh-paper) | Engine (service + pure functions) | Paper manuscript parsing, revision, citation formatting, and document export | — |
| [`@deepseek-ai/dsh-tool-paper`](#8-tool-paper-plugin-deepseek-aidsh-tool-paper) | Model-facing tool plugin | Exposes 6 `paper_*` tools | `paper_ingest`, `paper_revise`, `paper_format`, `paper_cite`, `paper_run`, `paper_export` |
| `dev` / `exploration` / `consistency` / `paper` agent presets | Agent preset | Web-UI built-in professional agents (development / exploration data / consistency testing / paper writing) | Matching tool set |
| `code-agent` / `exploration-agent` / `paper-agent` examples | Example bundle | Runnable compositions plus keyless smoke tests | Matching tool set |

### 1. code module (`@deepseek-ai/dsh-code`)

- **Name**: `@deepseek-ai/dsh-code` (plugin name `code`, located at `packages/code/code/`)
- **Purpose**: static analysis of Python, JavaScript/TypeScript, and Java source — language detection, line metrics, function and class counts, cyclomatic complexity, static quality/security checks, and a deterministic 0–100 quality score.
- **Implementation**: provided both as a Cordis service (`ctx.code`) and as pure, framework-agnostic functions. The core entry `analyze(fileName, source, options?)` runs language detection, metrics, cyclomatic complexity, static checks, and quality scoring in sequence; `CodeService.analyze(...)` applies validated Config limits (`maxCodeBytes`, `maxFunctions`, `maxFindings`) and default check toggles when mounted as a plugin. Static analysis runs fully in-process; running and testing modified programs is delegated to the model's existing shell tools. `src/report.ts` provides the deterministic quality-scoring heuristic based on findings and complexity.
- **Usage example**:

  ```ts
  import { analyze } from '@deepseek-ai/dsh-code'

  const result = analyze(
    'util.ts',
    'function classify(code: number): string {\n  return code < 0 ? "neg" : code < 100 ? "small" : "large"\n}\n',
  )
  console.log(result.language, result.qualityScore, result.metrics.functions)
  ```

### 2. tool-code plugin (`@deepseek-ai/dsh-tool-code`)

- **Name**: `@deepseek-ai/dsh-tool-code` (plugin name `tool-code`, located at `packages/code/tool-code/`)
- **Purpose**: exposes the code engine to the model, registering two tools: `code_analyze` (a full analysis record with language, quality score, metrics, complexity, findings, and notes) and `code_check` (a focused findings view for quality/security scanning).
- **Implementation**: the plugin registers tools on `ctx.tools`, validates arguments and resource limits through the engine's own config schema, and returns compact JSON.
- **Usage example** (invoked by the model once enabled in an agent preset):

  ```json
  { "name": "code_analyze", "arguments": { "fileName": "sample.py", "source": "print('hello')" } }
  ```

### 3. exploration module (`@deepseek-ai/dsh-exploration`)

- **Name**: `@deepseek-ai/dsh-exploration` (plugin name `exploration`, located at `packages/exploration/exploration/`)
- **Purpose**: professional processing of raw exploration records (geological, geophysical, and well-log data) — parsing CSV, JSON, and SEG-Y, running configurable, traceable pipelines for data cleaning and conversion, statistics extraction, and anomaly detection, plus rendering seismic section profiles (PNG / SVG).
- **Implementation**: provided both as a Cordis service (`ExplorationService`) and as pure functions. `runPipeline(input, pipeline, limits)` executes a named, ordered step list; processors include `ingest`, `clean`, `convert` (unit conversion, depth↔two-way time), `extract` (descriptive statistics, rolling windows, RMS amplitude), `detect` (z-score, IQR, hard thresholds, spikes, dead traces, missing values), and `profile` (section rendering). Every run records per-step `RunRecord` entries (timestamps, durations, input hashes, output summaries) and FNV-1a checksums for reproducible runs; resource `Limits` are validated Config fields.
- **Usage example**:

  ```ts
  import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-exploration'

  const result = runPipeline(
    { format: 'csv', data: 'depth_m,gamma_api\n0,45\n15,220\n' },
    validatePipeline({
      name: 'quick-qc',
      steps: [
        { id: 'ingest', type: 'ingest' },
        { id: 'detect', type: 'detect', config: { zscore: [{ column: 'gamma_api' }] } },
      ],
    }),
    { maxInputBytes: 8 * 1024 * 1024, maxRows: 50_000, maxColumns: 1024, maxAnomalyRecords: 500 },
    crypto.randomUUID(),
  )
  ```

### 4. tool-exploration plugin (`@deepseek-ai/dsh-tool-exploration`)

- **Name**: `@deepseek-ai/dsh-tool-exploration` (plugin name `tool-exploration`, located at `packages/exploration/tool-exploration/`)
- **Purpose**: exposes the exploration engine to the model, registering 7 `exploration_*` tools: `exploration_ingest` (CSV/JSON text or base64 SEG-Y parsing), `exploration_clean`, `exploration_convert`, `exploration_extract`, `exploration_detect`, `exploration_run` (validates and runs a named pipeline, returning the full `RunRecord`), and `exploration_profile` (renders an exploration dataset as a seismic section PNG / SVG).
- **Implementation**: the plugin registers tools on `ctx.tools`; arguments are validated through the engine schema, and SEG-Y data travels as base64.
- **Usage example** (invoked by the model; chained transform tools pass and return dataset JSON):

  ```json
  { "name": "exploration_run", "arguments": { "format": "csv", "data": "depth_m,gamma_api\n0,45\n15,220", "pipeline": { "name": "qc", "steps": [ { "id": "ingest", "type": "ingest" } ] } } }
  ```

### 5. consistency module (`@deepseek-ai/dsh-consistency`)

- **Name**: `@deepseek-ai/dsh-consistency` (plugin name `consistency`, located at `packages/consistency/consistency/`)
- **Purpose**: engine for dense-array device consistency testing — turns the device inventory and the `datetime.dat` excitation times into the four phases of `conformance_test/workflow.md`: unify station directory names (strip the leading `C`, else the first 4 glyphs, with collision guarding), plan the mini-SEED → SAC conversion by `C`/`E` kind, parse the Beijing-time arrivals into UTC cut windows, partition the stations into plot batches whose height adapts to the actual station count, then stitch the figures in excitation-time order into one adaptive-grid image (columns chosen from image count / aspect ratio for balanced width/height), and after plotting analyze each station's data offset and report which stations reach the configured threshold (the operator removes the abnormal device manually; this step only analyzes).
- **Implementation**: offered as a Cordis service (`ConsistencyService`) plus pure functions. `runPipeline(input, pipeline, limits)` executes a named, ordered step list with processors `ingest` (builds the workflow from an interchange JSON), `rename`, `convert` (validates converters and builds the conversion plan), `cut` (Beijing time → UTC with window/file naming), `plot` (batch grouping, Y labels, stack offsets), and `exclude` (reports which stations to exclude by threshold and records an `Exclusion`, leaving plot batches unchanged). Every run records a per-step `RunRecord` (timestamps, duration, input hash, output summary) and a checksum; a missing converter raises `INCOMPLETE_DATA`. Resource `Limits` are validated config fields.
- **Usage example**:

  ```ts
  import { validatePipeline, runPipeline } from '@deepseek-ai/dsh-consistency'

  const result = runPipeline(
    { format: 'json', data: JSON.stringify({ project: '0756_260818', stations: [{ name: 'C0756_260818' }], arrivalLines: ['2026-08-25 12:00:00'] }) },
    validatePipeline({
      name: 'consistency',
      steps: [
        { id: 'ingest', type: 'ingest', config: { converterC: 'mseed2sac', converterE: 'e-mseed2sac' } },
        { id: 'rename', type: 'rename' },
        { id: 'convert', type: 'convert' },
        { id: 'cut', type: 'cut' },
        { id: 'plot', type: 'plot' },
      ],
    }),
    { maxInputBytes: 8 * 1024 * 1024, maxStations: 10_000, maxSeedFiles: 100_000, maxArrivals: 10_000 },
    crypto.randomUUID(),
  )
  ```

### 6. tool-consistency plugin (`@deepseek-ai/dsh-tool-consistency`)

- **Name**: `@deepseek-ai/dsh-tool-consistency` (plugin name `tool-consistency`, located at `packages/consistency/tool-consistency/`)
- **Purpose**: exposes the consistency engine to the model, registering 7 `consistency_*` tools: `consistency_ingest` (builds the workflow from interchange JSON), `consistency_rename`, `consistency_convert`, `consistency_cut`, `consistency_plot`, `consistency_exclude` (analyzes offsets after plotting and reports which stations to exclude, without altering data), and `consistency_run` (validates and runs a named pipeline, returning the full `RunRecord`).
- **Implementation**: the plugin registers the tools on `ctx.tools`, validating arguments through the engine schemas; the actual file I/O (renaming directories, running converters, obspy slicing, offset measurement, matplotlib rendering) is executed by the preset's `tool-bash`/`tool-fs` in line with the engine's outputs.
- **Usage example** (invoked by the model; chained transform tools pass/return the workflow JSON):

  ```json
  { "name": "consistency_run", "arguments": { "data": "{\"project\":\"0756_260818\",\"stations\":[{\"name\":\"C0756_260818\"}],\"arrivalLines\":[\"2026-08-25 12:00:00\"]}", "pipeline": { "name": "consistency", "steps": [ { "id": "ingest", "type": "ingest" }, { "id": "rename", "type": "rename" } ] } } }
  ```

### 7. paper module (`@deepseek-ai/dsh-paper`)

- **Name**: `@deepseek-ai/dsh-paper` (plugin name `paper`, located at `packages/paper/paper/`)
- **Purpose**: a professional academic-paper writing engine — parses plain-text or Markdown manuscripts into structured papers, improves content clarity, normalizes formatting, and renders references in GB/T 7714, APA, or MLA style; `renderDocument` exports papers as `.docx` (real OOXML) or `.doc` (classic RTF).
- **Implementation**: provided both as a Cordis service (`PaperService`) and as pure functions. Processors include `ingest` (titles, abstract extraction, paragraph marking, reference parsing), `revise` (clarity rewrites, passive-voice detection, cliché marking), `format` (heading numbering, spacing/punctuation normalization, typographic quotes), `cite` (reference rendering in a target style), and export. `runPipeline` records per-step `RunRecord` entries and FNV-1a checksums; resource `Limits` (`maxInputBytes`, `maxSections`, `maxParagraphs`, `maxCitations`, `maxFindings`, `maxOutputBytes`) are validated Config fields, and document rendering is zero-dependency.
- **Usage example**:

  ```ts
  import { runPipeline, validatePipeline } from '@deepseek-ai/dsh-paper'

  const result = runPipeline(
    { format: 'markdown', data: '# A Study\n\nAbstract…\n\n## Method\n\nWe studied…\n' },
    validatePipeline({
      name: 'polish',
      steps: [
        { id: 'ingest', type: 'ingest' },
        { id: 'revise', type: 'revise' },
        { id: 'cite', type: 'cite', config: { style: 'gb7714' } },
      ],
    }),
    { maxInputBytes: 8 * 1024 * 1024, maxSections: 200, maxParagraphs: 200, maxCitations: 500, maxFindings: 200 },
    crypto.randomUUID(),
  )
  ```

### 8. tool-paper plugin (`@deepseek-ai/dsh-tool-paper`)

- **Name**: `@deepseek-ai/dsh-tool-paper` (plugin name `tool-paper`, located at `packages/paper/tool-paper/`)
- **Purpose**: exposes the paper engine to the model, registering 6 `paper_*` tools: `paper_ingest`, `paper_revise`, `paper_format`, `paper_cite`, `paper_run` (validates and runs a named pipeline, returning the full `RunRecord`), and `paper_export` (exports `.docx` / `.doc`, returning base64 bytes, a sha256 checksum, format, and byte count).
- **Implementation**: the plugin registers tools on `ctx.tools`; arguments are validated through the engine schema, and `style` is an enum (`gb7714` / `apa` / `mla`).
- **Usage example** (invoked by the model):

  ```json
  { "name": "paper_run", "arguments": { "format": "markdown", "data": "# A Study\n\nAbstract…", "pipeline": { "name": "polish", "steps": [ { "id": "ingest", "type": "ingest" }, { "id": "cite", "type": "cite", "config": { "style": "gb7714" } } ] } } }
  ```

### 9. Added agent presets

The Web UI ships four professional agents as agent presets (located at `apps/cli/config/agent-presets/`), mounting the tool sets above under their personas:

| Preset directory | Name | Purpose | Mounted tools |
| --- | --- | --- | --- |
| `agent-presets/dev/` | Development Agent | Code generation, completion, refactoring, and optimization across Python / JavaScript / Java, quality and security analysis via `code_analyze` / `code_check`, with task planning and progress tracking | `@deepseek-ai/dsh-tool-code` |
| `agent-presets/exploration/` | Exploration Data Agent | Parses CSV / JSON / SEG-Y, runs cleaning, format conversion, feature extraction, and anomaly detection, and reports traceable run records | `@deepseek-ai/dsh-tool-exploration` |
| `agent-presets/consistency/` | Consistency-test Agent | Unifies station directory names, plans the mini-SEED → SAC conversion, parses excitation times into UTC cut windows, partitions plot batches, and after plotting analyzes station data offsets and reports which abnormal stations to exclude (removal done manually), reporting a traceable run record | `@deepseek-ai/dsh-tool-consistency` |
| `agent-presets/paper/` | Academic Paper Agent | Parses manuscripts, improves content, normalizes formatting, and renders references in GB/T 7714, APA, MLA, and other mainstream citation styles | `@deepseek-ai/dsh-tool-paper` |

Usage: open the Web UI in a browser and pick the matching agent from the agent-preset selector.

### 10. Added examples

Three runnable example bundles live under `examples/`, each with a composition `cordis.yml`, sample data (`samples/`), an executable driver (`tests/fixtures/*-driver.ts`), and a keyless smoke test (`tests/keyless-smoke.e2e.ts`):

- [`examples/code-agent/`](examples/code-agent/README.md): development-agent composition. Set `DEEPSEEK_API_KEY`, then run:

  ```sh
  pnpm exec tsx examples/code-agent/tests/fixtures/code-driver.ts \
    examples/code-agent/cordis.yml \
    "analyze and then improve the python processor in samples/sample_processor.py"
  ```

- [`examples/exploration-agent/`](examples/exploration-agent/README.md): exploration-data agent composition. Run:

  ```sh
  pnpm exec tsx examples/exploration-agent/tests/fixtures/exploration-driver.ts \
    examples/exploration-agent/cordis.yml \
    "process this gamma-ray log: 0,45 5,62 10,58 15,220 20,55"
  ```

- [`examples/paper-agent/`](examples/paper-agent/README.md): academic-paper writing agent composition. Run:

  ```sh
  pnpm exec tsx examples/paper-agent/tests/fixtures/paper-driver.ts \
    examples/paper-agent/cordis.yml \
    "polish this manuscript: scratch document in samples/manuscript-example.md"
  ```

The drivers emit normalized session events as JSONL (test infrastructure, not a supported CLI output format). Keyless smoke tests run via `npx vitest run --config vitest.e2e.config.ts examples/<agent>/tests/keyless-smoke.e2e.ts`.

### 9. Supporting integration

- **Tool catalog generation**: `scripts/gen-tool-catalog.ts` includes the tools above in the generated [`docs/tool-catalog.md`](docs/tool-catalog.md) and API catalog, so the model can see the `code_*` / `exploration_*` / `consistency_*` / `paper_*` schemas.
- **Subsystem docs**: `docs/subsystems/code.md`, `docs/subsystems/exploration.md`, `docs/subsystems/consistency.md`, and `docs/subsystems/paper.md` document each module's architecture.
- **Agent Notes**: the exploration-data, dense-array consistency-test, and academic-paper agent design notes under `.agents/notes/implemented/feature/` record implementation and evolution decisions.
- **TypeScript paths and compiler faces**: `tsconfig.base.json` `paths` and `tsconfig.host.json` references include the new packages.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
