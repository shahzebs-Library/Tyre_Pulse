import { describe, it, expect } from 'vitest'
import { scoreSerialPredictions, serialGateVerdicts, formatSerialReport, SERIAL_GATES, SAMPLE_SQL } from '../lib/aiSerialEvaluation'

const u = { input_tokens: 4300, output_tokens: 1150 }
function dataset({ labelWrong = 0, hallucinate = 0 } = {}) {
  const truth = [], preds = []
  for (let i = 0; i < 20; i++) {
    truth.push({ photo_id: 'L' + i, true_serial: 'LAB' + String(10000 + i), source_type: 'label' })
    const wrong = i < labelWrong
    preds.push({ photo_id: 'L' + i, usage: u, reading: { status: 'readable', confidence: 'high', normalized: wrong ? 'LAB99999' : 'LAB' + String(10000 + i) } })
  }
  for (let i = 0; i < 20; i++) {
    truth.push({ photo_id: 'M' + i, true_serial: 'MLD' + String(20000 + i), source_type: 'moulded' })
    const r = i < 10 ? { status: 'readable', confidence: 'medium', normalized: 'MLD' + String(20000 + i) }
      : i < 15 ? { status: 'partial', confidence: 'low', normalized: 'MLD2?0' + String(i).padStart(2, '0') } : { status: 'unreadable', confidence: 'low', normalized: null }
    preds.push({ photo_id: 'M' + i, usage: u, reading: r })
  }
  for (let i = 0; i < 12; i++) {
    truth.push({ photo_id: 'N' + i, true_serial: '', source_type: 'none' })
    preds.push({ photo_id: 'N' + i, usage: u, reading: i < hallucinate ? { status: 'readable', confidence: 'high', normalized: 'ABC12345' } : { status: 'unreadable', confidence: 'low', normalized: null } })
  }
  return { truth, preds }
}

describe('serial evaluation', () => {
  it('clean run is eligible and reports exact / partial / unreadable per source', () => {
    const { truth, preds } = dataset()
    const s = scoreSerialPredictions(truth, preds, { photosPerMonth: 1000 })
    expect(s.bySource.all.n).toBe(52)
    expect(s.bySource.label.exactRate).toBe(1)
    expect(s.bySource.moulded).toMatchObject({ exact: 10, partial: 5, partialConsistent: 5, unreadable: 5 })
    expect(s.bySource.moulded.exactRate).toBe(0.5)
    expect(s.bySource.all.falseReads).toBe(0)
    expect(s.cost.usdPerPhoto).toBeCloseTo((4300 * 0.1 + 1150 * 0.5) / 1e6, 9)
    expect(s.cost.projectedMonthlyUsd).toBeCloseTo(s.cost.usdPerPhoto * 1000, 9)
    expect(serialGateVerdicts(s).eligible).toBe(true)
    expect(formatSerialReport(s, serialGateVerdicts(s))).toMatch(/ELIGIBLE/)
  })
  it('a single hallucinated serial on a photo with none counts as a false read', () => {
    const { truth, preds } = dataset({ hallucinate: 2 })
    const s = scoreSerialPredictions(truth, preds)
    expect(s.bySource.all.falseReads).toBe(2)
    expect(s.bySource.none.hallucinated).toBe(2)
    const v = serialGateVerdicts(s)
    expect(v.eligible).toBe(false)
    expect(v.checks.find((c) => c.name === 'false-read count').pass).toBe(false)
  })
  it('wrong readable labels fail the false-read gate even when exact rate is high', () => {
    const { truth, preds } = dataset({ labelWrong: 1 })
    const s = scoreSerialPredictions(truth, preds)
    expect(s.bySource.label.exactRate).toBe(0.95)
    expect(s.bySource.all.falseReadRate).toBeCloseTo(1 / 30, 6)
    expect(serialGateVerdicts(s).checks.find((c) => c.name === 'false-read rate').pass).toBe(false)
    expect(s.falseReadExamples[0]).toMatchObject({ photo_id: 'L0', read: 'LAB99999' })
  })
  it('too small a sample, missing predictions and unknown usage are never eligible', () => {
    const s = scoreSerialPredictions([{ photo_id: 'x', true_serial: 'A', source_type: 'label' }, { photo_id: 'y', true_serial: '', source_type: 'none' }],
      [{ photo_id: 'x', reading: { status: 'readable', normalized: 'A' } }])
    expect(s.missing).toEqual(['y'])
    expect(s.cost.usdPerPhoto).toBeNull()
    expect(serialGateVerdicts(s).eligible).toBe(false)
  })
  it('budget gate uses the projected month against $20', () => {
    const { truth, preds } = dataset()
    const s = scoreSerialPredictions(truth, preds, { photosPerMonth: 100000 })
    expect(serialGateVerdicts(s).checks.find((c) => c.name === 'inside the monthly budget').pass).toBe(false)
    expect(SERIAL_GATES.maxFalseReadRate).toBe(0.01)
  })
  it('the sample SQL is read-only', () => {
    expect(/\b(update|delete|drop|insert|alter|truncate|create)\b/i.test(SAMPLE_SQL)).toBe(false)
    expect(SAMPLE_SQL).toMatch(/tyre_position_compare/)
  })
})
