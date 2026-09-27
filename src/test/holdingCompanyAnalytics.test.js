import { describe, it, expect } from 'vitest'
import {
  viewerCountries, spendCurrency, consolidateSpend, fmtSpend, fmtInt, groupHealth,
  healthBand, orgOptions, filterTransfers, transferSummary, subsidiaryRows, subsidiaryExportRows,
} from '../lib/holdingCompanyAnalytics'

describe('currency scope', () => {
  it('treats admins, super admins and ALL as org-wide', () => {
    expect(viewerCountries({ role: 'Admin', country: ['KSA'] })).toBeNull()
    expect(viewerCountries({ isSuperAdmin: true })).toBeNull()
    expect(viewerCountries({ role: 'Manager', country: ['ALL'] })).toBeNull()
    expect(viewerCountries({ role: 'Manager', country: ['KSA'] })).toEqual(['KSA'])
    expect(viewerCountries({ role: 'Manager', country: 'UAE' })).toEqual(['UAE'])
  })
  it('names a currency only for exactly one known country', () => {
    expect(spendCurrency(['KSA'])).toBe('SAR')
    expect(spendCurrency(['Egypt'])).toBe('EGP')
    expect(spendCurrency(['KSA', 'UAE'])).toBeNull()
    expect(spendCurrency(null)).toBeNull()
    expect(spendCurrency(['Mars'])).toBeNull()
  })
})

describe('consolidateSpend', () => {
  const subs = [{ spend_30d: 100 }, { spend_30d: '250' }, { spend_30d: null }]
  it('totals one known currency', () => {
    const r = consolidateSpend(subs, 'SAR')
    expect(r.single).toBe('SAR')
    expect(r.total).toBe(350)
    expect(r.byCurrency).toEqual([{ currency: 'SAR', total: 350, orgs: 2 }])
    expect(r.undetermined).toBeNull()
  })
  it('never produces a total when the currency is unknown', () => {
    const r = consolidateSpend(subs, null)
    expect(r.total).toBeNull()
    expect(r.single).toBeNull()
    expect(r.undetermined).toEqual({ total: 350, orgs: 2 })
    expect(r.any).toBe(true)
  })
  it('handles an empty group', () => {
    const r = consolidateSpend([], 'SAR')
    expect(r.any).toBe(false)
    expect(r.total).toBeNull()
  })
  it('refuses to print blended money', () => {
    expect(fmtSpend(1000, null)).toBe('Mixed currencies')
    expect(fmtSpend(null, 'SAR')).toBe('N/A')
    expect(fmtSpend(1234.4, 'AED')).toBe(`AED ${(1234).toLocaleString()}`)
    expect(fmtInt(undefined)).toBe('N/A')
  })
})

describe('health', () => {
  it('averages only scored organisations', () => {
    expect(groupHealth([])).toBeNull()
    expect(groupHealth([{ fleet_health_score: null }])).toBeNull()
    expect(groupHealth([{ fleet_health_score: 80 }, { fleet_health_score: 61 }])).toBe(71)
    expect(healthBand(null).key).toBe('none')
    expect(healthBand(85).label).toBe('Healthy')
    expect(healthBand(65).key).toBe('watch')
    expect(healthBand(10).key).toBe('risk')
  })
})

describe('transfers and register', () => {
  const orgs = orgOptions([{ tenant_id: 'a', name: 'HQ' }], [{ id: 'b', name: 'Sub' }, { id: 'a', name: 'dup' }])
  it('de-duplicates org options', () => {
    expect(orgs).toEqual([{ id: 'a', name: 'HQ' }, { id: 'b', name: 'Sub' }])
  })
  const transfers = [
    { from_org_id: 'a', to_org_id: 'b', status: 'pending', quantity: 4, asset_type: 'tyre' },
    { from_org_id: 'b', to_org_id: 'a', status: 'received', quantity: '2', asset_ref: 'SN1' },
    { from_org_id: 'a', to_org_id: 'b', status: 'cancelled', quantity: 9 },
    { from_org_id: 'a', to_org_id: 'b', status: 'weird', quantity: 1 },
  ]
  it('summarises and filters transfers', () => {
    const s = transferSummary(transfers)
    expect(s).toMatchObject({ total: 4, open: 2, received: 1, units: 7 })
    const nameOf = (id) => orgs.find((o) => o.id === id)?.name
    expect(filterTransfers(transfers, { status: 'received' })).toHaveLength(1)
    expect(filterTransfers(transfers, { search: 'sn1', nameOf })).toHaveLength(1)
    expect(filterTransfers(transfers, { search: 'sub', nameOf })).toHaveLength(4)
  })
  it('keeps missing counts null and marks export spend currency', () => {
    const rows = subsidiaryRows([{ tenant_id: 'a', name: 'HQ', is_hq: true, vehicles: 3, spend_30d: 10 }])
    expect(rows[0].tyres).toBeNull()
    expect(rows[0].fleet_health_score).toBeNull()
    expect(subsidiaryExportRows(rows, null)[0]).toMatchObject({ spend_30d: 'Mixed currencies', spend_currency: 'Mixed', is_hq: 'Yes' })
    expect(subsidiaryExportRows(rows, 'SAR')[0]).toMatchObject({ spend_30d: 10, spend_currency: 'SAR' })
  })
})
