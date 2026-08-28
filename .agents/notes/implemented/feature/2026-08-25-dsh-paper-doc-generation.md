# Agent Note: Paper document generation (.doc / .docx)

Status: implemented

English | [中文](2026-08-25-dsh-paper-doc-generation.zh.md)

## Problem

The academic paper-writing agent could ingest, revise, standardize, and cite a manuscript but had no way to turn the finished `Paper` into a real, distributable document. The model could only re-serialize the structured paper as text, so "give me this paper as a Word file" always required a host-side step with no audited transcript, and nothing constrained the size of the generated file.

## Decision

**Add `renderDocument`, backed by a portable structured config and two dependency-free renderers.** `PaperService` and the engine re-export `DocumentConfig`, `validateDocumentConfig`, `renderDocument`, and the `docx`/`doc` renderers under `document/`. One resolved `DocumentConfig` drives both formats so layout stays consistent: running header/footer text, a page-number field (OOXML `PAGE` field; RTF `\chpgn`), a body font family and size, line spacing, paragraph spacing, and uniform margins. `validateDocumentConfig` fails loud on unknown keys, wrong types, and out-of-range numbers instead of silently emitting a malformed document.

**`.docx` is real OOXML; `.doc` is classic RTF.** The `docx` renderer writes `[Content_Types].xml`, package and part relationships, `word/document.xml`, `word/styles.xml`, `word/header1.xml`, and `word/footer1.xml` into a minimal store-only ZIP archive (`document/zip.ts` builds local headers, a central directory, and an end-of-central-directory record with table-driven CRC-32). The `doc` renderer emits RTF with `\header`/`\footer` and `\uN?` escapes for non-ASCII. Both stay dependency-free, matching the engine's precision-sensitive processors.

**One `paper_export` tool surfaces the capability.** `tool-paper` registers a sixth `paper_*` tool with a `format` enum (`doc` | `docx`) and resolved config; it returns the document as base64-ed bytes, its sha256 checksum, format, and byte count. A new `Limits.maxOutputBytes` (default 16 MiB) caps generated output; an oversized result raises `LIMIT_EXCEEDED` carrying the measured bytes, the cap, and recovery guidance ("shrink the manuscript or raise maxOutputBytes"). An unsupported format raises `UNSUPPORTED_FORMAT` before any render runs.

## Alternatives considered

**Remove the size cap and byte metadata.** Rejected because a base64 tool result is unbounded by default; the checksum and byte count also give the host a way to verify and size a download it writes from the transcript.

**Persist documents to disk in the tool.** Rejected; tools return JSON and the session log is the source of truth, so the document replays from a base64 record exactly as the model produced it.

## Consequences

A paper-writing agent now ends a run by producing a `.docx` or `.doc` file described entirely by a structured config, with page headers/footers, page numbers, body fonts, spacing, and margins applied consistently across both formats. Malformed configs fail before rendering and oversized results fail with the exact bytes and cap plus how to fix them. Unit tests cover 100% of the new `document/` module and the `paper_export` tool (both formats, header/footer/page-number emission, formatted-vs-raw reference projection, empty papers, config validation ranges, the unsupported-format branch, and the byte-cap branch). The `dsh-paper` and `dsh-tool-paper` READMEs advertise the export surface and its limits.