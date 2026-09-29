import { describe, it, expect } from 'vitest'
import {
  extraSourceEvents, buildViewTimeline, filterViewEvents, groupByMonth, spendByCurrency,
  eventDetailFields, extraUnreadable,
} from '../lib/vehicleHistoryView'

const sources = {
  tyre_service: { ok: true, rows: [{ id: 't1', country: 'KSA', event_type: 'rotation', position: 'LHF1', event_date: '2026-08-10', cost: 50, tyre_serial: 'S1' }] },
  gate_pass: { ok: true, rows: [{ id: 'g1', pass_date: '2026-07-02', status: 'Denied', denial_reason: 'Tyre worn' }] },
  handover: { ok: false, rows: [] },
  checkinout: { ok: true, rows: [{ id: 'c1', checked_at: '2026-08-11T09:00:00Z', direction: 'out', driver_name: 'Driver', odometer_km: 1000 }] },
}

describe('extra sources', () => {
  const extra = extraSourceEvents(sources)
  it('maps each source row to one event, with no spend counted', () => {
    expect(extra.map((e) => e.source).sort()).toEqual(['checkinout', 'gate_pass', 'tyre_service'])
    expect(extra.every((e) => e.countsToSpend === false)).toBe(true)
    expect(extra.find((e) => e.source === 'tyre_service').currency).toBe('SAR')
    expect(extra.find((e) => e.source === 'gate_pass').severity).toBe('warn')
  })
  it('names unreadable sources', () => {
    expect(extraUnreadable(sources, { handover: 'Handover reports' })).toEqual(['Handover reports'])
  })
  it('types them in the merged timeline', () => {
    const ev = buildViewTimeline({ timeline: { events: extra }, now: '2026-09-29' })
    expect(ev.map((e) => e.type).sort()).toEqual(['gate', 'handover', 'tyre'])
  })
})

describe('filters, grouping, spend, detail', () => {
  const events = buildViewTimeline({
    timeline: {
      events: [
        { id: 'p1', source: 'parts_line', at: '2026-09-01', atMs: Date.parse('2026-09-01'), day: '2026-09-01', undated: false, title: 'Filter', value: 100, currency: 'SAR', countsToSpend: true, row: { id: 'x', item_description: 'Filter', organisation_id: 'o' } },
        { id: 'p2', source: 'parts_line', at: '2026-08-01', atMs: Date.parse('2026-08-01'), day: '2026-08-01', undated: false, title: 'Oil', value: 40, currency: 'AED', countsToSpend: true, row: {} },
        { id: 'j1', source: 'job_card', at: '2026-08-15', atMs: Date.parse('2026-08-15'), day: '2026-08-15', undated: false, title: 'Repair', value: 999, currency: 'SAR', countsToSpend: false, row: { work_type: 'Repair' } },
        { id: 'u1', source: 'accident', at: null, atMs: null, day: null, undated: true, title: 'Old accident', row: {} },
      ],
    },
    now: '2026-09-29',
  })
  it('filters by date range and several types', () => {
    const r = filterViewEvents(events, { type: 'all', types: ['parts'], from: '2026-08-10', to: '2026-09-30' })
    expect(r.map((e) => e.id)).toEqual(['p1'])
  })
  it('groups by month with undated last', () => {
    const g = groupByMonth(events)
    expect(g.map((x) => x.label)).toEqual(['September 2026', 'August 2026', 'Undated'])
  })
  it('sums spend per currency from grid lines only', () => {
    expect(spendByCurrency(events)).toEqual({ SAR: 100, AED: 40 })
  })
  it('hides internal fields in the detail list', () => {
    const f = eventDetailFields(events.find((e) => e.id === 'p1'))
    expect(f.map((x) => x.key)).toEqual(['item_description'])
  })
})
