# exploration/ — exploration data processing

English | [中文](README.zh.md)

A plugin family that turns raw exploration records (geology, geophysics, or well-log data in CSV, JSON, or SEG-Y) into cleaned, converted, statistics-bearing datasets with detected anomalies, rendered seismic-section profiles (PNG/SVG), and a traceability run record.

| Package | Role | ctx key |
|---|---|---|
| [`exploration/`](exploration/README.md) | Owns the engine: data types, format parsers, pure processors (ingest/clean/convert/extract/detect/profile), and the validated named-pipeline service | `ctx.exploration` |
| [`tool-exploration/`](tool-exploration/README.md) | Registers the model-facing `exploration_*` tools that call the engine's pure processors | — |

The engine stays framework-free so the model-facing tools can call its processors directly; the service owns the validated named pipelines and the end-to-end `runPipeline`. The subsystem reference is [docs/subsystems/exploration.md](../../docs/subsystems/exploration.md).
