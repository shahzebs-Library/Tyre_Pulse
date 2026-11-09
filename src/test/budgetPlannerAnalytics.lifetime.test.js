import { describe, it, expect } from 'vitest'
import { normaliseRecords, averageCpk, monthlyActuals, recordsForYear, siteAllocation, brandAnalysis } from '../lib/budgetPlannerAnalytics'
import { threeVehicles, refitSameVehicle } from './lifetimeFixtures.groupB'

const tag = (rows) => rows.map((r) => ({ ...r, site: 'NHC', brand: 'X' }))

describe('budget planner on physical tyres', () => {
  it('one tyre on three vehicles: price once in spend, CPK over its lifetime km', () => {
    const rows = normaliseRecords(tag(threeVehicles()))
    const y = recordsForYear(rows, 2025)
    expect(monthlyActuals(y).reduce((s, v) => s + v, 0)).toBe(900)
    expect(averageCpk(y)).toBeCloseTo(900 / 80000, 10)
    expect(brandAnalysis(y, [])[0].cpk).toBeCloseTo(900 / 80000, 10)
  })
  it('a same-vehicle refit is not a second purchase', () => {
    const rows = normaliseRecords(tag(refitSameVehicle()))
    expect(monthlyActuals(rows).reduce((s, v) => s + v, 0)).toBe(800)
    expect(averageCpk(rows)).toBeCloseTo(800 / 40000, 10)
  })
  it('site allocation still counts fitment rows', () => {
    const rows = normaliseRecords(tag(threeVehicles()))
    const [s] = siteAllocation({ yearRows: rows, monthsElapsed: 12 })
    expect(s.fitments).toBe(3)
    expect(s.actual).toBe(900)
  })
})
