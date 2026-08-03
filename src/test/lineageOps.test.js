import { describe, it, expect } from 'vitest'
import {
  shapeGraph, shapeImpact, alertSummary, assetShortName, assetKindLabel, ALERT_STATUSES,
} from '../lib/lineageOps'
import { newTraceId, shortTrace } from '../lib/traceId'

const GRAPH = {
  ok: true,
  root: 'metric:fleet_cpk',
  nodes: [
    { asset_id: 'table:tyre_records', kind: 'table', name: 'tyre_records' },
    { asset_id: 'metric:fleet_cpk', kind: 'metric', name: 'Fleet Cost Per Km' },
    { asset_id: 'dashboard:Engineering KPI', kind: 'dashboard', name: 'Engineering KPI' },
  ],
  edges: [
    { from: 'table:tyre_records', to: 'metric:fleet_cpk', type: 'feeds' },
    { from: 'metric:fleet_cpk', to: 'dashboard:Engineering KPI', type: 'renders' },
  ],
}

describe('shapeGraph', () => {
  it('splits upstream vs downstream around the root', () => {
    const g = shapeGraph(GRAPH)
    expect(g.root).toBe('metric:fleet_cpk')
    expect(g.upstream.map((n) => n.assetId)).toContain('table:tyre_records')
    expect(g.downstream.map((n) => n.assetId)).toContain('dashboard:Engineering KPI')
    expect(g.byKind).toMatchObject({ table: 1, metric: 1, dashboard: 1 })
  })
  it('honest empty on !ok', () => {
    expect(shapeGraph({ ok: false }).nodes).toEqual([])
    expect(shapeGraph(null).downstream).toEqual([])
  })
})

describe('shapeImpact', () => {
  it('lists impacted assets and total', () => {
    const i = shapeImpact({ ok: true, asset: 'table:tyre_records', impacted: [
      { asset_id: 'metric:fleet_cpk', kind: 'metric', name: 'Fleet CPK' },
      { asset_id: 'dashboard:Engineering KPI', kind: 'dashboard', name: 'Engineering KPI' },
    ], counts: { metric: 1, dashboard: 1 } })
    expect(i.total).toBe(2)
    expect(i.counts).toMatchObject({ metric: 1, dashboard: 1 })
  })
  it('honest empty', () => { expect(shapeImpact({ ok: false }).total).toBe(0) })
})

describe('alertSummary + helpers', () => {
  it('counts open alerts by source', () => {
    const s = alertSummary([
      { source: 'quality', status: 'open' },
      { source: 'reconciliation', status: 'open' },
      { source: 'quality', status: 'resolved' },
    ])
    expect(s).toMatchObject({ total: 3, open: 2, quality: 1, reconciliation: 1 })
  })
  it('assetShortName strips the kind prefix', () => {
    expect(assetShortName('table:tyre_records')).toBe('tyre_records')
    expect(assetKindLabel('dashboard')).toBe('Dashboard')
    expect(ALERT_STATUSES).toContain('open')
  })
})

describe('traceId', () => {
  it('makes prefixed ids and shortens them', () => {
    const id = newTraceId('scan')
    expect(id.startsWith('scan_')).toBe(true)
    expect(shortTrace('abcdefghijklmnop').length).toBe(12)
  })
})
