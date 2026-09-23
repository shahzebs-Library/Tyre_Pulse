import { describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ filters: [], rows: [] }))
vi.mock('../lib/api/_client', () => {
  const query = {
    select() { return this }, order() { return this }, range() { return this },
    eq(field, value) { fixture.filters.push(['eq', field, value]); return this },
    gte(field, value) { fixture.filters.push(['gte', field, value]); return this },
    lte(field, value) { fixture.filters.push(['lte', field, value]); return this },
    lt(field, value) { fixture.filters.push(['lt', field, value]); return this },
  }
  return { supabase: { from: () => query }, applyCountry: q => q, ServiceError: Error,
    fetchAllPages: async build => {
      build(0, 999)
      return { data: fixture.rows.filter(row => fixture.filters.every(([op, field, value]) => {
        if (op === 'eq') return row[field] === value
        const actual = Date.parse(row[field]); const boundary = Date.parse(value)
        return op === 'gte' ? actual >= boundary : op === 'lte' ? actual <= boundary : actual < boundary
      })) }
    },
  }
})
import { fetchCostCenterRecords } from '../lib/api/costCenter'

describe('cost center inclusive end-date filter', () => {
  it.each(['2026-09-30', '2026-12-31', '2028-02-29'])('includes final fractional second on %s, excluding next day and other countries', async day => {
    fixture.filters = []
    const next = new Date(day + 'T00:00:00Z')
    next.setUTCDate(next.getUTCDate() + 1)
    fixture.rows = [
      { id: 'last', country: 'KSA', created_at: day + 'T23:59:59.999Z' },
      { id: 'next', country: 'KSA', created_at: next.toISOString() },
      { id: 'other-country', country: 'UAE', created_at: day + 'T12:00:00Z' },
    ]
    const result = await fetchCostCenterRecords({ country: 'KSA', dateFrom: day, dateTo: day })
    expect(result.data.map(row => row.id)).toEqual(['last'])
  })
})
