import { describe, it, expect } from 'vitest'
import {
  enrichDocuments, filterDocuments, typeOptions, driverOptions, documentKpis,
  typeBreakdown, expiryPhrase, documentExport,
} from '../lib/driverDocumentsAnalytics'

const NOW = Date.UTC(2026, 8, 27)
const rows = [
  { id: 1, driver_name: 'Ali', doc_type: 'license', doc_number: 'L1', expiry_date: '2026-09-20' }, // expired
  { id: 2, driver_name: 'ali ', doc_type: 'medical', expiry_date: '2026-10-10' }, // 13 days
  { id: 3, driver_name: 'Sara', doc_type: 'visa', expiry_date: '2027-06-01' }, // valid
  { id: 4, driver_name: 'Sara', doc_type: 'custom_pass', expiry_date: null }, // no expiry
]

describe('driverDocumentsAnalytics', () => {
  it('enriches with status and days', () => {
    const e = enrichDocuments(rows, NOW)
    expect(e.map((r) => r._status)).toEqual(['expired', 'expiring', 'valid', 'valid'])
    expect(e[1]._days).toBe(13)
    expect(e[3]._days).toBeNull()
  })

  it('filters, searches and orders soonest first with undated last', () => {
    const e = enrichDocuments(rows, NOW)
    expect(filterDocuments(e).map((r) => r.id)).toEqual([1, 2, 3, 4])
    expect(filterDocuments(e, { status: 'expired' }).map((r) => r.id)).toEqual([1])
    expect(filterDocuments(e, { driver: 'ALI' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterDocuments(e, { search: 'medical' }).map((r) => r.id)).toEqual([2])
  })

  it('builds option lists', () => {
    const e = enrichDocuments(rows, NOW)
    expect(typeOptions(e)).toEqual(['license', 'medical', 'visa', 'custom_pass'])
    expect(driverOptions(e)).toEqual(['Ali', 'Sara'])
  })

  it('computes KPIs with honest compliance', () => {
    const k = documentKpis(rows, NOW)
    expect(k).toMatchObject({ total: 4, expired: 1, expiring: 1, valid: 2, urgent: 1, missingExpiry: 1, drivers: 2, driversWithExpired: 1, compliancePct: 50 })
    expect(k.nextExpiry.days).toBe(13)
    expect(documentKpis([], NOW).compliancePct).toBeNull()
  })

  it('breaks down by type and phrases expiry', () => {
    const b = typeBreakdown(enrichDocuments(rows, NOW))
    expect(b.find((x) => x.type === 'Licence').expired).toBe(1)
    expect(expiryPhrase(null)).toBe('No expiry date')
    expect(expiryPhrase(0)).toBe('Expires today')
    expect(expiryPhrase(-1)).toBe('1 day ago')
    expect(expiryPhrase(5)).toBe('in 5 days')
  })

  it('exports N/A for unknown days', () => {
    const x = documentExport(enrichDocuments(rows, NOW))
    expect(x.headers).toContain('Days to expiry')
    expect(x.rows[3].days).toBe('N/A')
  })
})
