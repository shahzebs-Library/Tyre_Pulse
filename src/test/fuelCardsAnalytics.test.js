import { describe, it, expect } from 'vitest'
import {
  enrichCards, filterCards, limitByCountry, providerBreakdown, expiryBreakdown,
  buildFuelCardKpis, buildFuelCardInsights, duplicateCards, fuelCardExportRows,
} from '../lib/fuelCardsAnalytics'

const NOW = new Date('2026-07-12T00:00:00Z')
const ROWS = [
  { id: 1, card_number: '4321123456789012', provider: 'Shell', asset_no: 'A1', monthly_limit: 1000, status: 'active', expiry_date: '2026-01-01', country: 'KSA' },
  { id: 2, card_number: '4321 1234 5678 9012', provider: 'Shell', status: 'active', expiry_date: '2026-07-20', country: 'KSA' },
  { id: 3, card_number: '1111', provider: 'BP', driver_name: 'Omar', monthly_limit: 500, status: 'blocked', country: 'KSA' },
]

describe('fuelCardsAnalytics', () => {
  it('enriches with expiry band, assignment and a stale-active flag', () => {
    const c = enrichCards(ROWS, NOW)
    expect(c[0]).toMatchObject({ expiryBand: 'expired', staleActive: true, assigned: true })
    expect(c[1]).toMatchObject({ expiryBand: 'expiring', assigned: false })
    expect(c[2]).toMatchObject({ expiryBand: 'unknown', staleActive: false })
    expect(c[0].masked).toBe('•••• 9012')
  })

  it('filters by expiry band, assignment and full-number search', () => {
    const c = enrichCards(ROWS, NOW)
    expect(filterCards(c, { expiry: 'expiring' }).map((r) => r.id)).toEqual([2])
    expect(filterCards(c, { assignment: 'unassigned' }).map((r) => r.id)).toEqual([2])
    expect(filterCards(c, { search: '43211234' }).map((r) => r.id)).toEqual([1])
    expect(filterCards(c, { provider: 'BP' }).map((r) => r.id)).toEqual([3])
  })

  it('never blends limits across countries', () => {
    expect(limitByCountry(ROWS, 'KSA').total).toBe(1500)
    const mixed = limitByCountry([...ROWS, { monthly_limit: 50, country: 'UAE' }], 'All')
    expect(mixed.total).toBeNull()
    expect(mixed.mixed).toBe(true)
  })

  it('builds KPIs, breakdowns and insights', () => {
    const c = enrichCards(ROWS, NOW)
    const k = buildFuelCardKpis(c, 'KSA')
    expect(k).toMatchObject({ total: 3, active: 2, blocked: 1, unassigned: 1, expiring: 1, expired: 1, staleActive: 1, noExpiry: 1 })
    expect(providerBreakdown(c)[0]).toMatchObject({ key: 'Shell', count: 2 })
    expect(expiryBreakdown(c).map((e) => e.count)).toEqual([1, 1, 0, 1])
    expect(duplicateCards(c)).toBe(1)
    expect(buildFuelCardInsights(c, 'KSA').length).toBeGreaterThan(2)
  })

  it('exports masked numbers only', () => {
    const x = fuelCardExportRows(enrichCards(ROWS, NOW))
    expect(x.every((r) => !String(r.card).includes('43211234'))).toBe(true)
    expect(x[1].monthly_limit).toBe('')
    expect(x[0].status).toBe('Active')
  })
})
