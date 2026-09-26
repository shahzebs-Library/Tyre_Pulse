import { describe, it, expect } from 'vitest'
import {
  serialOf, daysSince, deriveTransfers, deriveCustody, deriveRetreads, derivePendingReturns,
  excludeMarked, exchangeKpis, transferFilterOptions, filterTransfers, hasTransferFilters,
  siteFlowMatrix, siteNetFlow, flowIntensity, monthlyTransferCounts, transferTypeCounts,
  topTransferredSerials, transfersByBrand, custodySummary, custodyRows, retreadSummary,
  pendingSummary, pendingBand, exportRows, transferExportView, PENDING_EXPORT_COLUMNS,
} from '../lib/tyreExchangeAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')

const REC = [
  { id: 1, serial_no: 'A1', asset_no: 'TM1', site: 'NHC', brand: 'X', size: '315', issue_date: '2026-01-10', km_at_fitment: 1000, km_at_removal: 21000, tread_depth: 8 },
  { id: 2, serial_no: 'A1', asset_no: 'TM2', site: 'NHC', brand: 'X', issue_date: '2026-03-10', km_at_fitment: 0, km_at_removal: 5000 },
  { id: 3, serial_no: 'A1', asset_no: 'TM2', site: 'JED', issue_date: '2026-05-10' },
  { id: 4, serial_no: 'B2', asset_no: 'TM3', site: 'JED', brand: 'Y', issue_date: '2026-06-01', category: 'Retread' },
  { id: 5, serial_no: 'C3', asset_no: 'TM4', site: 'NHC', brand: 'Y', issue_date: '2026-09-20', category: 'Repair' },
  { id: 6, serial_no: '', asset_no: 'TM9', site: 'NHC', issue_date: '2026-01-01' },
]

describe('tyreExchangeAnalytics', () => {
  it('reads the canonical and legacy serial and skips blanks', () => {
    expect(serialOf({ serial_no: 'S' })).toBe('S')
    expect(serialOf({ serial_number: 'L', serial_no: 'S' })).toBe('L')
    expect(serialOf({ serial_no: '  ' })).toBeNull()
  })

  it('daysSince uses the injected clock and is null for no date', () => {
    expect(daysSince('2026-09-16T12:00:00Z', NOW)).toBe(10)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })

  it('derives vehicle and site transfers with honest nulls', () => {
    const t = deriveTransfers(REC)
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ serial: 'A1', fromAsset: 'TM1', toAsset: 'TM2', transferType: 'Inter-Vehicle', kmAtTransfer: 21000, kmRun: 20000 })
    expect(t[1]).toMatchObject({ fromSite: 'NHC', toSite: 'JED', transferType: 'Inter-Site', category: null })
    // km_at_fitment 0 is not a measurable run
    expect(t[1].kmRun).toBeNull()
  })

  it('custody chain is case-insensitive and ordered', () => {
    const c = deriveCustody(REC, 'a1')
    expect(c.map((r) => r.id)).toEqual([1, 2, 3])
    expect(deriveCustody(REC, '')).toEqual([])
    const s = custodySummary(c)
    expect(s).toMatchObject({ records: 3, uniqueVehicles: 2, uniqueSites: 2, firstSeen: '2026-01-10' })
    expect(custodySummary([])).toBeNull()
    const rows = custodyRows(c)
    expect(rows[0].kmRun).toBe(20000)
    expect(rows[2].kmRun).toBeNull()
    expect(rows[2].tread).toBeNull()
  })

  it('retreads flag overdue against the injected clock', () => {
    const r = deriveRetreads(REC, { now: NOW })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ serial: 'B2', returnStatus: 'Pending Return', overdue: true })
    expect(retreadSummary(r)).toEqual({ total: 1, returned: 0, pending: 1, overdue: 1 })
  })

  it('pending returns and marks', () => {
    const p = derivePendingReturns(REC, { now: NOW })
    expect(p.map((x) => x.serial).sort()).toEqual(['B2', 'C3'])
    expect(excludeMarked(p, ['B2'], []).map((x) => x.serial)).toEqual(['C3'])
    const s = pendingSummary(p)
    expect(s).toMatchObject({ total: 2, over30: 1, over60: 1, undated: 0 })
    expect(pendingBand(null)).toBe('unknown')
    expect(pendingBand(61)).toBe('critical')
    expect(pendingBand(31)).toBe('warn')
    expect(pendingBand(5)).toBe('ok')
  })

  it('KPIs return null average km when nothing was measured', () => {
    const t = deriveTransfers(REC)
    const k = exchangeKpis(REC, t, [], [])
    expect(k).toMatchObject({ interVehicle: 1, interSite: 1, transfers: 2, avgKm: 13000, kmSample: 2 })
    expect(exchangeKpis([], [], [], []).avgKm).toBeNull()
  })

  it('filters transfers including free-text search', () => {
    const t = deriveTransfers(REC)
    expect(filterTransfers(t, { transferType: 'Inter-Site' })).toHaveLength(1)
    expect(filterTransfers(t, { search: 'tm1' })).toHaveLength(1)
    expect(filterTransfers(t, { dateFrom: '2026-04-01' })).toHaveLength(1)
    expect(hasTransferFilters({ search: '' })).toBe(false)
    expect(hasTransferFilters({ brand: 'X' })).toBe(true)
    expect(transferFilterOptions(REC, t)).toMatchObject({ sites: ['JED', 'NHC'], brands: ['X', 'Y'] })
  })

  it('builds a site flow matrix with totals and net roles', () => {
    const t = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, fromSite: 'A', toSite: 'B' })),
      { id: 'b', fromSite: 'B', toSite: 'A' },
    ]
    const f = siteFlowMatrix(t)
    expect(f.sites).toEqual(['A', 'B'])
    expect(f.matrix.A.B).toBe(4)
    expect(f.max).toBe(4)
    expect(f.totalOut.A).toBe(4)
    expect(f.totalIn.A).toBe(1)
    const net = siteNetFlow(f)
    expect(net.find((r) => r.site === 'B')).toMatchObject({ net: 3, role: 'Net Receiver' })
    expect(net.find((r) => r.site === 'A')).toMatchObject({ net: -3, role: 'Net Sender' })
    expect(flowIntensity(4, 4)).toBe(4)
    expect(flowIntensity(0, 4)).toBe(0)
    expect(flowIntensity(1, 0)).toBe(0)
  })

  it('monthly counts are anchored to the injected clock', () => {
    const t = deriveTransfers(REC)
    const m = monthlyTransferCounts(t, { now: NOW, months: 12 })
    expect(m).toHaveLength(12)
    expect(m[11].key).toBe('2026-09')
    expect(m.find((x) => x.key === '2026-03').count).toBe(1)
    expect(m.find((x) => x.key === '2026-05').count).toBe(1)
  })

  it('type, serial and brand rollups', () => {
    const t = deriveTransfers(REC)
    expect(transferTypeCounts([...t, { transferType: 'Odd' }])).toEqual({ 'Inter-Vehicle': 2, 'Inter-Site': 1, Retread: 0, Repair: 0 })
    expect(topTransferredSerials(t, REC)[0]).toEqual({ serial: 'A1', count: 2, brand: 'X' })
    expect(transfersByBrand([{ brand: null }, { brand: 'X' }, { brand: 'X' }])).toEqual([
      { brand: 'X', count: 2 }, { brand: 'Unknown', count: 1 },
    ])
  })

  it('exports never carry a blank for an unrecorded value', () => {
    const rows = exportRows([{ serial: 'Z', brand: null, daysPending: 0 }], PENDING_EXPORT_COLUMNS)
    expect(rows[0].brand).toBe('N/A')
    expect(rows[0].daysPending).toBe(0)
    const v = transferExportView({ serial: 'Z', kmAtTransfer: null, treadAtTransfer: 7, brand: null })
    expect(v.x_km).toBe('N/A')
    expect(v.x_tread).toBe('7 mm')
    expect(v.x_brand).toBe('N/A')
  })
})
