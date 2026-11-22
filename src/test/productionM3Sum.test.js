import { describe, it, expect } from 'vitest'
import { sumMonthlyM3 } from '../lib/api/production'

const months = [
  { month: '2026-10', supplied_m3: 120.5, sites: [{ site: 'NHC', supplied_m3: 100 }, { site: 'RUMAH', supplied_m3: 20.5 }] },
  { month: '2026-09', supplied_m3: 80, sites: [{ site: ' nhc ', supplied_m3: 80 }] },
]

describe('sumMonthlyM3', () => {
  it('totals every month when no site is chosen', () => {
    expect(sumMonthlyM3(months)).toBe(200.5)
    expect(sumMonthlyM3(months, 'All')).toBe(200.5)
  })
  it('totals one site, trimmed and case-insensitive', () => {
    expect(sumMonthlyM3(months, 'NHC')).toBe(180)
    expect(sumMonthlyM3(months, 'RUMAH')).toBe(20.5)
  })
  it('is zero for an unknown site or no data', () => {
    expect(sumMonthlyM3(months, 'NOWHERE')).toBe(0)
    expect(sumMonthlyM3([])).toBe(0)
    expect(sumMonthlyM3(null)).toBe(0)
  })
})
