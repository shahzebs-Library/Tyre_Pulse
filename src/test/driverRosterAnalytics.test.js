import { describe, it, expect } from 'vitest'
import { rosterKpis, filterRoster, sortRoster, rosterSites, rosterExportRows, fineSummary, filterFines } from '../lib/driverRosterAnalytics'

const drivers = [
  { id: '1', driver_name: 'Bilal', driver_id: 'E1', site: 'NHC', open_fines: 2, awaiting_response: 1, pending_supervisor: 1, pending_finance: 0, overdue_fines: 1, user_id: 'u1' },
  { id: '2', driver_name: 'Ahmed', driver_id: 'E2', site: 'JED', open_fines: 0, awaiting_response: 0, overdue_fines: 0, user_id: null },
]
describe('driverRosterAnalytics', () => {
  it('computes roster KPIs', () => {
    expect(rosterKpis(drivers)).toEqual({ drivers: 2, openFines: 2, awaitingResponse: 1, pendingReview: 1, overdue: 1, loginNotLinked: 1 })
  })
  it('filters and sorts', () => {
    expect(filterRoster(drivers, { filter: 'no_login' }).map(d => d.id)).toEqual(['2'])
    expect(filterRoster(drivers, { filter: 'clear' }).map(d => d.id)).toEqual(['2'])
    expect(filterRoster(drivers, { site: 'NHC' })).toHaveLength(1)
    expect(filterRoster(drivers, { search: 'e2' })).toHaveLength(1)
    expect(sortRoster(drivers).map(d => d.id)).toEqual(['2', '1'])
    expect(sortRoster(drivers, 'open')[0].id).toBe('1')
    expect(rosterSites(drivers)).toEqual(['JED', 'NHC'])
    expect(rosterExportRows(drivers)[1].login).toBe('Not linked')
  })
  it('never sums fines across currencies', () => {
    const s = fineSummary([
      { currency: 'SAR', amount: 500, paid_amount: 100, status: 'open', response_status: 'awaiting_response', due_date: '2020-01-01' },
      { currency: 'AED', amount: 300, paid_amount: 0, status: 'closed' },
    ], new Date('2026-09-26').getTime())
    expect(s.byCurrency.map(c => c.currency).sort()).toEqual(['AED', 'SAR'])
    expect(s.byCurrency.find(c => c.currency === 'SAR').outstanding).toBe(400)
    expect(s.overdue).toBe(1)
    expect(s.awaiting).toBe(1)
    expect(filterFines([{ status: 'open', notice_reference: 'N1' }, { status: 'closed' }], { status: 'open' })).toHaveLength(1)
  })
})
