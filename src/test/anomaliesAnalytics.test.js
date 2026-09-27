import { describe, it, expect } from 'vitest'
import {
  DATA_QUALITY, detectDataQuality, filterAnomalies, groupAnomalies, siteOptions,
  anomalyKpis, visitSummary, filterVisits, anomalyExportRows, visitExportRows,
} from '../lib/anomaliesAnalytics'

const anomalies = [
  { id: 'a', type: 'SHORT_INTERVAL', severity: 'high', asset_no: 'TM1', site: 'NHC', message: 'Replaced twice', records: [{ serial_no: 'S1' }] },
  { id: 'b', type: 'COST_SPIKE', severity: 'medium', asset_no: 'TM2', site: 'JED', message: 'Cost spike', records: [] },
  { id: 'c', type: 'SHORT_INTERVAL', severity: 'high', asset_no: 'TM1', site: 'NHC', message: 'Again', records: [] },
  { id: 'd', type: DATA_QUALITY, severity: 'low', asset_no: 'N/A', site: 'N/A', message: 'Missing cost', records: [] },
]

describe('anomaliesAnalytics', () => {
  it('flags records missing cost, date or asset', () => {
    const out = detectDataQuality([
      { id: 1, cost_per_tyre: 100, issue_date: '2026-01-01', asset_no: 'A' },
      { id: 2, cost_per_tyre: null, issue_date: null, asset_no: 'B', brand: 'X', serial_no: 'S9' },
      { id: 3, cost_per_tyre: 0, issue_date: '2026-01-01', asset_no: null },
    ])
    expect(out.map((a) => a.id)).toEqual(['DQ::2', 'DQ::3'])
    expect(out[0].message).toContain('cost, issue date')
    expect(out[0].detail).toBe('X | serial S9')
    expect(out[1].asset_no).toBe('N/A')
  })

  it('filters by type, severity, site and search including records', () => {
    expect(filterAnomalies(anomalies, { severity: 'high' })).toHaveLength(2)
    expect(filterAnomalies(anomalies, { site: 'JED' }).map((a) => a.id)).toEqual(['b'])
    expect(filterAnomalies(anomalies, { search: 's1' }).map((a) => a.id)).toEqual(['a'])
    expect(filterAnomalies(anomalies, { type: DATA_QUALITY }).map((a) => a.id)).toEqual(['d'])
  })

  it('groups in stable detector order', () => {
    const g = groupAnomalies(anomalies, { COST_SPIKE: 'desc' })
    expect(g.map((x) => x.type)).toEqual(['SHORT_INTERVAL', 'COST_SPIKE', DATA_QUALITY])
    expect(g[1].desc).toBe('desc')
    expect(g[0].items).toHaveLength(2)
    expect(siteOptions(anomalies)).toEqual(['JED', 'N/A', 'NHC'])
  })

  it('builds KPIs with hotspot and nulls for empty sets', () => {
    const k = anomalyKpis(anomalies)
    expect(k.total).toBe(4)
    expect(k.bySeverity.high).toBe(2)
    expect(k.affectedAssets).toBe(2)
    expect(k.affectedSites).toBe(2)
    expect(k.hotSite).toBe('NHC')
    expect(k.hotSiteHigh).toBe(2)
    expect(k.highShare).toBe(50)
    expect(k.dataQuality).toBe(1)
    expect(k.ruleFindings).toBe(3)
    const e = anomalyKpis([])
    expect(e.highShare).toBeNull()
    expect(e.hotSite).toBeNull()
  })

  it('summarises and filters workshop visits', () => {
    const stats = [
      { asset_no: 'TM1', site: 'NHC', total: 6, last7: 1, last30: 2, peak90: 4 },
      { asset_no: 'TM2', site: 'JED', total: 2, last7: 0, last30: 1, peak90: 1 },
    ]
    const v = visitSummary(stats)
    expect(v).toMatchObject({ totalVisits: 8, thisWeek: 1, thisMonth: 3, assets: 2, repeatAssets: 1, avgPerAsset: 4 })
    expect(v.busiest.asset_no).toBe('TM1')
    expect(visitSummary([]).avgPerAsset).toBeNull()
    expect(filterVisits(stats, { site: 'JED' })).toHaveLength(1)
    expect(filterVisits(stats, { search: 'tm1' })).toHaveLength(1)
  })

  it('exports flat rows', () => {
    expect(anomalyExportRows(anomalies)[0]).toMatchObject({ type: 'Short Interval', records: 1 })
    expect(visitExportRows([{ asset_no: 'X' }])[0]).toMatchObject({ last_visit: 'N/A', country: 'Not recorded', total: 0 })
  })
})
