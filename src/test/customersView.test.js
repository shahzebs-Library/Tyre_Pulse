import { describe, it, expect } from 'vitest'
import {
  nameKey, matchAccounts, matchContracts, isActiveContract, isRenewalDue, contractPeriod, periodLabel,
  customerHealth, buildCustomerRows, customerViewKpis, byCountry, topByFleet, healthSegments,
  serviceCoverage, renewalsDue, filterView,
} from '../lib/customersView'

const NOW = new Date('2026-09-29T10:00:00Z')
const C = [
  { id: 'a', name: 'Gulf  Logistics', status: 'active', email: 'ops@gulf.com', country: 'UAE', customer_type: 'Transport' },
  { id: 'b', name: 'Metro Build', status: 'active', phone: '+966', country: 'KSA', customer_type: 'Construction' },
  { id: 'c', name: 'Old Co', status: 'inactive', country: 'KSA' },
  { id: 'd', name: 'New Lead', status: 'prospect' },
]

describe('customersView', () => {
  it('normalises name keys', () => {
    expect(nameKey('  Gulf  LOGISTICS ')).toBe('gulf logistics')
  })

  it('links a portal account only when the name is unambiguous', () => {
    const m = matchAccounts(C, [
      { company_name: 'gulf logistics', assets_linked: 12 },
      { company_name: 'Metro Build' }, { company_name: 'metro build' },
    ])
    expect(m.get('a').assets_linked).toBe(12)
    expect(m.has('b')).toBe(false)
  })

  it('links contracts by counterparty name', () => {
    const m = matchContracts(C, [{ vendor: 'METRO BUILD', title: 'x' }, { vendor: 'Other' }])
    expect(m.get('b')).toHaveLength(1)
    expect(m.has('a')).toBe(false)
  })

  it('judges contract activity and renewal against the given day', () => {
    expect(isActiveContract({ status: 'active', end_date: '2026-09-28' }, NOW)).toBe(false)
    expect(isActiveContract({ status: 'active', end_date: null }, NOW)).toBe(true)
    expect(isRenewalDue({ status: 'active', end_date: '2026-12-01' }, NOW)).toBe(true)
    expect(isRenewalDue({ status: 'active', end_date: '2027-06-01' }, NOW)).toBe(false)
  })

  it('builds a contract period and label', () => {
    const p = contractPeriod([{ start_date: '2024-01-05', end_date: '2025-12-31' }, { start_date: '2023-03-01', end_date: '2026-03-01' }])
    expect(p).toEqual({ from: '2023-03-01', to: '2026-03-01' })
    expect(periodLabel(p)).toBe('Mar 2023 to Mar 2026')
    expect(contractPeriod([])).toBeNull()
  })

  it('classifies health by the stated rule', () => {
    expect(customerHealth({ status: 'inactive' })).toBe('inactive')
    expect(customerHealth({ status: 'prospect' })).toBe('prospect')
    expect(customerHealth({ status: 'active' })).toBe('critical')
    expect(customerHealth({ status: 'active', phone: '1' }, { account: { open_requests: 2 } }, NOW)).toBe('at_risk')
    expect(customerHealth({ status: 'active', phone: '1' }, { account: { open_requests: 0 } }, NOW)).toBe('healthy')
  })

  it('keeps unknown linked figures null, not zero', () => {
    const rows = buildCustomerRows(C, { now: NOW })
    const k = customerViewKpis(rows)
    expect(k.total).toBe(4)
    expect(k.active).toBe(2)
    expect(k.assignedAssets).toBeNull()
    expect(k.openIssues).toBeNull()
    expect(k.activeContracts).toBeNull()
    expect(k.monthlyRevenue).toBeNull()
    expect(serviceCoverage(rows, false).pct).toBeNull()
  })

  it('sums linked figures when the registers were read', () => {
    const rows = buildCustomerRows(C, {
      accounts: [{ company_name: 'Gulf Logistics', assets_linked: 32, open_requests: 1, account_code: 'CUST-1' }],
      contracts: [{ vendor: 'Metro Build', status: 'active', start_date: '2026-01-01', end_date: '2026-11-15', title: 'Service' }],
      now: NOW,
    })
    const k = customerViewKpis(rows, { accountsKnown: true, contractsKnown: true })
    expect(k.assignedAssets).toBe(32)
    expect(k.openIssues).toBe(1)
    expect(k.activeContracts).toBe(1)
    expect(rows[0].code).toBe('CUST-1')
    expect(topByFleet(rows)).toEqual([{ id: 'a', name: 'Gulf  Logistics', assets: 32 }])
    expect(serviceCoverage(rows, true)).toEqual({ pct: 50, covered: 1, of: 2 })
    expect(renewalsDue(rows, NOW)).toHaveLength(1)
    expect(healthSegments(rows).map((s) => s.key)).toEqual(['at_risk', 'inactive', 'prospect'])
  })

  it('groups by country and filters the register', () => {
    const rows = buildCustomerRows(C, { now: NOW })
    expect(byCountry(rows)[0]).toEqual({ country: 'KSA', total: 2 })
    expect(filterView(rows, { country: 'KSA', status: 'active' }).map((r) => r.id)).toEqual(['b'])
    expect(filterView(rows, { industry: 'Transport' })).toHaveLength(1)
    expect(filterView(rows, { query: 'lead' })).toHaveLength(1)
    expect(filterView(rows, { country: 'Unassigned' }).map((r) => r.id)).toEqual(['d'])
  })
})
