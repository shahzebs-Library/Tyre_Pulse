import { describe, it, expect } from 'vitest'
import {
  buildExceptions,
  summarizeExceptions,
  tyreCpk,
  percentile,
  CATEGORIES,
} from '../lib/opsIntelligence'

// Fixed reference clock so every age-derived exception is deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

// ── Fixture ─────────────────────────────────────────────────────────────────
// A small fleet exercising every category + severity path. In-service tyres have
// removal_date === null; the removed one carries a reason.
const tyres = [
  // Aged (fitted 2019 → > 5 yrs as of 2026) + also a high-CPK candidate.
  {
    id: 't1', serial_no: 'SN-AGED', asset_no: 'V-1', site: 'Riyadh',
    brand: 'Bridgestone', size: '295/80R22.5', tread_depth: 8,
    cost_per_tyre: 2000, total_km: 10000, fitment_date: '2019-01-01',
    removal_date: null,
  },
  // Low tread — HIGH (< 3mm), in service.
  {
    id: 't2', serial_no: 'SN-TREAD-HI', asset_no: 'V-2', site: 'Jeddah',
    brand: 'Michelin', size: '315/80R22.5', tread_depth: 2.4,
    cost_per_tyre: 1800, total_km: 90000, fitment_date: '2024-06-01',
    removal_date: null,
  },
  // Low tread — MEDIUM (>=3 and < 5mm), in service.
  {
    id: 't3', serial_no: 'SN-TREAD-MED', asset_no: 'V-3', site: 'Riyadh',
    brand: 'Goodyear', size: '295/80R22.5', tread_depth: 4.2,
    cost_per_tyre: 1600, total_km: 120000, fitment_date: '2024-02-01',
    removal_date: null,
  },
  // Healthy, cheap-per-km, recent — should produce NO exception.
  {
    id: 't4', serial_number: 'SN-OK', asset_no: 'V-4', site: 'Dammam',
    brand: 'Continental', size: '295/80R22.5', tread_depth: 12,
    cost_per_tyre: 1500, total_km: 150000, fitment_date: '2025-06-01',
    removal_date: null,
  },
  // Healthy — provides more CPK samples so the p90 cut-off is meaningful.
  {
    id: 't5', tyre_serial: 'SN-OK2', asset_no: 'V-5', site: 'Dammam',
    brand: 'Hankook', size: '295/80R22.5', tread_depth: 11,
    cost_per_tyre: 1400, total_km: 140000, fitment_date: '2025-05-01',
    removal_date: null,
  },
  // Removed with a reason → recent_failure (MEDIUM). Not in service.
  {
    id: 't6', serial_no: 'SN-FAIL', asset_no: 'V-6', site: 'Jeddah',
    brand: 'Pirelli', size: '315/80R22.5', tread_depth: 1,
    cost_per_tyre: 1900, total_km: 40000, fitment_date: '2023-01-01',
    removal_date: '2026-06-01', reason_for_removal: 'Sidewall damage',
  },
  // Removed but NO reason → ignored entirely.
  {
    id: 't7', serial_no: 'SN-REMOVED-NOREASON', asset_no: 'V-7', site: 'Jeddah',
    tread_depth: 9, cost_per_tyre: 1000, total_km: 80000,
    fitment_date: '2023-01-01', removal_date: '2026-05-01',
  },
]

const workOrders = [
  // Open + Critical → HIGH exception.
  { id: 'w1', work_order_no: 'WO-100', asset_no: 'V-2', site: 'Jeddah', status: 'Open', priority: 'Critical', created_at: '2026-07-01T08:00:00Z' },
  // In Progress + High → HIGH exception.
  { id: 'w2', work_order_no: 'WO-101', asset_no: 'V-3', site: 'Riyadh', status: 'In Progress', priority: 'High', created_at: '2026-07-05T08:00:00Z' },
  // Open but Low priority → ignored.
  { id: 'w3', work_order_no: 'WO-102', asset_no: 'V-4', site: 'Dammam', status: 'Open', priority: 'Low', created_at: '2026-07-06T08:00:00Z' },
  // Completed + Critical → ignored (not open).
  { id: 'w4', work_order_no: 'WO-103', asset_no: 'V-5', site: 'Dammam', status: 'Completed', priority: 'Critical', created_at: '2026-06-01T08:00:00Z' },
]

describe('opsIntelligence — pure helpers', () => {
  it('tyreCpk divides cost by km, guarding zero/negative mileage', () => {
    expect(tyreCpk({ cost_per_tyre: 2000, total_km: 10000 })).toBeCloseTo(0.2, 6)
    expect(tyreCpk({ cost_per_tyre: 2000, total_km: 0 })).toBeNull()
    expect(tyreCpk({ cost_per_tyre: 2000, total_km: -5 })).toBeNull()
    expect(tyreCpk({ cost_per_tyre: null, total_km: 10000 })).toBeNull()
  })

  it('percentile interpolates and handles edge cases', () => {
    expect(percentile([], 0.9)).toBeNull()
    expect(percentile([42], 0.9)).toBe(42)
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })
})

describe('buildExceptions', () => {
  it('requires an explicit now', () => {
    expect(() => buildExceptions({ tyres, workOrders }, {})).toThrow(/now/)
  })

  it('derives every category with correct severities and deep-links', () => {
    const ex = buildExceptions({ tyres, workOrders }, { now: NOW })
    const byCat = (c) => ex.filter((e) => e.category === c)

    // 1. Aged tyre — high, links into the tyre passport by serial.
    const aged = byCat('aged_tyre')
    expect(aged).toHaveLength(1)
    expect(aged[0].serial).toBe('SN-AGED')
    expect(aged[0].severity).toBe('high')
    expect(aged[0].link).toBe('/tyre-passport/SN-AGED')
    expect(aged[0].ageYears).toBeGreaterThan(5)

    // 2. Low tread — one high (<3mm) and one medium (3–5mm).
    const tread = byCat('low_tread')
    expect(tread).toHaveLength(2)
    expect(tread.find((e) => e.serial === 'SN-TREAD-HI').severity).toBe('high')
    expect(tread.find((e) => e.serial === 'SN-TREAD-MED').severity).toBe('medium')

    // 3. High CPK — only the aged tyre (0.2/km) sits above the fleet p90; medium.
    const cpk = byCat('high_cpk')
    expect(cpk).toHaveLength(1)
    expect(cpk[0].serial).toBe('SN-AGED')
    expect(cpk[0].severity).toBe('medium')
    expect(cpk[0].cpk).toBeCloseTo(0.2, 4)

    // 4. Recent failure — removed tyre with a reason; the reason-less one is skipped.
    const fail = byCat('recent_failure')
    expect(fail).toHaveLength(1)
    expect(fail[0].serial).toBe('SN-FAIL')
    expect(fail[0].severity).toBe('medium')
    expect(fail[0].detail).toMatch(/Sidewall damage/)

    // 5. Open high-priority work orders — the two open+urgent ones only.
    const wo = byCat('open_work_order')
    expect(wo).toHaveLength(2)
    expect(wo.every((e) => e.severity === 'high')).toBe(true)
    expect(wo.every((e) => e.link === '/work-orders')).toBe(true)
    expect(wo.map((e) => e.id).sort()).toEqual(['wo:WO-100', 'wo:WO-101'])
  })

  it('is deterministic and sorted most-severe first', () => {
    const a = buildExceptions({ tyres, workOrders }, { now: NOW })
    const b = buildExceptions({ tyres, workOrders }, { now: NOW })
    expect(a).toEqual(b)
    const ranks = a.map((e) => (e.severity === 'high' ? 3 : e.severity === 'medium' ? 2 : 1))
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1])
    }
  })

  it('ignores removed tyres for in-service categories', () => {
    const ex = buildExceptions({ tyres, workOrders }, { now: NOW })
    // The removed low-tread tyre (t6, 1mm) must NOT appear as a low_tread exception.
    expect(ex.some((e) => e.category === 'low_tread' && e.serial === 'SN-FAIL')).toBe(false)
  })

  it('returns an empty feed for empty input', () => {
    expect(buildExceptions({ tyres: [], workOrders: [] }, { now: NOW })).toEqual([])
    expect(buildExceptions({}, { now: NOW })).toEqual([])
  })
})

describe('summarizeExceptions', () => {
  it('counts by severity and category with a stable shape', () => {
    const ex = buildExceptions({ tyres, workOrders }, { now: NOW })
    const s = summarizeExceptions(ex)

    expect(s.total).toBe(ex.length)
    expect(s.bySeverity.high + s.bySeverity.medium + s.bySeverity.low).toBe(s.total)

    // Category counts must sum to the total and cover the full vocabulary.
    const catSum = CATEGORIES.reduce((acc, c) => acc + s.byCategory[c], 0)
    expect(catSum).toBe(s.total)
    expect(Object.keys(s.byCategory).sort()).toEqual([...CATEGORIES].sort())

    // Concrete expectations from the fixture:
    //   high  = aged(1) + tread-hi(1) + 2 work orders = 4
    //   medium= tread-med(1) + high-cpk(1) + failure(1) = 3
    expect(s.bySeverity.high).toBe(4)
    expect(s.bySeverity.medium).toBe(3)
    expect(s.bySeverity.low).toBe(0)
    expect(s.affectedAssets).toBeGreaterThan(0)
  })

  it('handles empty and non-array input', () => {
    expect(summarizeExceptions([]).total).toBe(0)
    expect(summarizeExceptions(undefined).total).toBe(0)
  })
})
