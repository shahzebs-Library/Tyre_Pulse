import { describe, it, expect } from 'vitest'
import { normaliseHistory, scanKpis, riskBreakdown, scansByDay, filterScans, sortScans, passportPath, scanExportRows } from '../lib/tyreScanAnalytics'

const raw = [
  { serial: 'S1', brand: 'X', asset: 'TM1', site: '-', risk: 'High', found: true, scannedAt: '2026-09-25T10:00:00Z' },
  { serial: 'S2', brand: '-', asset: '-', found: false, scannedAt: '2026-09-26T10:00:00Z' },
  { serial: '', scannedAt: 'x' }, null, 'junk',
]
describe('tyreScanAnalytics', () => {
  it('normalises junk out of storage', () => {
    const h = normaliseHistory(raw)
    expect(h).toHaveLength(2)
    expect(h[0].site).toBeNull()
    expect(normaliseHistory('bad')).toEqual([])
  })
  it('computes KPIs honestly', () => {
    const h = normaliseHistory(raw)
    expect(scanKpis(h)).toMatchObject({ total: 2, found: 1, notFound: 1, foundRate: 50, atRisk: 1, assets: 1 })
    expect(scanKpis([]).foundRate).toBeNull()
    expect(riskBreakdown(h).High).toBe(1)
    expect(scansByDay(h).map(d => d.day)).toEqual(['2026-09-25', '2026-09-26'])
  })
  it('filters, sorts, links and exports', () => {
    const h = normaliseHistory(raw)
    expect(filterScans(h, { outcome: 'not_found' })).toHaveLength(1)
    expect(filterScans(h, { risk: 'High' })).toHaveLength(1)
    expect(sortScans(h)[0].serial).toBe('S2')
    expect(sortScans(h, 'risk')[0].serial).toBe('S1')
    expect(passportPath('A B/1')).toBe('/tyre-passport/A%20B%2F1')
    expect(scanExportRows(h)[1].outcome).toBe('Not found')
  })
})
