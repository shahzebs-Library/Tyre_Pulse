import { describe, it, expect } from 'vitest'
import {
  daysBetween, recallMatchesSearch, sortRecallsNewestFirst, buildAffectedIndex,
  distinctAffected, registryRows, detectBatchFailures, brandRecallHistory,
  recallBreakdowns, avgDaysToClose, responseRate,
} from '../lib/recallTrackerAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')

const recalls = [
  { id: 'a', recall_number: 'RCL-1', brand: 'Michelin', affected_sizes: ['315/80R22.5'], issue_date: '2026-09-01', severity: 'Critical', status: 'Active', source: 'Manufacturer', description: 'Bead failure' },
  { id: 'b', recall_number: 'RCL-2', brand: 'Bridgestone', affected_sizes: [], issue_date: '2026-06-01', closed_at: '2026-06-11', severity: 'Low', status: 'Closed', source: 'Internal' },
  { id: 'c', recall_number: 'RCL-3', brand: '', affected_sizes: [], issue_date: null, severity: 'High', status: 'Active', source: null },
]

const tyres = [
  { id: 1, brand: 'MICHELIN ', size: '315/80r22.5', serial_number: 'MH23AAA', risk_level: 'High' },
  { id: 2, brand: 'Michelin', size: '385/65R22.5', serial_number: 'MH23BBB', risk_level: null },
  { id: 3, brand: 'Bridgestone', size: '315/80R22.5', serial_number: 'BS11CCC', km_at_removal: 5000 },
  { id: 4, brand: '', size: '315/80R22.5', serial_number: 'XX' },
]

describe('recallTrackerAnalytics', () => {
  it('daysBetween is null on a missing end, not zero', () => {
    expect(daysBetween('2026-06-01', '2026-06-11')).toBe(10)
    expect(daysBetween(null, '2026-06-11')).toBeNull()
    expect(daysBetween('bad', '2026-06-11')).toBeNull()
  })

  it('search covers number, brand, description and sizes', () => {
    expect(recallMatchesSearch(recalls[0], 'rcl-1')).toBe(true)
    expect(recallMatchesSearch(recalls[0], 'bead')).toBe(true)
    expect(recallMatchesSearch(recalls[0], '315/80')).toBe(true)
    expect(recallMatchesSearch(recalls[0], 'nope')).toBe(false)
    expect(recallMatchesSearch(recalls[0], '  ')).toBe(true)
  })

  it('sorts newest first with undated recalls last', () => {
    expect(sortRecallsNewestFirst(recalls).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('matches each recall once and never matches a blank brand', () => {
    const index = buildAffectedIndex(recalls, tyres)
    expect(index.get('a').map((t) => t.id)).toEqual([1])
    expect(index.get('b').map((t) => t.id)).toEqual([3])
    expect(index.get('c')).toEqual([])
    expect(distinctAffected(recalls, index)).toBe(2)
  })

  it('registry rows carry affected, fitted and days open', () => {
    const index = buildAffectedIndex(recalls, tyres)
    const rows = registryRows(recalls, index, NOW)
    const a = rows.find((r) => r.id === 'a')
    expect(a.affected).toBe(1)
    expect(a.affected_fitted).toBe(1)
    expect(a.days_open).toBe(26)
    const b = rows.find((r) => r.id === 'b')
    expect(b.affected_fitted).toBe(0)
    expect(b.days_open).toBe(10)
    expect(rows.find((r) => r.id === 'c').days_open).toBeNull()
  })

  it('batch detector judges only rated tyres and reports coverage', () => {
    const batch = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`, brand: 'Acme', serial_number: `AC99${i}`, risk_level: i < 3 ? 'Critical' : 'Low', site: 'NHC',
    }))
    const unrated = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, brand: 'Zed', serial_number: `ZZ00${i}` }))
    const res = detectBatchFailures([...batch, ...unrated])
    expect(res.total).toBe(14)
    expect(res.rated).toBe(6)
    expect(res.batches).toHaveLength(1)
    expect(res.batches[0]).toMatchObject({ brand: 'Acme', prefix: 'AC99', failed: 3, rated: 6, rate: 50, severity: 'Potential issue' })
  })

  it('an entirely unrated register flags nothing and says so via rated 0', () => {
    const res = detectBatchFailures([{ id: 1, brand: 'X', serial_number: 'ABCD1' }])
    expect(res).toEqual({ batches: [], rated: 0, total: 1 })
  })

  it('brand history scores and averages honestly', () => {
    const h = brandRecallHistory(recalls)
    const mich = h.find((b) => b.brand === 'Michelin')
    expect(mich).toMatchObject({ total: 1, active: 1, critical: 1, score: 85, avgDaysToClose: null })
    expect(h.find((b) => b.brand === 'Bridgestone').avgDaysToClose).toBe(10)
    expect(h.find((b) => b.brand === 'Unknown')).toBeTruthy()
  })

  it('breakdowns count severities, statuses, sources and months', () => {
    const b = recallBreakdowns(recalls)
    expect(b.severity).toEqual({ Critical: 1, High: 1, Medium: 0, Low: 1 })
    expect(b.status).toEqual({ Active: 2, Monitoring: 0, Closed: 1 })
    expect(b.source.Unrecorded).toBe(1)
    expect(b.months).toEqual(['2026-06', '2026-09'])
  })

  it('averages and rates are null on an empty base', () => {
    expect(avgDaysToClose([])).toBeNull()
    expect(avgDaysToClose(recalls)).toBe(10)
    const index = buildAffectedIndex(recalls, tyres)
    expect(responseRate([], index)).toBeNull()
    expect(responseRate(recalls.filter((r) => r.status === 'Active'), index)).toBe(50)
  })
})
