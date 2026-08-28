# consistency/ — dense-array consistency testing

English | [中文](README.zh.md)

A plugin family that automates the dense-array device consistency test
(`conformance_test/workflow.md`): it turns a dense-array device inventory
(station directories holding mini-SEED seeds) and the excitation times in
`datetime.dat` (北京时间) into an executable workflow covering unified station
naming, a mini-SEED → SAC conversion plan, UTC arrival-cut windows, and
batch waveform-plot layouts, with a traceability run record.

| Package | Role | ctx key |
|---|---|---|
| [`consistency/`](consistency/README.md) | Owns the engine: domain types, step processors (ingest/rename/convert/cut/plot), and the validated named-pipeline service | `ctx.consistency` |
| [`tool-consistency/`](tool-consistency/README.md) | Registers the model-facing `consistency_*` tools that call the engine's pure processors | — |

The engine stays framework-free so the model-facing tools can call its processors
directly; the service owns the validated named pipelines and the end-to-end
`runPipeline`. The subsystem reference is
[docs/subsystems/consistency.md](../../docs/subsystems/consistency.md).