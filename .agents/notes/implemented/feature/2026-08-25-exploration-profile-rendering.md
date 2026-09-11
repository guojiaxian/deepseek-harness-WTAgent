# Agent Note: Exploration profile rendering

Status: implemented

English | [中文](2026-08-25-exploration-profile-rendering.zh.md)

## Problem

A professional seismic-exploration agent could ingest, clean, convert, extract, and detect over SEG-Y data, but had no way to turn a parsed and validated seismic section into a viewable profile image. Rendering a section required post-processing outside the engine, so the agent could not answer "show me this line" without an extra, un-audited step, and nothing paused the pipeline when the section was incomplete.

## Decision

**Add a `profile` step processor and one `exploration_profile` tool.** The processor renders a 2-D seismic section (SEG-Y long format `trace`/`sampleIndex`/`value` or short format `trace` + `sample_*` columns) to a color-mapped raster (seismic/grayscale/jet) and embeds the result as a self-contained SVG plus a base64 PNG under `meta.profile`. Model-facing `exploration_run` runs it as a pipeline step, so a collection that independently calls `exploration_profile` after parsing and validation covers the one-off case.

**Triggering rides the pipeline's break-on-failure.** Profile rendering belongs in the same audited pipeline as parsing and validation, declared declaratively as a `profile` step after `ingest`. A dataset without seismic columns, rows, or finite amplitudes raises a new `INCOMPLETE_DATA` error code; `runPipeline` already captures a failing step's code, message, and step id on the run record and pauses the rest of the run, so incomplete sections stop automatically with a recorded reason.

**Output is dependency-free and standards-based.** PNG output is produced by a minimal built-in indexed-color encoder (zlib deflate plus table-driven CRC-32) and SVG wraps the raster as an embedded PNG data URI, so files open in any PNG/SVG-capable viewer and import into professional geology software that accepts either format. No image library is required.

**Format scope stays PNG + SVG.** SEG-Y/GeoJSON/LAS export is out of scope; the output is a render, not a data exchange file.

## Alternatives considered

**Depend on a rendering library.** Rejected because the engine's processors are dependency-free for precision-sensitive work; a table-driven PNG encoder keeps that property and the surface is small.

**Persist profiles to disk in the tool.** Rejected because the tools return JSON and the session log is the source of truth; the render rides the dataset meta so it replays from the record.

## Consequences

A seismic exploration agent can parse and validate SEG-Y and then render the section to PNG and/or SVG in the same pipeline, with no manual step; incomplete or non-seismic datasets pause the run with an `INCOMPLETE_DATA` record instead of producing a misleading image. Unit tests cover 100% of the new render module and processor, and the tool-level suites exercise both the standalone `exploration_profile` path and the pipeline `profile` step including its failure pause. The `seismic-profile` example pipeline and the exploration agent preset persona advertise the render capability.
