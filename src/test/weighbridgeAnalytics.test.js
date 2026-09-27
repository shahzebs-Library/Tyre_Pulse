import { describe, it, expect } from 'vitest'
import {
  filterTickets, weighbridgeKpis, assetLoadProfile, monthlyTonnage, weighbridgeExportRows, isJudgeable, loadPct, NO_STATUS,
} from '../lib/weighbridgeAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'T1', gross_weight_kg: 20000, tare_weight_kg: 8000, gross_limit_kg: 18000, weighed_at: '2026-09-20T08:00:00Z', status: 'overweight', site: 'Riyadh' },
  { id: 2, asset_no: 'T1', gross_weight_kg: 16000, tare_weight_kg: 8000, gross_limit_kg: 18000, weighed_at: '2026-09-21T08:00:00Z', status: 'cleared' },
  { id: 3, asset_no: 'T2', net_weight_kg: 5000, weighed_at: '2026-08-02T08:00:00Z' },
]

describe('weighbridgeAnalytics', () => {
  it('judges only tickets with a gross and a limit', () => {
    expect(isJudgeable(rows[0])).toBe(true)
    expect(isJudgeable(rows[2])).toBe(false)
    expect(loadPct(rows[0])).toBe(111.1)
    expect(loadPct(rows[2])).toBeNull()
  })

  it('overweight rate uses judgeable tickets as the denominator', () => {
    const k = weighbridgeKpis(rows, { now: NOW })
    expect(k.overweightCount).toBe(1)
    expect(k.judgeableTickets).toBe(2)
    expect(k.unjudgedTickets).toBe(1)
    expect(k.overweightRate).toBe(50)
    expect(k.avgNetKg).toBe(8333)
    expect(k.avgOverloadKg).toBe(2000)
    expect(k.maxOverloadKg).toBe(2000)
    expect(k.last30Days).toBe(2)
  })

  it('empty register reads null, never 0', () => {
    const k = weighbridgeKpis([], { now: NOW })
    expect(k.overweightRate).toBeNull()
    expect(k.avgNetKg).toBeNull()
    expect(k.totalNetKg).toBeNull()
    expect(k.maxOverloadKg).toBeNull()
  })

  it('filters by load bucket, status and site', () => {
    expect(filterTickets(rows, { load: 'over' }).map((r) => r.id)).toEqual([1])
    expect(filterTickets(rows, { load: 'within' }).map((r) => r.id)).toEqual([2])
    expect(filterTickets(rows, { load: 'unknown' }).map((r) => r.id)).toEqual([3])
    expect(filterTickets(rows, { status: NO_STATUS }).map((r) => r.id)).toEqual([3])
    expect(filterTickets(rows, { site: 'Riyadh' }).map((r) => r.id)).toEqual([1])
  })

  it('asset profile, monthly tonnage and export blanks', () => {
    expect(assetLoadProfile(rows)[0]).toMatchObject({ asset: 'T1', tickets: 2, overweight: 1, overweightRate: 50, maxOverloadKg: 2000, avgNetKg: 10000 })
    expect(assetLoadProfile(rows)[1]).toMatchObject({ asset: 'T2', overweightRate: null, maxOverloadKg: null })
    const t = monthlyTonnage(rows, { now: NOW })
    expect(t[11]).toEqual({ month: '2026-09', netTonnes: 20, tickets: 2, overweight: 1 })
    expect(t[10].netTonnes).toBe(5)
    expect(weighbridgeExportRows([rows[2]])[0].overload_kg).toBe('')
    expect(weighbridgeExportRows([rows[1]])[0].overload_kg).toBe(0)
  })
})
