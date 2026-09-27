import { describe, it, expect } from 'vitest'
import {
  enrichContracts, filterContracts, sortContracts, contractCurrencyMix, contractExportRows, CONTRACT_EXPORT_COLUMNS,
} from '../lib/contractsAnalytics'

const NOW = Date.parse('2026-06-01T00:00:00Z')
const ROWS = [
  { id: 1, title: 'Michelin supply', vendor: 'Michelin', contract_type: 'supply', start_date: '2026-01-01', end_date: '2026-06-20', value: 1000, currency: 'SAR', status: 'active', created_at: '2026-01-01' },
  { id: 2, title: 'Lease', vendor: 'Acme', contract_type: 'lease', start_date: '2025-01-01', end_date: '2026-01-01', value: 500, currency: 'SAR', status: 'active', created_at: '2026-02-01' },
  { id: 3, title: 'Retread', vendor: 'Acme', contract_type: 'retread', start_date: null, end_date: null, value: null, status: 'pending', created_at: '2026-03-01' },
]

describe('contracts register engine', () => {
  const e = enrichContracts(ROWS, NOW)

  it('filters by type, vendor, expiry window, renewal dates and text', () => {
    expect(filterContracts(e, { vendor: 'Acme' }).map((r) => r.id)).toEqual([2, 3])
    expect(filterContracts(e, { type: 'lease' }).map((r) => r.id)).toEqual([2])
    expect(filterContracts(e, { expiryWindow: '30' }).map((r) => r.id)).toEqual([1])
    expect(filterContracts(e, { expiryWindow: 'all' })).toHaveLength(3)
    expect(filterContracts(e, { from: '2026-06-01' }).map((r) => r.id)).toEqual([1])
    expect(filterContracts(e, { query: 'michelin' }).map((r) => r.id)).toEqual([1])
  })

  it('sorts with unknowns last and never mutates', () => {
    expect(sortContracts(e, 'expiry').map((r) => r.id)).toEqual([2, 1, 3])
    expect(sortContracts(e, 'value').map((r) => r.id)).toEqual([1, 2, 3])
    expect(sortContracts(e, 'recent')[0].id).toBe(3)
    expect(e.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('refuses to add money across currencies', () => {
    expect(contractCurrencyMix(ROWS, 'SAR')).toMatchObject({ single: 'SAR', mixed: false })
    const mixed = contractCurrencyMix([...ROWS, { value: 1, currency: 'AED' }], 'SAR')
    expect(mixed).toMatchObject({ single: null, mixed: true, currencies: ['AED', 'SAR'] })
    // unvalued rows do not count toward the mix
    expect(contractCurrencyMix([{ value: null, currency: 'EGP' }], 'SAR').single).toBe('SAR')
  })

  it('exports every column with N/A for the unknowns', () => {
    const out = contractExportRows(e, 'SAR')
    expect(Object.keys(out[0])).toEqual(CONTRACT_EXPORT_COLUMNS.map((c) => c.key))
    expect(out[2]).toMatchObject({ start_date: 'N/A', annualized: 'N/A', days_remaining: 'N/A', currency: 'SAR' })
  })
})
