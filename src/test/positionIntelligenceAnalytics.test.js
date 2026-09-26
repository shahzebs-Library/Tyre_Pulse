import { describe, it, expect } from 'vitest'
import {
  positionGroup, removalClass, groupMetrics, positionCodeMetrics, siteGroupMatrix,
  brandsForGroup, assetsForGroup, monthlyRemovals, filterRecords, fleetPositionKpis,
  positionInsights, positionExportRows, POSITION_EXPORT_COLS, POSITION_EXPORT_HEADERS,
} from '../lib/positionIntelligenceAnalytics'

const rec = (o) => ({ asset_no: 'TM1', site: 'NHC', brand: 'TRIANGLE', qty: 1, ...o })

describe('positionGroup', () => {
  it('maps canonical, ERP dual-rear and field slot codes', () => {
    expect(positionGroup('LHF1')).toBe('Steer')
    expect(positionGroup('RHRO')).toBe('Drive')
    expect(positionGroup('LHRCO')).toBe('Drive')
    expect(positionGroup('RHRRI')).toBe('Drive')
    expect(positionGroup('F1L')).toBe('Steer')
    expect(positionGroup('R2Ri')).toBe('Drive')
    expect(positionGroup('')).toBe('Other')
    expect(positionGroup(null)).toBe('Other')
    expect(positionGroup('SPARE')).toBe('Other')
  })
})

describe('removalClass', () => {
  it('classifies by stem and ignores brands and import markers', () => {
    expect(removalClass('PUNCTURE')).toBe('failure')
    expect(removalClass('BLAST/BURST')).toBe('failure')
    expect(removalClass('THREAD SEPRATION')).toBe('failure')
    expect(removalClass('SIDE WALL DAMAGE')).toBe('failure')
    expect(removalClass('WORN OUT')).toBe('wear')
    expect(removalClass('MISUSE')).toBe('other')
    expect(removalClass('ROADX')).toBeNull()
    expect(removalClass('TWO CURRENT TYRES - MANUAL REVIEW')).toBeNull()
    expect(removalClass('')).toBeNull()
  })
})

describe('groupMetrics', () => {
  const rows = [
    rec({ position: 'LHF1', removal_date: '2026-01-10', removal_reason: 'PUNCTURE', km_at_fitment: 1000, km_at_removal: 41000, cost_per_tyre: 1000 }),
    rec({ position: 'RHF1', removal_date: '2026-02-10', removal_reason: 'WORN OUT', km_at_fitment: 1000, km_at_removal: 61000, cost_per_tyre: 1200 }),
    rec({ position: 'LHRO', removal_date: '2026-03-10', removal_reason: 'ROADX' }),
    rec({ position: 'LHRO' }),
  ]
  it('rates failures over reasoned removals only', () => {
    const g = groupMetrics(rows)
    const steer = g.find((x) => x.group === 'Steer')
    expect(steer.count).toBe(2)
    expect(steer.withReason).toBe(2)
    expect(steer.failureRatePct).toBe(50)
    expect(steer.avgLifeKm).toBe(50000)
    expect(steer.avgCpk).toBeCloseTo((1000 / 40000 + 1200 / 60000) / 2)
  })
  it('returns null, not 0, when nothing is measurable', () => {
    const drive = groupMetrics(rows).find((x) => x.group === 'Drive')
    expect(drive.failureRatePct).toBeNull()
    expect(drive.avgLifeKm).toBeNull()
    expect(drive.avgCpk).toBeNull()
    expect(drive.recordedPrice).toBeNull()
    expect(drive.removed).toBe(1)
  })
  it('handles empty input', () => {
    expect(groupMetrics([])).toEqual([])
    const k = fleetPositionKpis([])
    expect(k.failureRatePct).toBeNull()
    expect(k.positionCoveragePct).toBeNull()
    expect(k.worstGroup).toBeNull()
  })
})

describe('position and matrix views', () => {
  const rows = [
    rec({ position: 'lhf1', removal_reason: 'PUNCTURE', removal_date: '2026-05-02' }),
    rec({ position: 'LHF1', removal_reason: 'WORN OUT', removal_date: '2026-05-20', site: 'JED' }),
    rec({ position: 'RHRO', removal_reason: 'DAMAGED', removal_date: '2025-01-01', brand: 'PIRELLI', asset_no: 'TM2' }),
  ]
  it('groups codes canonically', () => {
    const codes = positionCodeMetrics(rows)
    expect(codes.map((c) => c.code)).toContain('LHF1')
    expect(codes.find((c) => c.code === 'LHF1').count).toBe(2)
  })
  it('builds a site by group matrix with null cells', () => {
    const m = siteGroupMatrix(rows)
    expect(m.groups).toEqual(['Steer', 'Drive'])
    const jed = m.rows.find((r) => r.site === 'JED')
    expect(jed.Drive).toBeNull()
    expect(jed.Steer.failureRatePct).toBe(0)
  })
  it('ranks brands and assets', () => {
    expect(brandsForGroup(rows, 'Drive')[0].brand).toBe('PIRELLI')
    expect(assetsForGroup(rows, '')[0].failures).toBeGreaterThan(0)
  })
  it('buckets removals into months relative to now', () => {
    const t = monthlyRemovals(rows, { now: new Date(2026, 5, 15).getTime(), months: 3 })
    expect(t.months).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(t.series.find((s) => s.group === 'Steer').data).toEqual([0, 2, 0])
    expect(t.failures).toEqual([0, 1, 0])
  })
  it('filters by group, site, dates and search', () => {
    const withDates = rows.map((r, i) => ({ ...r, issue_date: `2026-0${i + 1}-01` }))
    expect(filterRecords(withDates, { group: 'Drive' })).toHaveLength(1)
    expect(filterRecords(withDates, { site: 'JED' })).toHaveLength(1)
    expect(filterRecords(withDates, { from: '2026-02-01' })).toHaveLength(2)
    expect(filterRecords(withDates, { search: 'tm2' })).toHaveLength(1)
  })
  it('exports aligned columns with N/A for unmeasured', () => {
    const out = positionExportRows(rows)
    expect(POSITION_EXPORT_COLS).toHaveLength(POSITION_EXPORT_HEADERS.length)
    expect(out.find((r) => r.code === 'RHRO').avgLifeKm).toBe('N/A')
  })
})

describe('positionInsights', () => {
  it('flags thin reason coverage and never uses a dash', () => {
    const rows = Array.from({ length: 12 }, (_, i) => rec({ position: 'LHF1', removal_date: '2026-01-01', removal_reason: i < 2 ? 'PUNCTURE' : null }))
    const out = positionInsights(rows)
    expect(out.some((o) => /usable reason/.test(o.message))).toBe(true)
    for (const o of out) expect(o.message).not.toMatch(/[–—]/)
  })
})
