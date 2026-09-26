import { describe, it, expect } from 'vitest'
import { analyzeClaims, claimNet } from '../lib/claimsAnalytics'
import {
  todayIso, claimState, liabilityText, filterClaimRows, claimFilterOptions, claimTableRows,
  CLAIM_SORT_ACCESSORS, sortRows, delayedInsurerRows, claimExportRows, CLAIM_EXPORT_KEYS,
  CLAIM_EXPORT_HEADERS, monthLabel,
} from '../lib/claimsSummaryAnalytics'

const TODAY = '2026-09-26'
const ROWS = [
  { id: 1, incident_date: '2026-08-01', asset_no: 'TM1', site: 'NHC', insurer: 'Walaa', policy_no: 'P1', claim_amount: 1000, claim_approved_amount: 800, recovered_amount: 800, release_date: '2026-08-20', repair_cost: 1200, parts_cost: 100, gcc_liability_ratio: 0 },
  { id: 2, incident_date: '2026-09-01', asset_no: 'TM2', site: 'JED', insurer: 'GGCI', claim_amount: 5000, expected_release_date: '2026-09-10', driver_name: 'Ali', repair_cost: 5000 },
  { id: 3, incident_date: '2026-09-20', asset_no: 'TM3', site: 'NHC', insurer: 'Walaa', claim_status: 'submitted', expected_release_date: '2026-10-10' },
  { id: 4, incident_date: '2026-09-21', asset_no: 'TM4', site: 'NHC' }, // no claim at all
]

describe('claimsSummaryAnalytics - state and filters', () => {
  it('todayIso honours an injected clock', () => {
    expect(todayIso('2026-01-05T10:00:00Z')).toBe('2026-01-05')
  })
  it('classifies Closed, Delayed and Open', () => {
    expect(claimState(ROWS[0], TODAY)).toBe('Closed')
    expect(claimState(ROWS[1], TODAY)).toBe('Delayed')
    expect(claimState(ROWS[2], TODAY)).toBe('Open')
  })
  it('liability text is null when never recorded, never 0%', () => {
    expect(liabilityText(null)).toBeNull()
    expect(liabilityText('')).toBeNull()
    expect(liabilityText(0)).toBe('0%')
  })
  it('filters by window, insurer, site, state and search', () => {
    expect(filterClaimRows(ROWS, { from: '2026-09-01' }, TODAY).map((r) => r.id)).toEqual([2, 3, 4])
    expect(filterClaimRows(ROWS, { insurer: 'Walaa' }, TODAY).map((r) => r.id)).toEqual([1, 3])
    expect(filterClaimRows(ROWS, { site: 'JED' }, TODAY).map((r) => r.id)).toEqual([2])
    expect(filterClaimRows(ROWS, { state: 'delayed' }, TODAY).map((r) => r.id)).toEqual([2])
    expect(filterClaimRows(ROWS, { state: 'closed' }, TODAY).map((r) => r.id)).toEqual([1])
    expect(filterClaimRows(ROWS, { search: 'ali' }, TODAY).map((r) => r.id)).toEqual([2])
    expect(filterClaimRows(ROWS, { search: 'p1' }, TODAY).map((r) => r.id)).toEqual([1])
  })
  it('filter options come only from rows that carry a claim', () => {
    expect(claimFilterOptions(ROWS)).toEqual({ insurers: ['GGCI', 'Walaa'], sites: ['JED', 'NHC'] })
  })
})

describe('claimsSummaryAnalytics - table rows, sorting and export', () => {
  const a = analyzeClaims(ROWS, { now: TODAY })
  const rows = claimTableRows(a.claims, TODAY)
  it('table rows carry state, net (claimNet) and overdue days', () => {
    const r2 = rows.find((r) => r.id === 2)
    expect(r2._state).toBe('Delayed')
    expect(r2._overdue).toBe(16)
    expect(r2._net).toBe(claimNet(ROWS[1]))
    expect(rows.find((r) => r.id === 3)._overdue).toBeNull()
    expect(rows.find((r) => r.id === 3)._claimed).toBeNull()
  })
  it('sorts claimed amount with missing amounts last', () => {
    const desc = sortRows(rows, { key: 'claimed', dir: 'desc' }, CLAIM_SORT_ACCESSORS).map((r) => r.id)
    expect(desc).toEqual([2, 1, 3])
    const asc = sortRows(rows, { key: 'claimed', dir: 'asc' }, CLAIM_SORT_ACCESSORS).map((r) => r.id)
    expect(asc).toEqual([1, 2, 3])
  })
  it('state sorts delayed first', () => {
    expect(sortRows(rows, { key: 'state', dir: 'asc' }, CLAIM_SORT_ACCESSORS)[0].id).toBe(2)
  })
  it('export rows use every column and the single net definition', () => {
    expect(CLAIM_EXPORT_HEADERS).toHaveLength(CLAIM_EXPORT_KEYS.length)
    const out = claimExportRows(rows)
    expect(Object.keys(out[0]).sort()).toEqual([...CLAIM_EXPORT_KEYS].sort())
    const first = out.find((r) => r.asset_no === 'TM1')
    expect(first.net_cost).toBe(claimNet(ROWS[0]))
    expect(first.gcc_liability_ratio).toBe('0%')
    expect(out.find((r) => r.asset_no === 'TM3').expected_release_date).toBe('2026-10-10')
  })
  it('delayed insurer rows add a share of value at risk, null when none', () => {
    const shared = delayedInsurerRows({ valueAtRisk: 200, byInsurer: [{ label: 'X', count: 1, value: 50 }] })
    expect(shared[0].share).toBe(25)
    expect(delayedInsurerRows({ valueAtRisk: 0, byInsurer: [{ label: 'X', count: 1, value: 0 }] })[0].share).toBeNull()
    expect(delayedInsurerRows(null)).toEqual([])
  })
  it('monthLabel formats a YYYY-MM key', () => {
    expect(monthLabel('2026-03')).toBe('Mar 26')
  })
})
