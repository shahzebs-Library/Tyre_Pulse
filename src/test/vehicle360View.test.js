import { describe, it, expect } from 'vitest'
import {
  normalizeTab, riskBand, fittedTyres, averageField, layoutStatus, diagramPositions, costSplit, tyreSpendYtd,
  costPerTyre, retreadCount, openWorkOrders, latestInspection, relativeDay, recentActivity, complianceLines,
} from '../lib/vehicle360View'

const NOW = Date.parse('2026-10-27T10:00:00Z')

describe('vehicle360View', () => {
  it('normalizeTab falls back to overview and accepts the More tabs', () => {
    expect(normalizeTab('tyres')).toBe('tyres')
    expect(normalizeTab('location')).toBe('location')
    expect(normalizeTab('nope')).toBe('overview')
    expect(normalizeTab(null)).toBe('overview')
  })

  it('riskBand never reads a missing level as normal', () => {
    expect(riskBand('Critical')).toBe('critical')
    expect(riskBand('High')).toBe('critical')
    expect(riskBand('Medium')).toBe('warning')
    expect(riskBand('Low')).toBe('normal')
    expect(riskBand(null)).toBe('unrated')
    expect(riskBand('')).toBe('unrated')
  })

  it('fittedTyres excludes removed rows', () => {
    const rows = [{ id: 1 }, { id: 2, removal_date: '2026-01-01' }, { id: 3, km_at_removal: 5000 }]
    expect(fittedTyres(rows).map((t) => t.id)).toEqual([1])
  })

  it('averageField is null when no row carries a positive value', () => {
    expect(averageField([{ tread_depth: null }, { tread_depth: 0 }], 'tread_depth')).toBeNull()
    const r = averageField([{ tread_depth: 4 }, { tread_depth: 6 }, {}], 'tread_depth')
    expect(r).toEqual({ value: 5, sample: 2 })
  })

  it('layoutStatus counts slots, unrated and empty wheels honestly', () => {
    const tyres = [
      { id: 1, position: 'LHF1', risk_level: 'Low' },
      { id: 2, position: 'RHF1', risk_level: 'High' },
      { id: 3, position: 'LHR1' },
    ]
    const s = layoutStatus('Pickup', tyres, 'PL001')
    expect(s.slots).toBe(4)
    expect(s.normal).toBe(1)
    expect(s.critical).toBe(1)
    expect(s.unrated).toBe(1)
    expect(s.notFitted).toBe(1)
    expect(s.normal + s.warning + s.critical + s.unrated + s.notFitted).toBe(4)
  })

  it('layoutStatus reports null slots for tyre-less equipment, not zero', () => {
    const s = layoutStatus('GENERATOR', [], 'GN001')
    expect(s.tyreless).toBe(true)
    expect(s.slots).toBeNull()
    expect(s.notFitted).toBeNull()
  })

  it('layoutStatus counts a position the layout does not have as unmapped', () => {
    const s = layoutStatus('Pickup', [{ id: 1, position: 'ZZ99' }], 'PL001')
    expect(s.unmapped).toBe(1)
    expect(s.notFitted).toBe(4)
  })

  it('diagramPositions maps canonical positions to slot ids', () => {
    const p = diagramPositions('Pickup', [{ position: 'LHF1', risk_level: 'High' }, { position: 'ZZ9' }])
    expect(p).toHaveLength(1)
    expect(p[0].risk_level).toBe('High')
  })

  it('costSplit keeps currencies apart and filters by period', () => {
    const lines = [
      { currency: 'SAR', event_date: '2026-03-01', tyre_cost: 100, spare_cost: 50, oil_cost: 10, line_cost: 170 },
      { currency: 'SAR', event_date: '2025-03-01', tyre_cost: 999, line_cost: 999 },
      { currency: 'AED', event_date: '2026-05-01', tyre_cost: 7, line_cost: 7 },
    ]
    const y = costSplit(lines, { period: 'year', now: NOW })
    expect(y).toHaveLength(2)
    expect(y.find((e) => e.currency === 'SAR')).toMatchObject({ tyre: 100, spare: 50, oil: 10, other: 10, total: 170 })
    expect(costSplit(lines, { period: 'all', now: NOW }).find((e) => e.currency === 'SAR').total).toBe(1169)
    // last 12 months from 2026-10-27 starts 2025-10-27, so the March 2025 line is out
    expect(costSplit(lines, { period: '12m', now: NOW }).find((e) => e.currency === 'SAR').total).toBe(170)
  })

  it('costSplit other never goes negative and an undated line is outside a bounded period', () => {
    const r = costSplit([{ currency: 'SAR', tyre_cost: 100, line_cost: 40 }, { currency: 'SAR', event_date: '2026-01-02', tyre_cost: 100, line_cost: 40 }], { period: 'year', now: NOW })
    expect(r[0].other).toBe(0)
    expect(r[0].lines).toBe(1)
  })

  it('tyreSpendYtd returns per-currency tyre spend only', () => {
    const r = tyreSpendYtd([{ currency: 'SAR', event_date: '2026-02-01', tyre_cost: 10, line_cost: 10 }], NOW)
    expect(r).toEqual([{ currency: 'SAR', amount: 10 }])
    expect(tyreSpendYtd([], NOW)).toEqual([])
  })

  it('costPerTyre skips unpriced tyres and is null with none priced', () => {
    expect(costPerTyre([{ cost_per_tyre: null }, {}])).toBeNull()
    expect(costPerTyre([{ cost_per_tyre: 100, qty: 2 }, { cost_per_tyre: 300 }])).toEqual({ value: 250, sample: 2 })
  })

  it('retreadCount matches the category word', () => {
    expect(retreadCount([{ category: 'Retread' }, { category: 'New' }, {}])).toBe(1)
  })

  it('openWorkOrders keeps open statuses, newest first', () => {
    const rows = [
      { id: 1, status: 'Open', opened_at: '2026-01-01' },
      { id: 2, status: 'Completed', opened_at: '2026-02-01' },
      { id: 3, status: 'In Progress', opened_at: '2026-03-01' },
    ]
    expect(openWorkOrders(rows).map((w) => w.id)).toEqual([3, 1])
  })

  it('latestInspection picks the newest day and is null when empty', () => {
    expect(latestInspection([])).toBeNull()
    const r = latestInspection([{ id: 1, inspection_date: '2026-01-01' }, { id: 2, completed_date: '2026-04-01' }])
    expect(r.id).toBe(2)
    expect(r.day).toBe('2026-04-01')
  })

  it('relativeDay words', () => {
    expect(relativeDay('2026-10-27', NOW)).toBe('Today')
    expect(relativeDay('2026-10-26', NOW)).toBe('Yesterday')
    expect(relativeDay('2026-10-20', NOW)).toBe('7 days ago')
    expect(relativeDay('2025-01-01', NOW)).toBe('2025-01-01')
    expect(relativeDay(null, NOW)).toBe('N/A')
  })

  it('recentActivity drops undated rows and limits', () => {
    const rows = [{ key: 'a', date: '' }, { key: 'b', date: '2026-01-01' }, { key: 'c', date: '2026-02-01' }]
    expect(recentActivity(rows, 1).map((r) => r.key)).toEqual(['c'])
  })

  it('complianceLines never reads a missing date as valid', () => {
    const l = complianceLines({ insurance_expiry: '2026-11-10', mvip_expiry: '2026-01-01' }, NOW)
    expect(l.find((x) => x.label.startsWith('Insurance'))).toMatchObject({ status: 'due-soon', days: 14 })
    expect(l.find((x) => x.label.startsWith('MVPI')).status).toBe('expired')
    expect(l.find((x) => x.label.startsWith('Operating')).status).toBe('unknown')
    expect(complianceLines(null, NOW).every((x) => x.status === 'unknown')).toBe(true)
  })
})
