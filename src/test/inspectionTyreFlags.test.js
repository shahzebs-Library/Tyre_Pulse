import { describe, it, expect } from 'vitest'
import { buildAssetFlagMap, damagedPositions, inspectionOverview } from '../lib/inspectionTyreFlags'

// Shaped running-life rows (bandFor vocabulary):
// overdue = remainingKm === 0; due-soon = remainingKm < 10000 or used >= 90.
const overdueRow = (asset, serial = 'S1') => ({ asset, serial, position: 'LHF1', remainingKm: 0, lifeUsedPct: 100 })
const dueSoonRow = (asset, serial = 'S2') => ({ asset, serial, position: 'RHF1', remainingKm: 5000, lifeUsedPct: 80 })
const healthyRow = (asset, serial = 'S3') => ({ asset, serial, position: 'LHR1', remainingKm: 50000, lifeUsedPct: 20 })

describe('buildAssetFlagMap', () => {
  it('groups overdue and due-soon rows per asset with a total count', () => {
    const map = buildAssetFlagMap([overdueRow('TM100'), dueSoonRow('TM100'), dueSoonRow('TM200')])
    expect(map.TM100.overdue).toHaveLength(1)
    expect(map.TM100.dueSoon).toHaveLength(1)
    expect(map.TM100.count).toBe(2)
    expect(map.TM200.count).toBe(1)
  })

  it('excludes healthy/unknown tyres and assets without flags', () => {
    const map = buildAssetFlagMap([healthyRow('TM300'), { asset: 'TM400', remainingKm: null }])
    expect(map).toEqual({})
  })

  it('is safe on empty/garbage input', () => {
    expect(buildAssetFlagMap()).toEqual({})
    expect(buildAssetFlagMap([null, {}, { serial: 'X' }])).toEqual({})
  })

  it('judges an hour-metered tyre by its hours side', () => {
    const map = buildAssetFlagMap([{ asset: 'GN1', remainingKm: null, remainingHours: 0, hoursUsedPct: 100 }])
    expect(map.GN1.overdue).toHaveLength(1)
  })
})

describe('damagedPositions', () => {
  it('reads an array of {position, condition} (checklist shape)', () => {
    const out = damagedPositions({ tyre_conditions: [
      { position: 'LHF1', condition: 'Damage' },
      { position: 'RHF1', condition: 'Good' },
      { position: 'LHR1', condition: 'Puncture' },
    ] })
    expect(out).toEqual([
      { position: 'LHF1', condition: 'Damage' },
      { position: 'LHR1', condition: 'Puncture' },
    ])
  })

  it('reads an object keyed by position with string or object values, case-insensitively', () => {
    const out = damagedPositions({ tyre_conditions: {
      LHF1: 'damage',
      RHF1: { condition: 'Wear' },
      RHR1: { condition: 'Puncture' },
    } })
    expect(out).toEqual([
      { position: 'LHF1', condition: 'damage' },
      { position: 'RHR1', condition: 'Puncture' },
    ])
  })

  it('parses a JSON string and returns [] on garbage', () => {
    expect(damagedPositions({ tyre_conditions: '[{"position":"LHF1","condition":"Damage"}]' }))
      .toEqual([{ position: 'LHF1', condition: 'Damage' }])
    expect(damagedPositions({ tyre_conditions: 'not json' })).toEqual([])
    expect(damagedPositions({ tyre_conditions: 42 })).toEqual([])
    expect(damagedPositions(null)).toEqual([])
    expect(damagedPositions({})).toEqual([])
  })
})

describe('inspectionOverview', () => {
  const flagMap = buildAssetFlagMap([overdueRow('TM100'), dueSoonRow('TM100'), dueSoonRow('TM200'), overdueRow('TM900')])
  const inspections = [
    { asset_no: 'TM100', scheduled_date: '2026-08-01', approval_status: 'approved', tyre_conditions: [{ position: 'LHF1', condition: 'Damage' }] },
    { asset_no: 'TM100', scheduled_date: '2026-08-05', approval_status: 'pending_approval', tyre_conditions: {} },
    { asset_no: 'TM200', scheduled_date: '2026-08-03', approval_status: null, tyre_conditions: { RHF1: 'Puncture' } },
    { asset_no: 'TM300', scheduled_date: '2026-07-01', approval_status: 'approved', tyre_conditions: null },
  ]

  it('counts inspections, distinct vehicles and approval states', () => {
    const o = inspectionOverview(inspections, flagMap)
    expect(o.inspectionsDone).toBe(4)
    expect(o.vehiclesInspected).toBe(3) // TM100 counted once
    expect(o.approved).toBe(2)
    expect(o.pendingApproval).toBe(1)
  })

  it('counts flagged tyres only for INSPECTED vehicles (TM900 never inspected)', () => {
    const o = inspectionOverview(inspections, flagMap)
    expect(o.vehiclesWithTyresDue).toBe(2) // TM100 + TM200
    expect(o.tyresOverdue).toBe(1) // TM900 overdue tyre excluded
    expect(o.tyresDueSoon).toBe(2)
  })

  it('totals damaged positions across inspections', () => {
    expect(inspectionOverview(inspections, flagMap).damagedFound).toBe(2)
  })

  it('respects the from/to window (string prefix compare)', () => {
    const o = inspectionOverview(inspections, flagMap, { from: '2026-08-01', to: '2026-08-04' })
    expect(o.inspectionsDone).toBe(2)
    expect(o.vehiclesInspected).toBe(2)
    expect(o.vehiclesWithTyresDue).toBe(2)
    // TM300 (July) out of window; its approved mark drops too
    expect(o.approved).toBe(1)
  })

  it('excludes rows with no usable date while a window is active', () => {
    const o = inspectionOverview([{ asset_no: 'X' }], {}, { from: '2026-01-01' })
    expect(o.inspectionsDone).toBe(0)
  })

  it('returns honest zeros on empty input or missing flag map', () => {
    expect(inspectionOverview([], {})).toEqual({
      inspectionsDone: 0, vehiclesInspected: 0, approved: 0, pendingApproval: 0,
      vehiclesWithTyresDue: 0, tyresOverdue: 0, tyresDueSoon: 0, damagedFound: 0,
    })
    const o = inspectionOverview(inspections, null)
    expect(o.vehiclesWithTyresDue).toBe(0)
    expect(o.inspectionsDone).toBe(4)
  })
})
