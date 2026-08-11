import { describe, it, expect } from 'vitest'
import { summaryFromMonthly, summarizeLedger } from '../lib/costPerM3'

/**
 * These ledgers used to read up to 20,000 rows into the browser purely to add
 * them up. The figures below are the real KSA shapes the server returns, so a
 * regression here is a regression against live data.
 */
describe('summaryFromMonthly', () => {
  const production = [
    { month: '2026-08', loads: 8452, supplied_m3: 91060, approved_m3: 90833, rejected_m3: 227, rejected_loads: 21, not_approved_m3: 227 },
    { month: '2026-07', loads: 33818, supplied_m3: 298500, approved_m3: 298074, rejected_m3: 426, rejected_loads: 30, not_approved_m3: 426 },
  ]

  it('totals the whole window without reading a row', () => {
    const s = summaryFromMonthly(production, 'production', { totalRows: 42270 })
    expect(s.totals.approved_m3).toBe(388907)
    expect(s.totals.supplied_m3).toBe(389560)
    expect(s.totals.rejected_loads).toBe(51)
    expect(s.totals.months).toBe(2)
  })

  it('reports the true server row count, never a count of months', () => {
    const s = summaryFromMonthly(production, 'production', { totalRows: 42270 })
    expect(s.totals.rows).toBe(42270)
  })

  it('falls back to the loads the aggregate reports when no count is supplied', () => {
    // Still a real number of rows, just measured a different way - never the
    // number of months, which would understate it by four orders of magnitude.
    expect(summaryFromMonthly(production, 'production').totals.rows).toBe(42270)
  })

  it('orders months newest first', () => {
    const s = summaryFromMonthly(production, 'production', {})
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-08', '2026-07'])
    expect(s.totals.firstMonth).toBe('2026-07')
    expect(s.totals.lastMonth).toBe('2026-08')
  })

  it('keeps the money ledgers per region and labels the country currency', () => {
    const sco = [
      { month: '2026-08', amount: 22365, entries: 14, regions: [{ region: 'Unassigned', amount: 22365, entries: 14 }] },
      { month: '2026-07', amount: 291414, entries: 83, regions: [{ region: 'Central', amount: 291414, entries: 83 }] },
    ]
    const s = summaryFromMonthly(sco, 'sco', { totalRows: 97, currency: 'SAR' })
    expect(s.totals.value).toBe(313779)
    expect(s.totals.currencies).toEqual(['SAR'])
    // One country is one currency, so a monthly aggregate can never be mixed.
    expect(s.totals.mixedCurrency).toBe(false)
    expect(s.bySite.map((r) => r.site)).toEqual(['Central', 'Unassigned'])
  })

  it('keeps the SANY parts detail out of the payable total', () => {
    const sany = [{ month: '2026-07', amount: 2218654, entries: 2, detail_entries: 5, regions: [] }]
    const s = summaryFromMonthly(sany, 'sany', { currency: 'SAR' })
    expect(s.totals.counted_value).toBe(2218654)
    expect(s.totals.detail_rows).toBe(5)
  })

  it('says nothing rather than zero when the window is empty', () => {
    const s = summaryFromMonthly([], 'production', { totalRows: 0 })
    expect(s.totals.value).toBeNull()
    expect(s.totals.approved_m3).toBeNull()
    expect(s.byMonth).toEqual([])
  })

  it('survives a month the server could not date', () => {
    const s = summaryFromMonthly(
      [{ month: null, loads: 3, approved_m3: 10 }, { month: '2026-07', loads: 1, approved_m3: 5 }],
      'production', {},
    )
    // Unknown sorts last and is never counted as a real month boundary.
    expect(s.byMonth[s.byMonth.length - 1].month).toBe('Unknown')
    expect(s.totals.firstMonth).toBe('2026-07')
  })

  it('agrees with the row-based summary it replaces', () => {
    // The two must produce the same totals or the page would change its numbers
    // the moment somebody opens the rows.
    const rows = [
      { period_date: '2026-07-05', approved_m3: 100, m3: 110, site: 'JED', rejected: true },
      { period_date: '2026-07-06', approved_m3: 200, m3: 200, site: 'JED' },
      { period_date: '2026-08-01', approved_m3: 50, m3: 50, site: 'RIY' },
    ]
    const fromRows = summarizeLedger(rows, 'production')
    const fromServer = summaryFromMonthly([
      { month: '2026-08', loads: 1, supplied_m3: 50, approved_m3: 50, rejected_loads: 0, rejected_m3: 0, sites: [{ site: 'RIY', loads: 1, approved_m3: 50 }] },
      { month: '2026-07', loads: 2, supplied_m3: 310, approved_m3: 300, rejected_loads: 1, rejected_m3: 10, sites: [{ site: 'JED', loads: 2, approved_m3: 300 }] },
    ], 'production', { totalRows: 3 })
    expect(fromServer.totals.approved_m3).toBe(fromRows.totals.approved_m3)
    expect(fromServer.totals.supplied_m3).toBe(fromRows.totals.supplied_m3)
    expect(fromServer.totals.rejected_loads).toBe(fromRows.totals.rejected_loads)
    expect(fromServer.totals.rows).toBe(fromRows.totals.rows)
    expect(fromServer.bySite.map((s) => s.site)).toEqual(fromRows.bySite.map((s) => s.site))
  })
})
