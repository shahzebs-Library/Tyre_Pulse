import { describe, it, expect } from 'vitest'
import { KPI_CATALOGUE } from '../lib/inventory/kpi'
import {
  PANEL_KPI_IDS, SHOWN_ON_OVERVIEW, KPI_SOURCES, KPI_PERIOD, computeKpiPanel, kpiDisplay, monthEndSnapshots,
  classifyForScreen, KPI_EMPTY_KEYS, toValuationRows,
} from '../lib/inventory/kpiPanel'
import en from '../locales/en/inventory.json'
import { populatedSources, emptySources, NOW } from './fixtures/inventoryKpiSources'

const range = { from: '2025-11-21', to: '2026-11-21' }

describe('KPI panel catalogue coverage', () => {
  it('shows exactly the 23 catalogue KPIs not already on the Overview', () => {
    expect(PANEL_KPI_IDS).toHaveLength(23)
    expect(new Set([...PANEL_KPI_IDS, ...SHOWN_ON_OVERVIEW])).toEqual(new Set(KPI_CATALOGUE.map((k) => k.id)))
    for (const id of PANEL_KPI_IDS) {
      expect(KPI_SOURCES[id], id).toBeDefined()
      expect(KPI_PERIOD[id], id).toBeDefined()
      expect(typeof en.kpis.items[id]?.label, id).toBe('string')
      expect(typeof en.kpis.items[id]?.def, id).toBe('string')
    }
    for (const k of KPI_EMPTY_KEYS) expect(typeof en.kpis.empty[k], k).toBe('string')
  })
})

describe('computeKpiPanel', () => {
  it('feeds the engines from real rows', () => {
    const p = computeKpiPanel(populatedSources(), { now: NOW, ...range })
    expect(p.inv_critical_availability.result.value).toBe(100)
    expect(p.inv_stockout_frequency.result.value).toBeCloseTo(14.29, 1) // 1 shortage of 7 requests
    expect(p.inv_reserved_not_issued.result.value).toBe(2)
    expect(p.inv_accuracy_exact_line.result.value).toBe(0)
    expect(p.inv_gross_shortage.result.value).toBe(1)
    expect(p.inv_gross_shortage.result.byCurrency.SAR.value).toBe(100)
    expect(p.inv_count_completion.result.value).toBe(100)
    expect(p.inv_accuracy_serial.empty).toBe('noSerialCount')
    expect(p.inv_unvalued_stock.result.value).toBe(1)
    expect(p.inv_adjustment_value.result.value).toBe(50)
    expect(p.inv_turnover.result.value).not.toBeNull()
    expect(p.inv_obsolescence_exposure.result.reason).toBe('value_incomplete')
    expect(p.inv_supplier_otif.result.value).toBe(0) // received early but not in full
    expect(p.inv_lead_time_variance.result.value).toBe(3) // 8 actual - 5 agreed
    expect(p.inv_outstanding_po_qty.result.value).toBe(6)
    expect(p.inv_emergency_purchase_rate.result.value).toBe(100)
    expect(p.inv_consignment_utilisation.result.value).toBe(0.5)
    expect(p.inv_purchase_avoidance.result.value).toBeNull()
    expect(p.inv_purchase_avoidance.empty).toBe('fulfilmentNotRecorded')
    for (const id of PANEL_KPI_IDS) expect(p[id].status, id).toBe('ok')
  })

  it('never fabricates a figure when every source is empty', () => {
    const p = computeKpiPanel(emptySources(), { now: NOW, ...range })
    // Every tile names its empty source; the screen shows that sentence instead of the
    // engine's figure (an engine 0 over no rows is never rendered).
    for (const id of PANEL_KPI_IDS) expect(p[id].empty, id).toBeTruthy()
  })

  it('reports a failed or missing source on the KPIs that read it', () => {
    const s = emptySources()
    s.orders = { status: 'error', rows: [], error: 'Network error' }
    s.reservations = { status: 'not_provisioned', rows: [] }
    const p = computeKpiPanel(s, { now: NOW, ...range })
    expect(p.inv_supplier_otif.status).toBe('error')
    expect(p.inv_reserved_not_issued.status).toBe('not_provisioned')
    expect(p.inv_critical_availability.status).toBe('ok')
  })
})

describe('kpiDisplay', () => {
  it('never sums currencies', () => {
    const d = kpiDisplay('inv_dead_stock', { value: null, unit: 'currency', reason: 'mixed_currency', byCurrency: { SAR: { value: 10 }, AED: { value: 5 } } })
    expect(d.primary).toBeNull()
    expect(d.perCurrency.map((c) => c.text)).toEqual(['SAR 10.00', 'AED 5.00'])
  })
  it('hides money without view value but keeps quantities', () => {
    const d = kpiDisplay('inv_gross_shortage', { value: 3, unit: 'qty', byCurrency: { SAR: { value: 30 } } }, { canValue: false })
    expect(d.primary).toBe('3')
    expect(d.perCurrency).toEqual([])
  })
})

describe('month-end reconstruction', () => {
  it('marks month ends before the ledger began as incomplete', () => {
    const v = toValuationRows([{ stock_id: 's', currency: 'SAR', ownership: 'owned', valued_qty: 1, unvalued_qty: 0, valued_value: 100 }])
    const snaps = monthEndSnapshots(v, [{ currency: 'SAR', ownership: 'owned', value_change: 40, posted_at: '2026-11-02T00:00:00Z' }], { now: NOW, ledgerStartAt: '2026-09-15T00:00:00Z' })
    const complete = snaps.filter((s) => s.complete)
    expect(complete).toHaveLength(2) // Sep and Oct month ends
    expect(complete.every((s) => s.value === 60)).toBe(true)
  })
})

describe('classifyForScreen', () => {
  it('classifies on all three axes and never pushes unknowns into C, N or D', () => {
    const { rows, counts } = classifyForScreen(populatedSources(), { now: NOW })
    const byCode = Object.fromEntries(rows.map((r) => [r.item_code, r]))
    expect(byCode['P-1'].abc).toBe('A')
    expect(byCode['P-1'].fsn).toBe('F')
    expect(byCode['P-1'].ved).toBe('V')
    expect(byCode['P-2'].ved).toBe('unassessed')
    expect(byCode['P-2'].abc).toBe('C')
    expect(byCode['P-3']).toBeUndefined() // consignment stock is not owned
    expect(counts.ved.V).toBe(1)
  })
})
