import { describe, expect, it } from 'vitest'
import { runPipeline, validatePipeline } from '../src/pipeline.ts'
import { computeTargetName } from '../src/processors/rename.ts'
import { buildArrival, formatUtcLabel } from '../src/processors/cut.ts'
import { classifySeed } from '../src/processors/ingest.ts'
import * as excludeProcessor from '../src/processors/exclude.ts'
import type { Limits, Pipeline, PlotBatch, ProcessingInput, StationOffset, Workflow } from '../src/types.ts'

const LIMITS: Limits = { maxInputBytes: 1_000_000, maxStations: 1000, maxSeedFiles: 10_000, maxArrivals: 1000 }

const PAYLOAD = JSON.stringify({
  project: '0756_260818',
  stations: [
    { name: 'C0756_260818', seeds: ['C0756_260818_00.mseed', 'E0756_260818_01.mseed'] },
    { name: '0123_abc', seeds: ['C0123_abc.mseed'] },
  ],
  arrivalLines: ['2026-08-25 12:00:00'],
})

const INPUT: ProcessingInput = { format: 'json', data: PAYLOAD }

const PIPELINE: Pipeline = {
  name: 'consistency-demo',
  steps: [
    { id: 'i', type: 'ingest', config: { converterC: 'mseed2sac', converterE: 'e-mseed2sac', baseDir: '/data' }, description: 'load' },
    { id: 'r', type: 'rename', config: {} },
    { id: 'c', type: 'convert', config: {} },
    { id: 'cut', type: 'cut', config: {} },
    { id: 'p', type: 'plot', config: {} },
    { id: 'e', type: 'exclude', config: { threshold: 10, metric: 'samples' } },
  ],
}

describe('validatePipeline', () => {
  it('validates a full consistency pipeline', () => {
    const pipeline = validatePipeline(PIPELINE)
    expect(pipeline.name).toBe('consistency-demo')
    expect(pipeline.steps).toHaveLength(6)
  })

  it('rejects a non-ingest first step', () => {
    expect(() => validatePipeline({ name: 'x', steps: [{ id: 'r', type: 'rename', config: {} }] }))
      .toThrow(/must start with an ingest step/)
  })
})

describe('domain helpers', () => {
  it('classifies seeds by prefix', () => {
    expect(classifySeed('C0756.mseed')).toBe('C')
    expect(classifySeed('E0756.mseed')).toBe('E')
    expect(classifySeed('cat.mseed')).toBe('other')
  })

  it('computes rename targets per the cds_files_rename rule', () => {
    expect(computeTargetName('C0756_260818')).toBe('0756_260818')
    expect(computeTargetName('0123_abc')).toBe('0123')
  })

  it('formats the UTC label as YYYY-MM-DDTHHMMSS', () => {
    expect(formatUtcLabel(Date.UTC(2026, 7, 25, 4, 0, 0))).toBe('2026-08-25T040000')
  })

  it('builds an arrival shifted from Beijing to UTC', () => {
    const arrival = buildArrival('2026-08-25 12:00:00', 0, 8, 1, 2)
    expect(arrival.label).toBe('2026-08-25T040000')
    expect(arrival.cutBefore).toBe(1)
    expect(arrival.cutAfter).toBe(2)
  })
})

describe('runPipeline', () => {
  it('runs the full consistency pipeline end to end', () => {
    const record = runPipeline(INPUT, validatePipeline(PIPELINE), LIMITS, 'run-1')
    expect(record.status).toBe('completed')
    expect(record.output.project).toBe('0756_260818')
    expect(record.output.stations).toHaveLength(2)
    expect(record.output.stations[0]?.targetName).toBe('0756_260818')
    expect(record.output.stations[1]?.targetName).toBe('0123')
    expect(record.output.arrivals).toHaveLength(1)
    expect(record.output.plotBatches).toHaveLength(1)
    expect(record.output.plotBatches[0]?.stations[0]).toBe('0123')
  })

  it('records failing steps without aborting the run record', () => {
    const bad: Pipeline = {
      name: 'bad',
      steps: [
        { id: 'i', type: 'ingest', config: { baseDir: '/data' } },
        { id: 'c', type: 'convert', config: {} },
      ],
    }
    const record = runPipeline(INPUT, validatePipeline(bad), LIMITS, 'run-2')
    expect(record.status).toBe('failed')
    expect(record.error?.code).toBe('INCOMPLETE_DATA')
    expect(record.steps[1]?.status).toBe('failed')
  })
})

/** Build a minimal plotting workflow around two plot batches. */
function excludeFixture(): Workflow {
  const batchA: PlotBatch = {
    arrivalLabel: '2026-08-25T040000', batchIndex: 0,
    stations: ['0100', '0200', '0300'],
    yLabels: ['WT.0100', 'WT.0200', 'WT.0300'],
    offsets: [3, 1.5, 0], yMax: 4.5, ySpacing: 1.5,
  }
  const batchB: PlotBatch = {
    arrivalLabel: '2026-08-25T041000', batchIndex: 1,
    stations: ['0200', '0300'],
    yLabels: ['WT.0200', 'WT.0300'],
    offsets: [1.5, 0], yMax: 3, ySpacing: 1.5,
  }
  return {
    project: '0756_260818', baseDir: '.', inputRoot: '', outputSacRoot: '', outputCutRoot: '', outputFigRoot: '',
    converterC: null, converterE: null, channel: 'Z', cutBefore: 1, cutAfter: 2,
    timezoneOffsetHours: 8, batchSize: 40, stations: [], arrivals: [], plotBatches: [batchA, batchB],
    exclusions: [], meta: {},
  }
}

describe('exclude processor', () => {
  it('rejects a missing threshold', () => {
    expect(() => excludeProcessor.validate({ metric: 'samples' }))
      .toThrow(/threshold/)
  })

  it('reports stations whose offset reaches the threshold while leaving plot batches unchanged', () => {
    const offsets: StationOffset[] = [
      { station: '0200', value: 12, source: 'obspy dc shift' },
      { station: '0100', value: 1.5 },
    ]
    const before = excludeFixture()
    const result = excludeProcessor.run(before, { threshold: 10, metric: 'samples' }, offsets)
    expect(result.workflow.exclusions.map(e => e.station)).toEqual(['0200'])
    // analysis-only: the report lists which station to exclude, but plot batches are untouched.
    expect(result.workflow.plotBatches).toEqual(before.plotBatches)
  })

  it('keeps stations under the threshold and records no exclusion', () => {
    const offsets: StationOffset[] = [{ station: '0100', value: 3 }]
    const result = excludeProcessor.run(excludeFixture(), { threshold: 10 }, offsets)
    expect(result.workflow.exclusions).toHaveLength(0)
    expect(result.workflow.plotBatches).toHaveLength(2)
  })

  it('scopes exclusion to one arrival slice when configured', () => {
    const offsets: StationOffset[] = [
      { station: '0200', value: 12 },
      { station: '0300', value: 20 },
    ]
    const before = excludeFixture()
    const result = excludeProcessor.run(
      excludeFixture(),
      { threshold: 10, metric: 'samples', arrivalLabel: '2026-08-25T040000' },
      offsets,
    )
    const scoped = new Set(result.workflow.exclusions.map(e => e.station))
    expect(scoped).toEqual(new Set(['0200', '0300']))
    // plot batches are untouched whether or not the slice is scoped.
    expect(result.workflow.plotBatches).toEqual(before.plotBatches)
  })

  it('loads offsets from workflow meta when no explicit offsets are given', () => {
    const workflow = { ...excludeFixture(), meta: { offsets: [{ station: '0300', value: 15 }] } }
    const result = excludeProcessor.run(workflow, { threshold: 10 })
    expect(result.workflow.exclusions.map(e => e.station)).toEqual(['0300'])
  })
})
