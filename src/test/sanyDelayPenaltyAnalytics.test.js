import { describe, it, expect } from 'vitest'
import {
  PENALTY_RULE, penaltyForHours, downtimeHoursOf, evaluateCandidate, summarizeCandidates,
  rowIssues, summarizeLedger, groupPenalties, monthlyTrend, repeatAssets, filterLedger,
  siteOptions, ledgerExportRows, ageDays, numOrNull,
} from '../lib/sanyDelayPenaltyAnalytics'

const NOW = '2026-09-26T00:00:00Z'
const row = (o) => ({ status: 'draft', currency: 'SAR', rate_per_hour: 43, asset_no: 'TM1', site: 'NHC', ...o })

describe('sanyDelayPenaltyAnalytics', () => {
  it('rule is 43 SAR per hour over 5 days', () => {
    expect(PENALTY_RULE).toEqual({ ratePerHour: 43, minDays: 5, currency: 'SAR' })
    expect(penaltyForHours(200)).toBe(8600)
    expect(penaltyForHours(null)).toBeNull()
    expect(penaltyForHours('')).toBeNull()
    expect(numOrNull('1,200')).toBe(1200)
  })

  it('derives downtime from timestamps when hours are absent', () => {
    expect(downtimeHoursOf({ production_out_at: '2026-01-01T00:00:00Z', production_in_at: '2026-01-08T12:00:00Z' })).toBe(180)
    expect(downtimeHoursOf({ production_out_at: '2026-01-08', production_in_at: '2026-01-01' })).toBeNull()
    expect(downtimeHoursOf({ downtime_hours: 0 })).toBe(0)
  })

  it('evaluates eligibility strictly over 5 days', () => {
    expect(evaluateCandidate({ downtime_hours: 120 }).eligible).toBe(false)
    const ev = evaluateCandidate({ downtime_hours: 121 })
    expect(ev.eligible).toBe(true)
    expect(ev.penalty).toBe(5203)
    expect(evaluateCandidate({}).penalty).toBeNull()
  })

  it('summarizes candidates honestly', () => {
    const s = summarizeCandidates([{ downtime_hours: 200 }, { downtime_hours: 50 }, {}])
    expect(s.eligible).toBe(1)
    expect(s.unmeasurable).toBe(1)
    expect(s.potentialPenalty).toBe(8600)
    expect(summarizeCandidates([]).potentialPenalty).toBeNull()
  })

  it('flags row issues without fixing them', () => {
    expect(rowIssues(row({ downtime_hours: 200, penalty_amount: 8600 }))).toEqual([])
    expect(rowIssues(row({ downtime_hours: 200, penalty_amount: 100 }))).toContain('amount_mismatch')
    expect(rowIssues(row({ downtime_hours: 200, penalty_amount: 8600, status: 'deducted' }))).toContain('deducted_no_invoice')
    expect(rowIssues(row({ downtime_hours: 100, penalty_amount: 4300 }))).toContain('under_threshold')
    expect(rowIssues(row({ downtime_hours: 200, rate_per_hour: 50, penalty_amount: 10000 }))).toContain('non_standard_rate')
    expect(rowIssues(row({ downtime_hours: 200, penalty_amount: 8600, currency: 'AED' }))).toContain('non_sar_currency')
  })

  it('summarizes the ledger in SAR only and never blends another currency', () => {
    const rows = [
      row({ downtime_hours: 200, penalty_amount: 8600, created_at: '2026-06-01' }),
      row({ downtime_hours: 300, penalty_amount: 12900, status: 'deducted', sany_invoice_no: 'INV1' }),
      row({ downtime_hours: 200, penalty_amount: 8600, status: 'waived' }),
      row({ downtime_hours: 200, penalty_amount: 999999, currency: 'AED' }),
      row({ downtime_hours: 200, penalty_amount: null }),
    ]
    const s = summarizeLedger(rows, { now: NOW })
    expect(s.toDeduct).toBe(21500)
    expect(s.outstanding).toBe(8600)
    expect(s.foreignCurrency).toBe(1)
    expect(s.unpriced).toBe(1)
    expect(s.overdueDrafts).toBe(1)
    expect(s.distinctInvoices).toBe(1)
    expect(s.deductedPct).toBe(60)
  })

  it('returns null totals for an empty ledger (N/A, not zero)', () => {
    const s = summarizeLedger([], { now: NOW })
    expect(s.toDeduct).toBeNull()
    expect(s.hours).toBeNull()
    expect(s.invoiceCoveragePct).toBeNull()
  })

  it('groups, trends, repeats, filters and exports', () => {
    const rows = [
      row({ asset_no: 'A', downtime_hours: 200, penalty_amount: 8600, period_date: '2026-01-01' }),
      row({ asset_no: 'A', downtime_hours: 150, penalty_amount: 6450, period_date: '2026-02-01', site: 'JED', sany_invoice_no: 'X' }),
      row({ asset_no: 'B', downtime_hours: 150, penalty_amount: 6450, period_date: '2026-02-01', status: 'waived' }),
    ]
    expect(groupPenalties(rows, (r) => r.asset_no)[0]).toMatchObject({ key: 'A', rows: 2, penalty: 15050 })
    const t = monthlyTrend(rows)
    expect(t.map((m) => m.month)).toEqual(['2026-01', '2026-02'])
    expect(t[1].penalty).toBe(6450)
    expect(repeatAssets(rows).map((g) => g.key)).toEqual(['A'])
    expect(filterLedger(rows, { search: 'jed' })).toHaveLength(1)
    expect(filterLedger(rows, { status: 'waived' })).toHaveLength(1)
    expect(filterLedger(rows, { invoice: 'without' })).toHaveLength(2)
    expect(siteOptions(rows)).toEqual(['JED', 'NHC'])
    const ex = ledgerExportRows([row({ downtime_hours: 240, penalty_amount: null })], { now: NOW })
    expect(ex[0].penalty_amount).toBe('')
    expect(ex[0].downtime_days).toBe(10)
    expect(ageDays({ created_at: '2026-09-20T00:00:00Z' }, NOW)).toBe(6)
  })
})
