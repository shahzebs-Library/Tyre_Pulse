import { describe, it, expect } from 'vitest'
import {
  mtkpis, taskChart, actionChart, workTypeSpendChart, siteSpendChart,
  assetSpendChart, monthlySpendChart, buildMaintenanceRecommendations, monthLabel,
} from '../lib/maintenanceBoard'

const FIXTURE = {
  ok: true,
  generated_at: '2026-07-22T00:00:00Z',
  kpis: { job_cards: 59446, line_items: 144895, total_spend: 35060742, avg_job_cost: 589.8, tyre_lines: 22000, open_jobs: 143 },
  top_tasks: [
    { label: 'Engine Oil-Oil filter', n: 7766 },
    { label: 'Brake pads', n: 3120 },
  ],
  top_actions: [
    { label: 'Replaced', n: 5000 },
    { label: 'Adjusted', n: 1200 },
  ],
  by_work_type: [
    { label: 'Repair', jobs: 30000, spend: 26960211 },
    { label: 'Preventive Maintenance', jobs: 12000, spend: 4990397 },
    { label: 'Tyre Change', jobs: 8000, spend: 1973133 },
    { label: 'Service', jobs: 4000, spend: 1137001 },
  ],
  spend_by_site: [
    { label: 'NHC', jobs: 12000, spend: 9000000 },
    { label: 'RED SEA', jobs: 8000, spend: 6000000 },
  ],
  spend_by_asset: [
    { label: 'TRK-001', jobs: 120, spend: 250000 },
  ],
  monthly_spend: [
    { m: '2026-06', spend: 2900000 },
    { m: '2026-07', spend: 3100000 },
  ],
}

const EMPTY = { ok: false }

describe('maintenanceBoard shapers', () => {
  it('normalizes KPIs, null-safe', () => {
    const k = mtkpis(FIXTURE)
    expect(k.jobCards).toBe(59446)
    expect(k.lineItems).toBe(144895)
    expect(k.totalSpend).toBe(35060742)
    expect(k.tyreLines).toBe(22000)
    expect(k.openJobs).toBe(143)
  })

  it('KPIs are null for an empty snapshot', () => {
    const k = mtkpis(EMPTY)
    expect(k.jobCards).toBeNull()
    expect(k.totalSpend).toBeNull()
    expect(k.openJobs).toBeNull()
  })

  it('taskChart shape', () => {
    const c = taskChart(FIXTURE)
    expect(c.labels).toEqual(['Engine Oil-Oil filter', 'Brake pads'])
    expect(c.datasets[0].label).toBe('Occurrences')
    expect(c.datasets[0].data).toEqual([7766, 3120])
  })

  it('actionChart shape', () => {
    const c = actionChart(FIXTURE)
    expect(c.labels).toEqual(['Replaced', 'Adjusted'])
    expect(c.datasets[0].data).toEqual([5000, 1200])
  })

  it('workTypeSpendChart uses spend', () => {
    const c = workTypeSpendChart(FIXTURE)
    expect(c.labels[0]).toBe('Repair')
    expect(c.datasets[0].data).toEqual([26960211, 4990397, 1973133, 1137001])
  })

  it('siteSpendChart + assetSpendChart shapes', () => {
    expect(siteSpendChart(FIXTURE).datasets[0].data).toEqual([9000000, 6000000])
    expect(assetSpendChart(FIXTURE).labels).toEqual(['TRK-001'])
  })

  it('monthlySpendChart labels as Mon YY', () => {
    const c = monthlySpendChart(FIXTURE)
    expect(c.labels).toEqual(['Jun 26', 'Jul 26'])
    expect(c.datasets[0].data).toEqual([2900000, 3100000])
  })

  it('monthLabel passes through non date keys', () => {
    expect(monthLabel('Total')).toBe('Total')
    expect(monthLabel('2026-01')).toBe('Jan 26')
  })

  it('empty snapshot yields empty charts', () => {
    for (const fn of [taskChart, actionChart, workTypeSpendChart, siteSpendChart, assetSpendChart, monthlySpendChart]) {
      const c = fn(EMPTY)
      expect(c.labels).toEqual([])
      expect(c.datasets[0].data).toEqual([])
    }
  })

  it('missing arrays never throw', () => {
    const partial = { ok: true, kpis: {} }
    expect(taskChart(partial).labels).toEqual([])
    expect(mtkpis(partial).jobCards).toBeNull()
  })

  it('builds honest recommendations from the data', () => {
    const recs = buildMaintenanceRecommendations(FIXTURE)
    expect(Array.isArray(recs)).toBe(true)
    // Repair is 26.96M / ~35.06M = 77% -> a high repair-share rec.
    expect(recs.some((r) => /Repairs are \d+%/.test(r.text) && r.level === 'high')).toBe(true)
    // 143 open jobs -> an open-jobs rec.
    expect(recs.some((r) => /job card\(s\) are still open/.test(r.text))).toBe(true)
    expect(recs.length).toBeLessThanOrEqual(6)
  })

  it('empty snapshot yields no recommendations', () => {
    expect(buildMaintenanceRecommendations(EMPTY)).toEqual([])
    expect(buildMaintenanceRecommendations(null)).toEqual([])
  })
})
