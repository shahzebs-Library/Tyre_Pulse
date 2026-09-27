import { describe, it, expect } from 'vitest'
import {
  recordPrice, serialPrice, serialStats, serialTimeline, summarizeBulkSerial,
  bulkSummary, filterBulkResults, filterScrapList, scrapRegisterSummary,
} from '../lib/serialTrackerAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const recs = [
  { id: 1, asset_no: 'TM1', site: 'NHC', issue_date: '2026-01-10', cost_per_tyre: 900, brand: 'X', country: 'KSA' },
  { id: 2, asset_no: 'TM1', site: 'NHC', issue_date: '2026-03-10', cost_per_tyre: 900 },
  { id: 3, asset_no: 'TM2', site: 'JED', issue_date: '2026-06-01', removal_date: '2026-08-01', cost_per_tyre: null },
]

describe('price', () => {
  it('never sums repeated fitment rows and is null when unpriced', () => {
    expect(serialPrice(recs)).toBe(900)
    expect(serialPrice([{ cost_per_tyre: null }])).toBeNull()
    expect(recordPrice({ cost: '0' })).toBeNull()
    expect(recordPrice({ cost: '450' })).toBe(450)
  })
})

describe('serialStats', () => {
  it('measures span to the latest removal, active within 12 months', () => {
    const s = serialStats(recs, { now: NOW })
    expect(s.assets).toBe(2)
    expect(s.days).toBe(203)
    expect(s.active).toBe(true)
    expect(s.price).toBe(900)
    expect(s.pricedRecords).toBe(2)
  })
  it('days is null for a single undated span', () => {
    expect(serialStats([{ issue_date: '2026-01-01' }], { now: NOW }).days).toBeNull()
    expect(serialStats([], { now: NOW })).toBeNull()
  })
  it('old tyres are retired', () => {
    expect(serialStats([{ issue_date: '2024-01-01' }], { now: NOW }).active).toBe(false)
  })
})

describe('timeline + bulk', () => {
  it('groups consecutive assets', () => {
    expect(serialTimeline(recs).map((g) => g.asset)).toEqual(['TM1', 'TM2'])
  })
  it('bulk row: not found has null cost; scrapped wins', () => {
    expect(summarizeBulkSerial('A', [], { now: NOW }).cost).toBeNull()
    expect(summarizeBulkSerial('A', [{ issue_date: '2026-01-01', status: 'Scrapped' }], { now: NOW }).status).toBe('Scrapped')
    expect(summarizeBulkSerial('A', recs, { now: NOW })).toMatchObject({ status: 'Active', last_asset: 'TM2', cost: 900 })
  })
  it('summary + filters', () => {
    const rows = [
      { serial: 'A', status: 'Active', last_asset: 'TM1', cost: 1 },
      { serial: 'B', status: 'Not Found', cost: null },
    ]
    expect(bulkSummary(rows)).toMatchObject({ total: 1, notFound: 1, priced: 1 })
    expect(bulkSummary([])).toBeNull()
    expect(filterBulkResults(rows, { status: 'Active' })).toHaveLength(1)
    expect(filterBulkResults(rows, { query: 'tm1' })).toHaveLength(1)
  })
})

describe('scrap register', () => {
  const list = [
    { serial: 'S1', reason: 'worn', created_at: '2026-09-20', marked: true, asset_no: 'TM9' },
    { serial: 'S2', reason: null, created_at: '2026-01-01', marked: false },
  ]
  it('summarises honestly', () => {
    expect(scrapRegisterSummary(list, { now: NOW })).toMatchObject({ total: 2, withReason: 1, unattributed: 1, last30: 1, reasonRate: 0.5 })
    expect(scrapRegisterSummary([], { now: NOW }).reasonRate).toBeNull()
  })
  it('filters', () => {
    expect(filterScrapList(list, 'tm9')).toHaveLength(1)
    expect(filterScrapList(list, '')).toHaveLength(2)
  })
})
