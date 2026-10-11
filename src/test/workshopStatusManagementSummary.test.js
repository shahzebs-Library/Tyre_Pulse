import { describe, it, expect } from 'vitest'
import {
  AGE_BANDS, NOT_RECORDED, ageBandOf, buildManagementSummary, countBy, summaryRows,
} from '../lib/workshopStatus/managementSummary'

const NOW = new Date(2026, 9, 11, 10, 0, 0) // 2026-10-11 local

const active = [
  { asset_no: 'TM1', site: 'NHC', current_stage: 'Diagnosis', delay_reason: 'Waiting parts', ooc_since: '2026-10-10' }, // 1 day
  { asset_no: 'TM2', site: 'NHC', current_stage: 'Repair', delay_reason: 'Waiting parts', ooc_since: '2026-10-05' },    // 6
  { asset_no: 'TM3', site: 'JED', current_stage: '', delay_reason: null, ooc_since: '2026-09-01' },                     // 40
  { asset_no: 'TM4', site: null, current_stage: 'Repair', delay_reason: 'Manpower', ooc_since: null },                  // unknown
  { asset_no: 'TM5', site: 'JED', current_stage: 'Repair', excel_down_days: 10 },                                        // 10
]

const released = [
  { asset_no: 'R1', site: 'NHC', removed_at: '2026-10-10T08:00:00', final_disposition: 'repair_completed' },
  { asset_no: 'R2', site: 'JED', removed_at: '2026-10-01T08:00:00' },
  { asset_no: 'R3', site: 'JED', removed_at: '2026-08-01T08:00:00' },
  { asset_no: 'R4', site: 'NHC', removed_at: '2026-10-09T08:00:00', deleted_at: '2026-10-09T09:00:00' },
  { asset_no: 'R5', site: 'NHC', removed_at: '2026-10-09T08:00:00', archived_at: '2026-10-10T09:00:00' },
]

describe('ageBandOf', () => {
  it('bands whole days and sends null to unknown, never 0', () => {
    expect(ageBandOf(0)).toBe('0_3')
    expect(ageBandOf(3)).toBe('0_3')
    expect(ageBandOf(4)).toBe('4_7')
    expect(ageBandOf(14)).toBe('8_14')
    expect(ageBandOf(30)).toBe('15_30')
    expect(ageBandOf(31)).toBe('31_plus')
    expect(ageBandOf(null)).toBe('unknown')
    expect(ageBandOf(-2)).toBe('unknown')
  })
})

describe('countBy', () => {
  it('counts blanks under Not recorded and sorts by count', () => {
    const r = countBy(active, 'site')
    expect(r[0]).toEqual({ key: 'JED', count: 2 })
    expect(r.find((x) => x.key === NOT_RECORDED).count).toBe(1)
    expect(r.reduce((s, x) => s + x.count, 0)).toBe(active.length)
  })
})

describe('buildManagementSummary', () => {
  const s = buildManagementSummary({ active, released, now: NOW })

  it('breakdowns add up to the active total', () => {
    expect(s.active).toBe(5)
    for (const list of [s.bySite, s.byStage, s.byDelayReason, s.ageBands]) {
      expect(list.reduce((t, x) => t + x.count, 0)).toBe(5)
    }
  })

  it('bands days down honestly', () => {
    const band = Object.fromEntries(s.ageBands.map((b) => [b.key, b.count]))
    expect(band).toEqual({ '0_3': 1, '4_7': 1, '8_14': 1, '15_30': 0, '31_plus': 1, unknown: 1 })
    expect(s.ageBands).toHaveLength(AGE_BANDS.length + 1)
    expect(s.measured).toBe(4)
    expect(s.avgDaysDown).toBe(14.3)
    expect(s.longest).toEqual({ asset_no: 'TM3', days: 40 })
  })

  it('counts released in each window and never counts soft deleted rows', () => {
    const [w7, w30] = s.released
    expect(w7).toMatchObject({ days: 7, from: '2026-10-05', to: '2026-10-11', count: 2, withDisposition: 1 })
    expect(w30.count).toBe(3)
    expect(w30.bySite.find((x) => x.key === 'JED').count).toBe(1)
  })

  it('reports released as null (not 0) when the list could not be read', () => {
    expect(buildManagementSummary({ active, released: null, now: NOW }).released).toBeNull()
  })

  it('returns null averages for an empty workshop', () => {
    const e = buildManagementSummary({ active: [], released: [], now: NOW })
    expect(e.active).toBe(0)
    expect(e.avgDaysDown).toBeNull()
    expect(e.longest).toBeNull()
    expect(e.released[0].count).toBe(0)
  })
})

describe('summaryRows', () => {
  it('flattens to one ASCII table with every section', () => {
    const rows = summaryRows(buildManagementSummary({ active, released, now: NOW }))
    const sections = new Set(rows.map((r) => r.section))
    expect([...sections]).toEqual(expect.arrayContaining([
      'Overview', 'By site', 'By stage', 'By delay reason', 'Waiting age', 'Released last 7 days', 'Released last 30 days',
    ]))
    for (const r of rows) for (const v of Object.values(r)) expect(String(v)).toMatch(/^[\x00-\x7F]*$/)
  })

  it('states an empty workshop and an unreadable released list instead of hiding them', () => {
    const rows = summaryRows(buildManagementSummary({ active: [], released: null, now: NOW }))
    expect(rows.find((r) => r.section === 'By site').item).toBe('No vehicles')
    expect(rows.find((r) => r.section === 'Released').item).toMatch(/not available/)
    expect(summaryRows(null)).toEqual([])
  })
})
