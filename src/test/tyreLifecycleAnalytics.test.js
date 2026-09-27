import { describe, it, expect } from 'vitest'
import {
  kmRun, cpk, lifecycleStage, filterLifecycle, lifecycleKpis, stageFunnel,
  brandLife, costByCategory, kmBandCounts, lifecycleExportRows, distinct,
} from '../lib/tyreLifecycleAnalytics'

const rows = [
  { serial_number: 'S1', asset_no: 'TM1', brand: 'A', site: 'NHC', km_at_fitment: 1000, km_at_removal: 51000, cost_per_tyre: 1000, category: 'New', tread_depth: 2 },
  { serial_number: 'S2', asset_no: 'TM2', brand: 'A', site: 'JED', km_at_fitment: 0, km_at_removal: null, cost_per_tyre: 900 },
  { serial_number: 'S3', asset_no: 'TM3', brand: 'B', site: 'JED', km_at_fitment: 100, km_at_removal: 30100, cost_per_tyre: null, category: 'Retread', tread_depth: 5 },
  { serial_number: null, asset_no: 'TM4', brand: 'B', km_at_fitment: 10, km_at_removal: 5, category: 'Scrap' },
  { serial_number: 'S5', asset_no: 'TM5', brand: 'C', km_at_fitment: 0, km_at_removal: 20000, tread_depth: 4 },
]

describe('tyreLifecycleAnalytics', () => {
  it('measures km run and cost per km honestly', () => {
    expect(kmRun(rows[0])).toBe(50000)
    expect(kmRun(rows[1])).toBeNull()
    expect(kmRun(rows[3])).toBeNull() // reversed readings
    expect(cpk(rows[0])).toBeCloseTo(0.02)
    expect(cpk(rows[2])).toBeNull() // unpriced
  })

  it('assigns one exclusive stage per row', () => {
    expect(lifecycleStage(rows[0])).toBe('Removed')
    expect(lifecycleStage(rows[1])).toBe('In Service')
    expect(lifecycleStage(rows[2])).toBe('Retreaded')
    expect(lifecycleStage(rows[3])).toBe('Scrapped')
    expect(lifecycleStage(rows[4])).toBe('Retread Eligible')
    const f = stageFunnel(rows)
    expect(f.reduce((s, x) => s + x.count, 0)).toBe(rows.length)
  })

  it('filters by search, brand, category (blank reads as New) and stage', () => {
    expect(filterLifecycle(rows, { search: 'tm3' })).toHaveLength(1)
    expect(filterLifecycle(rows, { brand: 'A' })).toHaveLength(2)
    expect(filterLifecycle(rows, { category: 'New' })).toHaveLength(3)
    expect(filterLifecycle(rows, { stage: 'Scrapped' })).toHaveLength(1)
  })

  it('computes KPIs with honest nulls', () => {
    const k = lifecycleKpis(rows)
    expect(k.serials).toBe(4)
    expect(k.missingSerial).toBe(1)
    expect(k.measuredLife).toBe(3)
    expect(k.avgLifeKm).toBeCloseTo((50000 + 30000 + 20000) / 3)
    expect(k.retreadRate).toBeCloseTo((1 / 3) * 100)
    const empty = lifecycleKpis([])
    expect(empty.avgLifeKm).toBeNull()
    expect(empty.avgCpk).toBeNull()
    expect(empty.retreadRate).toBeNull()
    expect(empty.scrapRate).toBeNull()
  })

  it('stage average cost is null when nothing is priced', () => {
    const f = stageFunnel(rows)
    expect(f.find(s => s.stage === 'Retreaded').avgCost).toBeNull()
    expect(f.find(s => s.stage === 'In Service').avgCost).toBe(900)
  })

  it('groups brand life, priced spend and km bands', () => {
    const b = brandLife(rows)
    expect(b[0].brand).toBe('A')
    expect(b.find(x => x.brand === 'B').retreadAvg).toBe(30000)
    expect(costByCategory([{ category: 'New' }]).total).toBeNull()
    expect(costByCategory(rows).total).toBe(1900)
    const bands = kmBandCounts(rows)
    expect(bands.reduce((s, x) => s + x.count, 0)).toBe(3)
    expect(bands.find(x => x.label === '40-60k').count).toBe(1)
  })

  it('exports N/A and a real removal status, never the fitment date as removal', () => {
    const ex = lifecycleExportRows(rows)
    expect(ex[0].removal_date).toBe('Not recorded')
    expect(ex[1].removal_date).toBe('In service')
    expect(ex[2].cpk).toBe('N/A')
    expect(distinct(rows, 'site')).toEqual(['JED', 'NHC'])
  })
})
