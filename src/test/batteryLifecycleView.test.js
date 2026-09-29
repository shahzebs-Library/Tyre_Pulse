import { describe, it, expect } from 'vitest'
import { enrichBatteries } from '../lib/batteriesAnalytics'
import {
  ageYears, ageMonths, replacementDate, isReplacementDue, lifecycleKpis, healthDistribution,
  replacementForecast, lifecycleStages, filterRegister, siteOptions, warrantyText, healthTone,
  statusView, EXPECTED_LIFE_MONTHS,
} from '../lib/batteryLifecycleView'

const NOW = Date.UTC(2026, 8, 15) // 15 Sep 2026

const rows = [
  { id: 1, serial_no: 'A', asset_no: 'TM1', status: 'healthy', health_pct: 95, install_date: '2025-01-10', warranty_months: 36, site: 'NHC' },
  { id: 2, serial_no: 'B', asset_no: 'TM2', status: 'weak', health_pct: 60, install_date: '2023-12-01', warranty_months: 24, site: 'JED' },
  { id: 3, serial_no: 'C', asset_no: 'TM3', status: 'replace', health_pct: 30, install_date: '2024-06-01', warranty_months: 12, site: 'NHC' },
  { id: 4, serial_no: 'D', asset_no: 'TM4', status: 'retired', health_pct: null, install_date: '2020-01-01', warranty_months: 12 },
  { id: 5, serial_no: 'E', asset_no: 'TM5', status: 'healthy', health_pct: 80, install_date: null, warranty_months: null },
  { id: 6, serial_no: 'F', asset_no: 'TM6', status: 'healthy', health_pct: null, install_date: '2023-06-01' },
]
const enriched = enrichBatteries(rows, NOW)

describe('age helpers', () => {
  it('computes age and handles missing dates', () => {
    expect(ageYears('2025-09-15', NOW)).toBe(1)
    expect(ageYears(null, NOW)).toBeNull()
    expect(ageMonths('2025-01-10', NOW)).toBe(20)
    expect(ageMonths('bad', NOW)).toBeNull()
  })
  it('adds the expected life to the install date', () => {
    expect(replacementDate('2024-01-31').toISOString().slice(0, 10)).toBe(`2027-01-31`)
    expect(replacementDate(null)).toBeNull()
    expect(EXPECTED_LIFE_MONTHS).toBe(36)
  })
})

describe('isReplacementDue', () => {
  it('is due when marked replace or past expected life, never when retired', () => {
    expect(isReplacementDue(enriched[2], NOW)).toBe(true)
    expect(isReplacementDue(enriched[5], NOW)).toBe(true) // 2023-06 + 36 = 2026-06
    expect(isReplacementDue(enriched[0], NOW)).toBe(false)
    expect(isReplacementDue(enriched[3], NOW)).toBe(false)
  })
})

describe('lifecycleKpis', () => {
  it('counts honestly and averages measured health only', () => {
    const k = lifecycleKpis(enriched, NOW)
    expect(k.total).toBe(6)
    expect(k.active).toBe(5)
    expect(k.lowHealth).toBe(1)
    expect(k.replacementsDue).toBe(2)
    expect(k.avgHealth).toBe(66.3) // (95+60+30+80)/4
    expect(k.measured).toBe(4)
  })
  it('returns null average on an empty register', () => {
    const k = lifecycleKpis([], NOW)
    expect(k.total).toBe(0)
    expect(k.avgHealth).toBeNull()
  })
})

describe('healthDistribution', () => {
  it('buckets measured batteries and reports not measured apart', () => {
    const d = healthDistribution(enriched)
    const by = Object.fromEntries(d.segments.map((s) => [s.key, s.count]))
    expect(by).toEqual({ excellent: 1, good: 1, fair: 1, poor: 1 })
    expect(d.notMeasured).toBe(2)
    expect(d.avg).toBe(66)
  })
})

describe('replacementForecast', () => {
  it('places batteries by expected life month and separates due now and unforecastable', () => {
    const f = replacementForecast(enriched, NOW)
    expect(f.buckets).toHaveLength(12)
    expect(f.buckets[0].label).toBe('Sep')
    expect(f.dueNow).toBe(2)
    expect(f.unforecastable).toBe(1)
    // TM2 2023-12 + 36 = 2026-12 -> index 3; TM1 2025-01 + 36 = 2028-01 -> out of window
    expect(f.buckets[3].count).toBe(1)
    expect(f.total).toBe(1)
  })
})

describe('lifecycleStages', () => {
  it('reports overlapping stages with shares of the register', () => {
    const s = Object.fromEntries(lifecycleStages(enriched, NOW).map((x) => [x.key, x.count]))
    expect(s.in_service).toBe(5)
    expect(s.due).toBe(2)
    expect(s.retired).toBe(1)
    expect(s.aging).toBe(1) // weak TM2
    expect(lifecycleStages([], NOW)[0].pct).toBeNull()
  })
})

describe('register helpers', () => {
  it('filters by site on top of the shared filters', () => {
    expect(filterRegister(enriched, { site: 'NHC' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterRegister(enriched, { site: 'NHC', status: 'replace' }).map((r) => r.id)).toEqual([3])
    expect(siteOptions(rows)).toEqual(['JED', 'NHC'])
  })
  it('formats warranty, health and status honestly', () => {
    expect(warrantyText({ key: 'unknown' }).text).toBe('Not recorded')
    expect(warrantyText({ key: 'expired', daysLeft: -3 }).tone).toBe('bad')
    expect(warrantyText({ key: 'active', daysLeft: 730 }).text).toBe('Valid (2 yrs)')
    expect(warrantyText({ key: 'soon', daysLeft: 40 }).text).toBe('Valid (40 days)')
    expect(healthTone(null)).toBe('muted')
    expect(healthTone(92)).toBe('good')
    expect(healthTone(40)).toBe('bad')
    expect(statusView('replace').label).toBe('Needs replacement')
    expect(statusView('odd').tone).toBe('muted')
  })
})
