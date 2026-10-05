import { describe, it, expect } from 'vitest'
import {
  previousWindow, pctChange, pointChange, overviewKpis, assetTypeRows, rateBars,
  overviewDrivers, lineageFacts, fmtCompact, fmtRate, fmtSignedPct,
} from '../lib/cpkOverviewView'

const fleet = (cpkTyre, cpkTotal, km, cov, cph) => ({
  country: 'KSA', currency: 'SAR',
  km: { total_cost_matched: 100, total_km: km, tyre_cost_matched: 50, cpk_tyre: cpkTyre, cpk_total: cpkTotal, coverage_pct: cov, unregistered_cost: 0 },
  hours: { total_cost_matched: 10, total_hours: 5, cpk_total: cph, coverage_pct: 20 },
})

describe('cpkOverviewView', () => {
  it('previousWindow is the same length immediately before', () => {
    expect(previousWindow('2026-10-01', '2026-10-05')).toEqual({ from: '2026-09-26', to: '2026-09-30', days: 5 })
    expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28', days: 31 })
    expect(previousWindow('bad', '2026-01-01')).toBeNull()
    expect(previousWindow('2026-02-01', '2026-01-01')).toBeNull()
  })

  it('pctChange / pointChange never invent a trend', () => {
    expect(pctChange(110, 100)).toBe(10)
    expect(pctChange(90, 100)).toBe(-10)
    expect(pctChange(5, 0)).toBeNull()
    expect(pctChange(null, 5)).toBeNull()
    expect(pctChange(5, null)).toBeNull()
    expect(pointChange(86, 79)).toBe(7)
    expect(pointChange(86, null)).toBeNull()
  })

  it('overviewKpis reads the movable and hour sides and trends against prev', () => {
    const k = overviewKpis(fleet(0.2, 0.5, 1000, 80, 18), fleet(0.25, 0.4, 800, 70, 20))
    expect(k.currency).toBe('SAR')
    expect(k.cpkTyre).toEqual({ value: 0.2, trend: -20 })
    expect(k.cpkTotal).toEqual({ value: 0.5, trend: 25 })
    expect(k.distance).toEqual({ value: 1000, trend: 25 })
    expect(k.coverage).toEqual({ value: 80, trend: 10 })
    expect(k.cph).toEqual({ value: 18, trend: -10 })
    const none = overviewKpis(fleet(0.2, 0.5, 1000, 80, 18), null)
    expect(none.cpkTyre.trend).toBeNull()
    const empty = overviewKpis(null, null)
    expect(empty.cpkTyre.value).toBeNull()
    expect(empty.distance.value).toBeNull()
  })

  it('assetTypeRows counts units, measured cost coverage and orders movable first', () => {
    const byType = [
      { vehicle_type: 'GENERATOR', unit: 'engine_hours', distance_or_hours: 10, tyre_cost: 0, maintenance_cost: 5, total_cost: 5, cpk_tyre: null, cpk_total: 0.5 },
      { vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 100, tyre_cost: 60, maintenance_cost: 40, total_cost: 100, cpk_tyre: 0.6, cpk_total: 1 },
    ]
    const pv = [
      { vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 100, total_cost: 75 },
      { vehicle_type: 'tr-mixer ', unit: 'km', distance_or_hours: 0, total_cost: 25 },
      { vehicle_type: 'GENERATOR', unit: 'engine_hours', distance_or_hours: 10, total_cost: 5 },
    ]
    const rows = assetTypeRows(byType, pv)
    expect(rows.map((r) => r.vehicle_type)).toEqual(['TR-MIXER', 'GENERATOR'])
    expect(rows[0].units).toBe(2)
    expect(rows[0].measured).toBe(1)
    expect(rows[0].coverage).toBe(75)
    expect(rows[1].mobility).toBe('non_movable')
    expect(rows[1].coverage).toBe(100)
    expect(assetTypeRows([{ vehicle_type: 'X', unit: 'km', total_cost: 1 }], [])[0].units).toBeNull()
  })

  it('rateBars draws measured types only, worst first, and names the unmeasured', () => {
    const rows = [
      { key: 'a', vehicle_type: 'A', mobility: 'movable', cpk_total: 0.2 },
      { key: 'b', vehicle_type: 'B', mobility: 'movable', cpk_total: 0.4 },
      { key: 'c', vehicle_type: 'C', mobility: 'movable', cpk_total: null },
      { key: 'd', vehicle_type: 'D', mobility: 'non_movable', cpk_total: 9 },
    ]
    const r = rateBars(rows, 'movable', 1)
    expect(r.bars.map((b) => b.label)).toEqual(['B'])
    expect(r.bars[0].share).toBe(1)
    expect(r.hidden).toBe(1)
    expect(r.unmeasured).toEqual(['C'])
  })

  it('overviewDrivers returns percent-of-prior steps from the km segment', () => {
    const payload = {
      ok: true,
      windows: { current: { from: '2026-10-01', to: '2026-10-05' }, previous: { from: '2026-09-26', to: '2026-09-30' } },
      segments: [{ country: 'KSA', unit: 'km', currency: 'SAR', c0: 100, d0: 1000, c1: 120, d1: 1000, matched_prev: 10, matched_now: 10, causes: { price: 20 } }],
    }
    const w = overviewDrivers(payload)
    expect(w.ok).toBe(true)
    expect(w.comparable).toBe(true)
    expect(w.steps[0]).toMatchObject({ key: 'price', pct: 20 })
    expect(w.totalPct).toBe(20)
    expect(overviewDrivers({ ok: false }).ok).toBe(false)
    expect(overviewDrivers(null).steps).toEqual([])
  })

  it('lineageFacts states coverage and unregistered spend honestly', () => {
    const k = overviewKpis({ ...fleet(0.2, 0.5, 1000, 64, 1), km: { ...fleet(0, 0, 1000, 64, 1).km, unregistered_cost: 2500 } }, null)
    const facts = lineageFacts(k)
    expect(facts.join(' ')).toContain('64% of movable cost is covered')
    expect(facts.join(' ')).toContain('2,500 SAR')
    expect(lineageFacts(overviewKpis(null, null))[0]).toContain('not available')
  })

  it('formatters', () => {
    expect(fmtCompact(1050000)).toBe('1.05M')
    expect(fmtCompact(92400)).toBe('92.4k')
    expect(fmtCompact(121000)).toBe('121k')
    expect(fmtCompact(null)).toBe('N/A')
    expect(fmtRate(0.2346)).toBe('0.235')
    expect(fmtRate(18.4)).toBe('18.40')
    expect(fmtRate(null)).toBe('N/A')
    expect(fmtSignedPct(6)).toBe('+6%')
    expect(fmtSignedPct(-3)).toBe('-3%')
    expect(fmtSignedPct(null)).toBe('N/A')
  })
})
