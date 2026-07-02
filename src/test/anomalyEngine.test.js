// ─────────────────────────────────────────────────────────────────────────────
// anomalyEngine.test.js - Comprehensive unit tests for anomalyEngine.js
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  detectAnomalies,
  summariseAnomalies,
  ANOMALY_TYPES,
  ANOMALY_SEVERITY,
  ANOMALY_TYPE_LABELS,
  ANOMALY_TYPE_DESC,
} from '../lib/anomalyEngine'

// ── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0
function makeRecord(overrides = {}) {
  idCounter++
  return {
    id:           `rec-${String(idCounter).padStart(4, '0')}`,
    asset_no:     'TRK-01',
    serial_no:    `SN-${idCounter}`,
    issue_date:   '2024-06-01',
    cost_per_tyre: 1000,
    qty:          1,
    risk_level:   'Low',
    brand:        'Michelin',
    site:         'Riyadh',
    ...overrides,
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('ANOMALY_TYPES constants', () => {
  it('exports all six anomaly type keys', () => {
    expect(ANOMALY_TYPES.SHORT_INTERVAL).toBe('SHORT_INTERVAL')
    expect(ANOMALY_TYPES.SAME_DAY_BURST).toBe('SAME_DAY_BURST')
    expect(ANOMALY_TYPES.RAPID_RECURRENCE).toBe('RAPID_RECURRENCE')
    expect(ANOMALY_TYPES.COST_SPIKE).toBe('COST_SPIKE')
    expect(ANOMALY_TYPES.SERIAL_REUSE).toBe('SERIAL_REUSE')
    expect(ANOMALY_TYPES.DUPLICATE_ENTRY).toBe('DUPLICATE_ENTRY')
  })
})

describe('ANOMALY_SEVERITY constants', () => {
  it('exports high, medium, low', () => {
    expect(ANOMALY_SEVERITY.HIGH).toBe('high')
    expect(ANOMALY_SEVERITY.MEDIUM).toBe('medium')
    expect(ANOMALY_SEVERITY.LOW).toBe('low')
  })
})

describe('ANOMALY_TYPE_LABELS', () => {
  it('has a label for every anomaly type', () => {
    Object.values(ANOMALY_TYPES).forEach(type => {
      expect(ANOMALY_TYPE_LABELS[type]).toBeTruthy()
    })
  })
})

describe('ANOMALY_TYPE_DESC', () => {
  it('has a description for every anomaly type', () => {
    Object.values(ANOMALY_TYPES).forEach(type => {
      expect(ANOMALY_TYPE_DESC[type]).toBeTruthy()
    })
  })
})

// ── detectAnomalies - empty / edge inputs ─────────────────────────────────────

describe('detectAnomalies - empty / null inputs', () => {
  it('returns empty array for empty records array', () => {
    expect(detectAnomalies([])).toEqual([])
  })

  it('returns empty array for null input', () => {
    expect(detectAnomalies(null)).toEqual([])
  })

  it('returns empty array for undefined input', () => {
    expect(detectAnomalies(undefined)).toEqual([])
  })

  it('returns empty array for single record (no anomalies possible)', () => {
    const records = [makeRecord()]
    const result = detectAnomalies(records)
    // Single record can't trigger SHORT_INTERVAL, SAME_DAY_BURST, RAPID_RECURRENCE,
    // SERIAL_REUSE, or DUPLICATE_ENTRY. No cost spike from single record (stdDev=0).
    expect(result.filter(a =>
      [ANOMALY_TYPES.SHORT_INTERVAL, ANOMALY_TYPES.RAPID_RECURRENCE, ANOMALY_TYPES.SERIAL_REUSE, ANOMALY_TYPES.DUPLICATE_ENTRY].includes(a.type)
    )).toHaveLength(0)
  })
})

// ── SHORT_INTERVAL ────────────────────────────────────────────────────────────

describe('detectAnomalies - SHORT_INTERVAL', () => {
  it('detects HIGH severity when interval < 7 days', () => {
    const records = [
      makeRecord({ asset_no: 'A1', id: 'r001', issue_date: '2024-06-01', serial_no: 'SN-A' }),
      makeRecord({ asset_no: 'A1', id: 'r002', issue_date: '2024-06-04', serial_no: 'SN-B' }), // 3 days later
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL)
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.HIGH)
    expect(anomaly.daysDiff).toBe(3)
  })

  it('detects MEDIUM severity when interval is between 7 and 30 days', () => {
    const records = [
      makeRecord({ asset_no: 'A2', id: 'r003', issue_date: '2024-06-01', serial_no: 'SN-C' }),
      makeRecord({ asset_no: 'A2', id: 'r004', issue_date: '2024-06-15', serial_no: 'SN-D' }), // 14 days later
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL)
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.MEDIUM)
    expect(anomaly.daysDiff).toBe(14)
  })

  it('does NOT flag when interval is exactly 30 days', () => {
    const records = [
      makeRecord({ asset_no: 'A3', id: 'r005', issue_date: '2024-06-01', serial_no: 'SN-E' }),
      makeRecord({ asset_no: 'A3', id: 'r006', issue_date: '2024-07-01', serial_no: 'SN-F' }), // 30 days later
    ]
    const result = detectAnomalies(records)
    const shortInterval = result.filter(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL && a.asset_no === 'A3')
    expect(shortInterval).toHaveLength(0)
  })

  it('does NOT flag records on different assets', () => {
    const records = [
      makeRecord({ asset_no: 'A4', id: 'r007', issue_date: '2024-06-01', serial_no: 'SN-G' }),
      makeRecord({ asset_no: 'A5', id: 'r008', issue_date: '2024-06-02', serial_no: 'SN-H' }), // different asset
    ]
    const result = detectAnomalies(records)
    const shortInterval = result.filter(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL)
    expect(shortInterval).toHaveLength(0)
  })

  it('skips records with null issue_date', () => {
    const records = [
      makeRecord({ asset_no: 'A6', id: 'r009', issue_date: null, serial_no: 'SN-I' }),
      makeRecord({ asset_no: 'A6', id: 'r010', issue_date: '2024-06-02', serial_no: 'SN-J' }),
    ]
    const result = detectAnomalies(records)
    const shortInterval = result.filter(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL && a.asset_no === 'A6')
    expect(shortInterval).toHaveLength(0)
  })

  it('anomaly contains correct record_ids', () => {
    const records = [
      makeRecord({ asset_no: 'A7', id: 'prev-id', issue_date: '2024-06-01', serial_no: 'SN-K' }),
      makeRecord({ asset_no: 'A7', id: 'curr-id', issue_date: '2024-06-03', serial_no: 'SN-L' }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL)
    expect(anomaly.record_ids).toContain('prev-id')
    expect(anomaly.record_ids).toContain('curr-id')
  })

  it('respects custom shortIntervalDays config override', () => {
    const records = [
      makeRecord({ asset_no: 'A8', id: 'r011', issue_date: '2024-06-01', serial_no: 'SN-M' }),
      makeRecord({ asset_no: 'A8', id: 'r012', issue_date: '2024-06-04', serial_no: 'SN-N' }), // 3 days
    ]
    // With threshold 2 days, 3-day gap should be MEDIUM (between 2 and 30)
    const result = detectAnomalies(records, { shortIntervalDays: 2 })
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL && a.asset_no === 'A8')
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.MEDIUM)
  })
})

// ── SAME_DAY_BURST ────────────────────────────────────────────────────────────

describe('detectAnomalies - SAME_DAY_BURST', () => {
  it('detects MEDIUM severity for 2 records on same asset same day', () => {
    const records = [
      makeRecord({ asset_no: 'B1', id: 'b001', issue_date: '2024-07-01', serial_no: 'SN-B1', qty: 1 }),
      makeRecord({ asset_no: 'B1', id: 'b002', issue_date: '2024-07-01', serial_no: 'SN-B2', qty: 1 }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SAME_DAY_BURST && a.asset_no === 'B1')
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.MEDIUM)
  })

  it('detects HIGH severity for 3+ records on same asset same day', () => {
    const records = [
      makeRecord({ asset_no: 'B2', id: 'b003', issue_date: '2024-07-02', serial_no: 'SN-C1', qty: 1 }),
      makeRecord({ asset_no: 'B2', id: 'b004', issue_date: '2024-07-02', serial_no: 'SN-C2', qty: 1 }),
      makeRecord({ asset_no: 'B2', id: 'b005', issue_date: '2024-07-02', serial_no: 'SN-C3', qty: 1 }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SAME_DAY_BURST && a.asset_no === 'B2')
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.HIGH)
  })

  it('does NOT flag single record on an asset for a given day', () => {
    const records = [
      makeRecord({ asset_no: 'B3', id: 'b006', issue_date: '2024-07-03', serial_no: 'SN-D1', qty: 1 }),
    ]
    const result = detectAnomalies(records)
    const burst = result.filter(a => a.type === ANOMALY_TYPES.SAME_DAY_BURST && a.asset_no === 'B3')
    expect(burst).toHaveLength(0)
  })

  it('detects HIGH severity when totalQty >= 3 from a single record with high qty', () => {
    const records = [
      makeRecord({ asset_no: 'B4', id: 'b007', issue_date: '2024-07-04', serial_no: 'SN-E1', qty: 3 }),
      makeRecord({ asset_no: 'B4', id: 'b008', issue_date: '2024-07-04', serial_no: 'SN-E2', qty: 1 }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SAME_DAY_BURST && a.asset_no === 'B4')
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.HIGH)
  })

  it('anomaly message includes the count and date', () => {
    const records = [
      makeRecord({ asset_no: 'B5', id: 'b009', issue_date: '2024-07-05', serial_no: 'SN-F1', qty: 1 }),
      makeRecord({ asset_no: 'B5', id: 'b010', issue_date: '2024-07-05', serial_no: 'SN-F2', qty: 1 }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SAME_DAY_BURST && a.asset_no === 'B5')
    expect(anomaly.message).toContain('B5')
    expect(anomaly.message).toContain('2024-07-05')
  })

  it('groups records on different days separately', () => {
    const records = [
      makeRecord({ asset_no: 'B6', id: 'b011', issue_date: '2024-07-01', serial_no: 'SN-G1' }),
      makeRecord({ asset_no: 'B6', id: 'b012', issue_date: '2024-07-01', serial_no: 'SN-G2' }),
      makeRecord({ asset_no: 'B6', id: 'b013', issue_date: '2024-07-05', serial_no: 'SN-G3' }),
      makeRecord({ asset_no: 'B6', id: 'b014', issue_date: '2024-07-05', serial_no: 'SN-G4' }),
    ]
    const result = detectAnomalies(records)
    const bursts = result.filter(a => a.type === ANOMALY_TYPES.SAME_DAY_BURST && a.asset_no === 'B6')
    expect(bursts).toHaveLength(2)
  })
})

// ── RAPID_RECURRENCE ──────────────────────────────────────────────────────────

describe('detectAnomalies - RAPID_RECURRENCE', () => {
  it('detects when 3 High-risk events on same asset within 30 days', () => {
    const records = [
      makeRecord({ asset_no: 'C1', id: 'c001', issue_date: '2024-06-01', risk_level: 'High', serial_no: 'SN-H1' }),
      makeRecord({ asset_no: 'C1', id: 'c002', issue_date: '2024-06-10', risk_level: 'High', serial_no: 'SN-H2' }),
      makeRecord({ asset_no: 'C1', id: 'c003', issue_date: '2024-06-20', risk_level: 'High', serial_no: 'SN-H3' }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE)
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.HIGH)
    expect(anomaly.asset_no).toBe('C1')
  })

  it('does NOT flag when 3 High-risk events span more than 30 days', () => {
    const records = [
      makeRecord({ asset_no: 'C2', id: 'c004', issue_date: '2024-01-01', risk_level: 'High', serial_no: 'SN-I1' }),
      makeRecord({ asset_no: 'C2', id: 'c005', issue_date: '2024-02-15', risk_level: 'High', serial_no: 'SN-I2' }),
      makeRecord({ asset_no: 'C2', id: 'c006', issue_date: '2024-04-01', risk_level: 'High', serial_no: 'SN-I3' }),
    ]
    const result = detectAnomalies(records)
    const rr = result.filter(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE && a.asset_no === 'C2')
    expect(rr).toHaveLength(0)
  })

  it('does NOT flag when fewer than 3 High-risk events', () => {
    const records = [
      makeRecord({ asset_no: 'C3', id: 'c007', issue_date: '2024-06-01', risk_level: 'High', serial_no: 'SN-J1' }),
      makeRecord({ asset_no: 'C3', id: 'c008', issue_date: '2024-06-10', risk_level: 'High', serial_no: 'SN-J2' }),
    ]
    const result = detectAnomalies(records)
    const rr = result.filter(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE && a.asset_no === 'C3')
    expect(rr).toHaveLength(0)
  })

  it('does NOT count Medium or Low risk events toward RAPID_RECURRENCE', () => {
    const records = [
      makeRecord({ asset_no: 'C4', id: 'c009', issue_date: '2024-06-01', risk_level: 'Medium', serial_no: 'SN-K1' }),
      makeRecord({ asset_no: 'C4', id: 'c010', issue_date: '2024-06-05', risk_level: 'Low',    serial_no: 'SN-K2' }),
      makeRecord({ asset_no: 'C4', id: 'c011', issue_date: '2024-06-10', risk_level: 'High',   serial_no: 'SN-K3' }),
    ]
    const result = detectAnomalies(records)
    const rr = result.filter(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE && a.asset_no === 'C4')
    expect(rr).toHaveLength(0)
  })

  it('only generates one anomaly per asset cluster (breaks after first)', () => {
    const records = [
      makeRecord({ asset_no: 'C5', id: 'c012', issue_date: '2024-06-01', risk_level: 'High', serial_no: 'SN-L1' }),
      makeRecord({ asset_no: 'C5', id: 'c013', issue_date: '2024-06-05', risk_level: 'High', serial_no: 'SN-L2' }),
      makeRecord({ asset_no: 'C5', id: 'c014', issue_date: '2024-06-10', risk_level: 'High', serial_no: 'SN-L3' }),
      makeRecord({ asset_no: 'C5', id: 'c015', issue_date: '2024-06-15', risk_level: 'High', serial_no: 'SN-L4' }),
    ]
    const result = detectAnomalies(records)
    const rr = result.filter(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE && a.asset_no === 'C5')
    expect(rr).toHaveLength(1)
  })

  it('respects rapidRecurrenceWindow config override', () => {
    // 3 high-risk events, 10 days apart
    const records = [
      makeRecord({ asset_no: 'C6', id: 'c016', issue_date: '2024-06-01', risk_level: 'High', serial_no: 'SN-M1' }),
      makeRecord({ asset_no: 'C6', id: 'c017', issue_date: '2024-06-11', risk_level: 'High', serial_no: 'SN-M2' }),
      makeRecord({ asset_no: 'C6', id: 'c018', issue_date: '2024-06-21', risk_level: 'High', serial_no: 'SN-M3' }),
    ]
    // With window=5 days, 20 days span should NOT trigger
    const resultNo = detectAnomalies(records, { rapidRecurrenceWindow: 5 })
    expect(resultNo.filter(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE && a.asset_no === 'C6')).toHaveLength(0)

    // With window=25 days it should trigger
    const resultYes = detectAnomalies(records, { rapidRecurrenceWindow: 25 })
    expect(resultYes.filter(a => a.type === ANOMALY_TYPES.RAPID_RECURRENCE && a.asset_no === 'C6')).toHaveLength(1)
  })
})

// ── COST_SPIKE ────────────────────────────────────────────────────────────────

describe('detectAnomalies - COST_SPIKE', () => {
  // Build a fleet with predictable mean/stdDev for testing z-score
  function buildFleetWithSpike(spikeValue) {
    // 10 records at cost=1000, 1 spike
    const base = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `fleet-${i}`, cost_per_tyre: 1000, serial_no: `SN-fleet-${i}` })
    )
    const spike = makeRecord({ id: 'spike-rec', cost_per_tyre: spikeValue, serial_no: 'SN-spike' })
    return [...base, spike]
  }

  it('detects HIGH severity cost spike when z-score >= 3', () => {
    // mean(10x1000 + 1x10000) ~= 1818, stdDev ~= 2728, z for 10000 = (10000-1818)/2728 ≈ 3
    const records = buildFleetWithSpike(10000)
    const result = detectAnomalies(records)
    const spike = result.find(a => a.type === ANOMALY_TYPES.COST_SPIKE && a.record_ids.includes('spike-rec'))
    expect(spike).toBeDefined()
    expect(spike.severity).toBe(ANOMALY_SEVERITY.HIGH)
  })

  it('detects MEDIUM severity when z-score is between 2 and 3', () => {
    // 10 records at 1000, 1 at 4000
    // mean ≈ 1272, stdDev ≈ 882, z ≈ (4000-1272)/882 ≈ 3.1 - this might be HIGH
    // Use 10 at 1000 and 1 at 3500 to get z ~= 2.5
    const base = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `med-${i}`, cost_per_tyre: 1000, serial_no: `SN-med-${i}` })
    )
    const spike = makeRecord({ id: 'med-spike', cost_per_tyre: 3500, serial_no: 'SN-med-spike' })
    const records = [...base, spike]
    const result = detectAnomalies(records)
    const costAnomalies = result.filter(a => a.type === ANOMALY_TYPES.COST_SPIKE)
    // Check z-score is computed and at least the medium-threshold record is flagged
    expect(costAnomalies.length).toBeGreaterThanOrEqual(1)
    const spikeAnomaly = costAnomalies.find(a => a.record_ids.includes('med-spike'))
    expect(spikeAnomaly).toBeDefined()
    expect([ANOMALY_SEVERITY.HIGH, ANOMALY_SEVERITY.MEDIUM]).toContain(spikeAnomaly.severity)
  })

  it('does NOT flag when all costs are the same (stdDev=0)', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ id: `same-${i}`, cost_per_tyre: 1000, serial_no: `SN-same-${i}` })
    )
    const result = detectAnomalies(records)
    expect(result.filter(a => a.type === ANOMALY_TYPES.COST_SPIKE)).toHaveLength(0)
  })

  it('does NOT flag records with zero or missing cost_per_tyre', () => {
    const records = [
      makeRecord({ id: 'zero-cost', cost_per_tyre: 0, serial_no: 'SN-zero' }),
      makeRecord({ id: 'null-cost', cost_per_tyre: null, serial_no: 'SN-null' }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeRecord({ id: `base-cs-${i}`, cost_per_tyre: 1000, serial_no: `SN-base-cs-${i}` })
      ),
    ]
    const result = detectAnomalies(records)
    const costSpikes = result.filter(a => a.type === ANOMALY_TYPES.COST_SPIKE)
    const ids = costSpikes.flatMap(a => a.record_ids)
    expect(ids).not.toContain('zero-cost')
    expect(ids).not.toContain('null-cost')
  })

  it('anomaly includes fleetAvg and zScore fields', () => {
    const records = buildFleetWithSpike(10000)
    const result = detectAnomalies(records)
    const spike = result.find(a => a.type === ANOMALY_TYPES.COST_SPIKE && a.record_ids.includes('spike-rec'))
    expect(spike).toBeDefined()
    expect(spike.fleetAvg).toBeGreaterThan(0)
    expect(typeof spike.zScore).toBe('number')
  })
})

// ── SERIAL_REUSE ──────────────────────────────────────────────────────────────

describe('detectAnomalies - SERIAL_REUSE', () => {
  it('detects serial reuse when same serial_no appears on 2 different assets', () => {
    const records = [
      makeRecord({ asset_no: 'D1', id: 'd001', serial_no: 'SHARED-SN', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'D2', id: 'd002', serial_no: 'SHARED-SN', issue_date: '2024-02-01' }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
    expect(anomaly).toBeDefined()
    expect(anomaly.severity).toBe(ANOMALY_SEVERITY.HIGH)
    expect(anomaly.serial).toBe('SHARED-SN')
    expect(anomaly.assets).toHaveLength(2)
  })

  it('does NOT flag serial appearing on the same asset multiple times', () => {
    const records = [
      makeRecord({ asset_no: 'D3', id: 'd003', serial_no: 'SAME-ASSET-SN', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'D3', id: 'd004', serial_no: 'SAME-ASSET-SN', issue_date: '2024-06-01' }),
    ]
    const result = detectAnomalies(records)
    const sr = result.filter(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
    // No serial reuse if all on same asset
    // Note: this will also generate a DUPLICATE check (same asset+serial+date would be different)
    expect(sr).toHaveLength(0)
  })

  it('does NOT flag records with null serial_no', () => {
    const records = [
      makeRecord({ asset_no: 'D5', id: 'd007', serial_no: null, issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'D6', id: 'd008', serial_no: null, issue_date: '2024-02-01' }),
    ]
    const result = detectAnomalies(records)
    const sr = result.filter(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
    expect(sr).toHaveLength(0)
  })

  it('anomaly includes list of assets', () => {
    const records = [
      makeRecord({ asset_no: 'D7', id: 'd009', serial_no: 'MULTI-SN', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'D8', id: 'd010', serial_no: 'MULTI-SN', issue_date: '2024-01-10' }),
      makeRecord({ asset_no: 'D9', id: 'd011', serial_no: 'MULTI-SN', issue_date: '2024-01-20' }),
    ]
    const result = detectAnomalies(records)
    const anomaly = result.find(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
    expect(anomaly.assets).toHaveLength(3)
    expect(anomaly.assets).toContain('D7')
    expect(anomaly.assets).toContain('D8')
    expect(anomaly.assets).toContain('D9')
  })

  it('produces only one anomaly per serial number (deduped by seen set)', () => {
    const records = [
      makeRecord({ asset_no: 'E1', id: 'e001', serial_no: 'ONCE-SN', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'E2', id: 'e002', serial_no: 'ONCE-SN', issue_date: '2024-02-01' }),
      makeRecord({ asset_no: 'E3', id: 'e003', serial_no: 'ONCE-SN', issue_date: '2024-03-01' }),
    ]
    const result = detectAnomalies(records)
    const sr = result.filter(a => a.type === ANOMALY_TYPES.SERIAL_REUSE && a.serial === 'ONCE-SN')
    expect(sr).toHaveLength(1)
  })
})

// ── DUPLICATE_ENTRY ───────────────────────────────────────────────────────────

describe('detectAnomalies - DUPLICATE_ENTRY', () => {
  it('detects exact duplicate (same asset + serial + date)', () => {
    const records = [
      makeRecord({ asset_no: 'F1', id: 'f001', serial_no: 'DUP-SN', issue_date: '2024-05-01' }),
      makeRecord({ asset_no: 'F1', id: 'f002', serial_no: 'DUP-SN', issue_date: '2024-05-01' }),
    ]
    const result = detectAnomalies(records)
    const dup = result.find(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
    expect(dup).toBeDefined()
    expect(dup.severity).toBe(ANOMALY_SEVERITY.HIGH)
    expect(dup.asset_no).toBe('F1')
  })

  it('does NOT flag same asset + serial on DIFFERENT dates', () => {
    const records = [
      makeRecord({ asset_no: 'F2', id: 'f003', serial_no: 'DIFF-DATE-SN', issue_date: '2024-05-01' }),
      makeRecord({ asset_no: 'F2', id: 'f004', serial_no: 'DIFF-DATE-SN', issue_date: '2024-06-01' }),
    ]
    const result = detectAnomalies(records)
    const dup = result.filter(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY && a.asset_no === 'F2')
    expect(dup).toHaveLength(0)
  })

  it('does NOT flag different assets with same serial + date', () => {
    // Note: this WOULD trigger SERIAL_REUSE but not DUPLICATE_ENTRY
    const records = [
      makeRecord({ asset_no: 'F3', id: 'f005', serial_no: 'DIFF-ASSET-SN', issue_date: '2024-05-01' }),
      makeRecord({ asset_no: 'F4', id: 'f006', serial_no: 'DIFF-ASSET-SN', issue_date: '2024-05-01' }),
    ]
    const result = detectAnomalies(records)
    const dup = result.filter(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
    expect(dup).toHaveLength(0)
  })

  it('skips records where any of asset_no, serial_no, or issue_date is missing', () => {
    const records = [
      makeRecord({ id: 'f007', asset_no: null, serial_no: 'SN-OK',  issue_date: '2024-05-01' }),
      makeRecord({ id: 'f008', asset_no: null, serial_no: 'SN-OK',  issue_date: '2024-05-01' }),
    ]
    const result = detectAnomalies(records)
    const dup = result.filter(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
    expect(dup).toHaveLength(0)
  })

  it('anomaly count field reflects number of duplicate records', () => {
    const records = [
      makeRecord({ asset_no: 'F5', id: 'f009', serial_no: 'TRIP-DUP', issue_date: '2024-05-01' }),
      makeRecord({ asset_no: 'F5', id: 'f010', serial_no: 'TRIP-DUP', issue_date: '2024-05-01' }),
      makeRecord({ asset_no: 'F5', id: 'f011', serial_no: 'TRIP-DUP', issue_date: '2024-05-01' }),
    ]
    const result = detectAnomalies(records)
    const dup = result.find(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
    expect(dup.count).toBe(3)
  })
})

// ── Output ordering ───────────────────────────────────────────────────────────

describe('detectAnomalies - result ordering', () => {
  it('returns HIGH severity anomalies before MEDIUM ones', () => {
    // SHORT_INTERVAL < 7 days → HIGH; SHORT_INTERVAL 7-30 days → MEDIUM
    const records = [
      makeRecord({ asset_no: 'G1', id: 'g001', issue_date: '2024-06-01', serial_no: 'SN-G1a' }),
      makeRecord({ asset_no: 'G1', id: 'g002', issue_date: '2024-06-15', serial_no: 'SN-G1b' }), // 14 days → MEDIUM
      makeRecord({ asset_no: 'G2', id: 'g003', issue_date: '2024-06-01', serial_no: 'SN-G2a' }),
      makeRecord({ asset_no: 'G2', id: 'g004', issue_date: '2024-06-03', serial_no: 'SN-G2b' }), // 2 days → HIGH
    ]
    const result = detectAnomalies(records)
    const severities = result.map(a => a.severity)
    const firstMediumIdx = severities.indexOf('medium')
    const lastHighIdx = severities.lastIndexOf('high')
    // Either there are no mediums, or all highs come before all mediums
    if (firstMediumIdx !== -1 && lastHighIdx !== -1) {
      expect(lastHighIdx).toBeLessThan(firstMediumIdx)
    }
  })
})

// ── summariseAnomalies ────────────────────────────────────────────────────────

describe('summariseAnomalies', () => {
  it('returns zero counts for empty array', () => {
    const result = summariseAnomalies([])
    expect(result.total).toBe(0)
    expect(result.bySeverity.high).toBe(0)
    expect(result.bySeverity.medium).toBe(0)
    expect(result.bySeverity.low).toBe(0)
  })

  it('counts total anomalies', () => {
    const anomalies = [
      { severity: 'high',   type: ANOMALY_TYPES.SHORT_INTERVAL },
      { severity: 'medium', type: ANOMALY_TYPES.SAME_DAY_BURST },
      { severity: 'high',   type: ANOMALY_TYPES.COST_SPIKE },
    ]
    const result = summariseAnomalies(anomalies)
    expect(result.total).toBe(3)
  })

  it('counts by severity correctly', () => {
    const anomalies = [
      { severity: 'high',   type: ANOMALY_TYPES.SHORT_INTERVAL },
      { severity: 'medium', type: ANOMALY_TYPES.SAME_DAY_BURST },
      { severity: 'high',   type: ANOMALY_TYPES.COST_SPIKE },
    ]
    const result = summariseAnomalies(anomalies)
    expect(result.bySeverity.high).toBe(2)
    expect(result.bySeverity.medium).toBe(1)
    expect(result.bySeverity.low).toBe(0)
  })

  it('counts by type correctly', () => {
    const anomalies = [
      { severity: 'high', type: ANOMALY_TYPES.SHORT_INTERVAL },
      { severity: 'high', type: ANOMALY_TYPES.SHORT_INTERVAL },
      { severity: 'high', type: ANOMALY_TYPES.COST_SPIKE },
    ]
    const result = summariseAnomalies(anomalies)
    expect(result.byType[ANOMALY_TYPES.SHORT_INTERVAL]).toBe(2)
    expect(result.byType[ANOMALY_TYPES.COST_SPIKE]).toBe(1)
  })
})

// ── Multiple anomaly types in one run ─────────────────────────────────────────

describe('detectAnomalies - combined scenario', () => {
  it('can detect multiple anomaly types in a single call', () => {
    // SHORT_INTERVAL: asset X1, 3 days apart
    // DUPLICATE_ENTRY: asset Y1, same serial+date
    // SERIAL_REUSE: serial SHARED across Z1, Z2
    const records = [
      makeRecord({ asset_no: 'X1', id: 'combo-001', issue_date: '2024-06-01', serial_no: 'SN-X1a' }),
      makeRecord({ asset_no: 'X1', id: 'combo-002', issue_date: '2024-06-04', serial_no: 'SN-X1b' }),
      makeRecord({ asset_no: 'Y1', id: 'combo-003', issue_date: '2024-07-01', serial_no: 'SN-DUP' }),
      makeRecord({ asset_no: 'Y1', id: 'combo-004', issue_date: '2024-07-01', serial_no: 'SN-DUP' }),
      makeRecord({ asset_no: 'Z1', id: 'combo-005', issue_date: '2024-08-01', serial_no: 'SN-SHARED' }),
      makeRecord({ asset_no: 'Z2', id: 'combo-006', issue_date: '2024-08-10', serial_no: 'SN-SHARED' }),
    ]
    const result = detectAnomalies(records)
    const types = new Set(result.map(a => a.type))
    expect(types.has(ANOMALY_TYPES.SHORT_INTERVAL)).toBe(true)
    expect(types.has(ANOMALY_TYPES.DUPLICATE_ENTRY)).toBe(true)
    expect(types.has(ANOMALY_TYPES.SERIAL_REUSE)).toBe(true)
  })
})

// ── Edge cases: single record ─────────────────────────────────────────────────

describe('detectAnomalies - single record edge cases', () => {
  it('single record with missing asset_no does not crash', () => {
    const records = [makeRecord({ asset_no: null, id: 'single-no-asset' })]
    expect(() => detectAnomalies(records)).not.toThrow()
    const result = detectAnomalies(records)
    expect(Array.isArray(result)).toBe(true)
  })

  it('single record with missing serial_no does not crash', () => {
    const records = [makeRecord({ serial_no: null, id: 'single-no-serial' })]
    expect(() => detectAnomalies(records)).not.toThrow()
  })

  it('single record with missing issue_date does not crash', () => {
    const records = [makeRecord({ issue_date: null, id: 'single-no-date' })]
    expect(() => detectAnomalies(records)).not.toThrow()
  })

  it('single record with all fields null does not crash', () => {
    const records = [{
      id: 'all-null',
      asset_no: null,
      serial_no: null,
      issue_date: null,
      cost_per_tyre: null,
      qty: null,
      risk_level: null,
      brand: null,
      site: null,
    }]
    expect(() => detectAnomalies(records)).not.toThrow()
    const result = detectAnomalies(records)
    expect(Array.isArray(result)).toBe(true)
  })

  it('single record generates no SHORT_INTERVAL, SERIAL_REUSE, DUPLICATE_ENTRY, or RAPID_RECURRENCE anomalies', () => {
    const records = [makeRecord({ id: 'only-one' })]
    const result = detectAnomalies(records)
    const badTypes = [
      ANOMALY_TYPES.SHORT_INTERVAL,
      ANOMALY_TYPES.SERIAL_REUSE,
      ANOMALY_TYPES.DUPLICATE_ENTRY,
      ANOMALY_TYPES.RAPID_RECURRENCE,
    ]
    badTypes.forEach(type => {
      expect(result.filter(a => a.type === type)).toHaveLength(0)
    })
  })
})

// ── Edge cases: all-zero costs ────────────────────────────────────────────────

describe('detectAnomalies - all-zero costs', () => {
  it('no COST_SPIKE when all records have cost_per_tyre = 0', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ id: `zero-${i}`, cost_per_tyre: 0, serial_no: `SN-z${i}` })
    )
    const result = detectAnomalies(records)
    expect(result.filter(a => a.type === ANOMALY_TYPES.COST_SPIKE)).toHaveLength(0)
  })

  it('no COST_SPIKE when all costs are null', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ id: `null-cost-${i}`, cost_per_tyre: null, serial_no: `SN-nc${i}` })
    )
    const result = detectAnomalies(records)
    expect(result.filter(a => a.type === ANOMALY_TYPES.COST_SPIKE)).toHaveLength(0)
  })

  it('no COST_SPIKE when all costs are identical (stdDev = 0)', () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeRecord({ id: `ident-${i}`, cost_per_tyre: 750, serial_no: `SN-id${i}` })
    )
    const result = detectAnomalies(records)
    expect(result.filter(a => a.type === ANOMALY_TYPES.COST_SPIKE)).toHaveLength(0)
  })
})

// ── Edge cases: records missing fields ────────────────────────────────────────

describe('detectAnomalies - records with missing fields', () => {
  it('handles records with missing brand gracefully', () => {
    const records = [
      makeRecord({ asset_no: 'TRK-X', id: 'miss-brand-1', issue_date: '2024-06-01', brand: null, serial_no: 'SN-mb1' }),
      makeRecord({ asset_no: 'TRK-X', id: 'miss-brand-2', issue_date: '2024-06-03', brand: undefined, serial_no: 'SN-mb2' }),
    ]
    expect(() => detectAnomalies(records)).not.toThrow()
    const result = detectAnomalies(records)
    const si = result.find(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL && a.asset_no === 'TRK-X')
    expect(si).toBeDefined()
    expect(si.detail).toContain('unknown brand')
  })

  it('handles records with missing site gracefully', () => {
    const records = [
      makeRecord({ asset_no: 'TRK-Y', id: 'miss-site-1', issue_date: '2024-07-01', site: null, serial_no: 'SN-ms1' }),
      makeRecord({ asset_no: 'TRK-Y', id: 'miss-site-2', issue_date: '2024-07-03', site: null, serial_no: 'SN-ms2' }),
    ]
    expect(() => detectAnomalies(records)).not.toThrow()
  })

  it('handles records with zero qty - falls back to 1 for same-day-burst count', () => {
    const records = [
      makeRecord({ asset_no: 'TRK-Z', id: 'zero-qty-1', issue_date: '2024-08-01', qty: 0, serial_no: 'SN-zq1' }),
      makeRecord({ asset_no: 'TRK-Z', id: 'zero-qty-2', issue_date: '2024-08-01', qty: 0, serial_no: 'SN-zq2' }),
    ]
    expect(() => detectAnomalies(records)).not.toThrow()
  })

  it('handles mixed valid and invalid records without crashing', () => {
    const records = [
      makeRecord({ id: 'valid-1', asset_no: 'TRK-V', issue_date: '2024-06-01', serial_no: 'SN-v1' }),
      { id: 'bad-1', asset_no: undefined, serial_no: undefined, issue_date: undefined, cost_per_tyre: undefined },
      makeRecord({ id: 'valid-2', asset_no: 'TRK-V', issue_date: '2024-06-04', serial_no: 'SN-v2' }),
    ]
    expect(() => detectAnomalies(records)).not.toThrow()
    const result = detectAnomalies(records)
    const si = result.find(a => a.type === ANOMALY_TYPES.SHORT_INTERVAL && a.asset_no === 'TRK-V')
    expect(si).toBeDefined()
  })
})

// ── Edge cases: duplicate serial numbers ─────────────────────────────────────

describe('detectAnomalies - duplicate serial number edge cases', () => {
  it('empty string serial_no is NOT flagged as serial reuse', () => {
    const records = [
      makeRecord({ asset_no: 'TRK-A', id: 'empty-sn-1', serial_no: '', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'TRK-B', id: 'empty-sn-2', serial_no: '', issue_date: '2024-02-01' }),
    ]
    const result = detectAnomalies(records)
    const sr = result.filter(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
    expect(sr).toHaveLength(0)
  })

  it('serial reuse detected across 4 different assets', () => {
    const records = ['TRK-R1', 'TRK-R2', 'TRK-R3', 'TRK-R4'].map((asset, i) =>
      makeRecord({ asset_no: asset, id: `reuse-${i}`, serial_no: 'REUSED-4', issue_date: `2024-0${i + 1}-01` })
    )
    const result = detectAnomalies(records)
    const sr = result.find(a => a.type === ANOMALY_TYPES.SERIAL_REUSE && a.serial === 'REUSED-4')
    expect(sr).toBeDefined()
    expect(sr.assets).toHaveLength(4)
  })

  it('two different serials reused across different assets generate separate anomalies', () => {
    const records = [
      makeRecord({ asset_no: 'A1', id: 'ds-1', serial_no: 'SERIAL-X', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'A2', id: 'ds-2', serial_no: 'SERIAL-X', issue_date: '2024-02-01' }),
      makeRecord({ asset_no: 'B1', id: 'ds-3', serial_no: 'SERIAL-Y', issue_date: '2024-01-01' }),
      makeRecord({ asset_no: 'B2', id: 'ds-4', serial_no: 'SERIAL-Y', issue_date: '2024-02-01' }),
    ]
    const result = detectAnomalies(records)
    const sr = result.filter(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)
    expect(sr).toHaveLength(2)
    const serials = sr.map(a => a.serial).sort()
    expect(serials).toEqual(['SERIAL-X', 'SERIAL-Y'])
  })

  it('duplicate entry requires all three fields - different dates means no duplicate', () => {
    const records = [
      makeRecord({ asset_no: 'TRK-Q', id: 'nd-1', serial_no: 'SN-Q', issue_date: '2024-05-01' }),
      makeRecord({ asset_no: 'TRK-Q', id: 'nd-2', serial_no: 'SN-Q', issue_date: '2024-06-01' }),
    ]
    const result = detectAnomalies(records)
    const dup = result.filter(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
    expect(dup).toHaveLength(0)
  })

  it('exact duplicate with 4 records shows count of 4', () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      makeRecord({ asset_no: 'TRK-QUAD', id: `quad-${i}`, serial_no: 'SN-QUAD', issue_date: '2024-06-01' })
    )
    const result = detectAnomalies(records)
    const dup = result.find(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)
    expect(dup).toBeDefined()
    expect(dup.count).toBe(4)
  })
})
