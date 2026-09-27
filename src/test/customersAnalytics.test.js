import { describe, it, expect } from 'vitest'
import {
  contactQuality, filterCustomers, customerKpis, countBy, statusMix, distinctValues,
  customerExportRows, CUSTOMER_EXPORT_COLUMNS, statusLabel,
} from '../lib/customersAnalytics'

const ROWS = [
  { id: 1, name: 'Gulf Logistics', customer_type: 'Fleet', status: 'active', contact_name: 'Sara', email: 'ops@gulf.com', site: 'Dubai' },
  { id: 2, name: 'Desert Works', customer_type: 'Workshop', status: 'prospect', phone: '+971 1' },
  { id: 3, name: 'Bad Mail Co', customer_type: 'Fleet', status: 'inactive', email: 'nope' },
  { id: 4, name: 'Silent', status: 'active' },
]

describe('customersAnalytics', () => {
  it('grades contact quality', () => {
    expect(ROWS.map(contactQuality)).toEqual(['complete', 'reachable', 'invalid_email', 'missing'])
  })

  it('filters by status, type, site, quality and text', () => {
    expect(filterCustomers(ROWS, { status: 'active' }).map((r) => r.id)).toEqual([1, 4])
    expect(filterCustomers(ROWS, { type: 'Fleet' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterCustomers(ROWS, { site: 'Dubai' }).map((r) => r.id)).toEqual([1])
    expect(filterCustomers(ROWS, { quality: 'missing' }).map((r) => r.id)).toEqual([4])
    expect(filterCustomers(ROWS, { query: '+971' }).map((r) => r.id)).toEqual([2])
  })

  it('computes KPIs with a null coverage for an empty registry', () => {
    const k = customerKpis(ROWS)
    expect(k).toMatchObject({ total: 4, active: 2, prospect: 1, inactive: 1, reachable: 2, needsAttention: 2, sites: 1 })
    expect(k.reachablePct).toBe(50)
    expect(customerKpis([]).reachablePct).toBeNull()
  })

  it('groups and mixes statuses in canonical order', () => {
    expect(countBy(ROWS, 'customer_type')).toEqual([
      { key: 'Fleet', count: 2 }, { key: 'Unspecified', count: 1 }, { key: 'Workshop', count: 1 },
    ])
    expect(statusMix(ROWS).map((s) => s.count)).toEqual([2, 1, 1])
    expect(distinctValues(ROWS, 'site')).toEqual(['Dubai'])
    expect(statusLabel('')).toBe('Not set')
  })

  it('exports every column', () => {
    const out = customerExportRows(ROWS)
    expect(Object.keys(out[0])).toEqual(CUSTOMER_EXPORT_COLUMNS.map((c) => c.key))
    expect(out[2].contact_quality).toBe('Email not valid')
  })
})
