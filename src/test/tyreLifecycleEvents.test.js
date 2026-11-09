import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildLifecycleEvents, countLifecycleEvents, describeLifecycleEvent,
  EVENT_TYPES, AMBIGUOUS_REASONS, EVENT_TYPE_LABEL, AMBIGUOUS_REASON_LABEL,
} from '../lib/tyreLifecycleEvents'

const fit = (o) => ({ country: 'KSA', vehicle_type: 'TRUCK', qty: 1, status: 'Removed', serial_no: 'YMA55310', ...o })
const types = (evs) => evs.map((e) => e.event_type)

describe('tyre lifecycle events', () => {
  it('rotation: same vehicle, another position, never a purchase', () => {
    const evs = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 1000, km_at_removal: 11000, cost_per_tyre: 900 }),
      fit({ id: 'b', asset_no: 'tm1 ', tyre_position: 'RHF1', issue_date: '2025-03-01', removal_date: '2025-06-01', km_at_fitment: 11000, km_at_removal: 21000 }),
    ] })
    expect(types(evs)).toEqual(['FIT', 'REMOVAL', 'ROTATION', 'REMOVAL'])
    const rot = evs[2]
    expect(rot.from_position).toBe('LHF1')
    expect(rot.position).toBe('RHF1')
    expect(rot.is_purchase).toBe(false)
    expect(evs.filter((e) => e.is_purchase)).toHaveLength(1)
    expect(evs[0].is_purchase).toBe(true)
    expect(evs[1].km).toBe(10000)
    expect(evs.map((e) => e.event_seq)).toEqual([1, 2, 3, 4])
  })

  it('transfer to another vehicle keeps the same physical tyre', () => {
    const evs = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 900 }),
      fit({ id: 'b', asset_no: 'TM2', tyre_position: 'LHF1', issue_date: '2025-04-01', removal_date: '2025-08-01', km_at_fitment: 200000, km_at_removal: 225000, cost_per_tyre: 900 }),
    ] })
    const tr = evs.find((e) => e.event_type === 'TRANSFER')
    expect(tr.from_asset_no).toBe('TM1')
    expect(tr.asset_no).toBe('TM2')
    expect(tr.is_purchase).toBe(false) // priced twice on the rows, still one purchase
    expect(new Set(evs.map((e) => e.tyre_key))).toEqual(new Set(['KSA|YMA55310']))
  })

  it('return to store is inferred only from a refit after a gap', () => {
    const evs = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'MP091', tyre_position: 'LHR1-O', issue_date: '2025-08-05', removal_date: '2026-07-02', km_at_fitment: 1000, km_at_removal: 19349 }),
      fit({ id: 'b', asset_no: 'TM424', tyre_position: 'LHCI', issue_date: '2026-07-14', removal_date: '2026-08-18', km_at_fitment: 5000, km_at_removal: 9192 }),
    ] })
    expect(types(evs)).toEqual(['FIT', 'REMOVAL', 'RETURN_TO_STORE', 'TRANSFER', 'REMOVAL'])
    expect(evs[2].detail).toBe('inferred: off a vehicle 12 day(s) before refit')
    expect(evs[2].from_asset_no).toBe('MP091')
    // removed with no later fitment: no evidence it went to store
    const solo = buildLifecycleEvents({ fitments: [fit({ id: 'x', serial_no: 'ZZ123456', asset_no: 'TM9', issue_date: '2025-01-01', removal_date: '2025-02-01' })] })
    expect(types(solo)).toEqual(['FIT', 'REMOVAL'])
  })

  it('refit on the same vehicle and position', () => {
    const evs = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-02-01' }),
      fit({ id: 'b', asset_no: 'TM1', tyre_position: 'lhf1', issue_date: '2025-02-01', status: 'Active' }),
    ] })
    expect(types(evs)).toEqual(['FIT', 'REMOVAL', 'REFIT_SAME_VEHICLE'])
    expect(evs[0].is_purchase).toBe(false) // never priced
  })

  it('a price recorded on a later row is still a purchase at the FIT only', () => {
    const evs = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-02-01' }),
      fit({ id: 'b', asset_no: 'TM2', tyre_position: 'LHF1', issue_date: '2025-03-01', cost_per_tyre: 800 }),
    ] })
    expect(evs[0].is_purchase).toBe(true)
    expect(evs[0].detail).toBe('purchase price is recorded on a later fitment row (b)')
    expect(evs.find((e) => e.event_type === 'TRANSFER').is_purchase).toBe(false)
  })

  it('overlaps are AMBIGUOUS with the reason, never resolved', () => {
    const open = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', serial_no: 'FC42629DX', status: 'Active', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2026-04-01', km_at_fitment: 94317 }),
      fit({ id: 'b', serial_no: 'FC42629DX', status: 'Active', asset_no: 'TM1', tyre_position: 'RHF1', issue_date: '2026-05-01', km_at_fitment: 95000 }),
    ] })
    expect(types(open)).toEqual(['FIT', 'AMBIGUOUS'])
    expect(open[1].ambiguous_reason).toBe('earlier_fitment_still_open')

    const over = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', serial_no: 'A208575333', asset_no: 'TM475', tyre_position: 'LHF1', issue_date: '2025-09-08', removal_date: '2026-03-26', km_at_fitment: 100679, km_at_removal: 114443 }),
      fit({ id: 'b', serial_no: 'A208575333', asset_no: 'TM475', tyre_position: 'LHF1', issue_date: '2025-09-09', removal_date: '2026-08-26', km_at_fitment: 100680, km_at_removal: 122741 }),
    ] })
    const amb = over.find((e) => e.event_type === 'AMBIGUOUS')
    expect(amb.ambiguous_reason).toBe('overlaps_earlier_fitment')
    const secondRemoval = over.filter((e) => e.event_type === 'REMOVAL')[1]
    expect(secondRemoval.detail).toBe('km not counted in life: overlaps an earlier fitment')

    const same = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-01-01' }),
      fit({ id: 'b', asset_no: 'TM2', tyre_position: 'LHF1', issue_date: '2025-01-01' }),
    ] })
    expect(same.find((e) => e.event_type === 'AMBIGUOUS').ambiguous_reason).toBe('same_day_double_entry')

    const noVeh = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-01-05' }),
      fit({ id: 'b', asset_no: null, issue_date: '2025-02-01' }),
    ] })
    expect(noVeh.find((e) => e.event_type === 'AMBIGUOUS').ambiguous_reason).toBe('vehicle_not_recorded')
  })

  it('retread, warranty replacement, scrap and disposal', () => {
    const evs = buildLifecycleEvents({
      fitments: [fit({ id: 'r1', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-06-01', status: 'Scrapped' })],
      retreadJobs: [{ id: 'j1', casing_serial: 'yma55310', country: 'KSA', sent_at: '2025-06-10', returned_at: '2025-07-01', vendor_name: 'Vendor A', status: 'returned' }],
      warrantyClaims: [
        { id: 'w1', serial_number: 'YMA55310', country: 'KSA', claim_status: 'Credit Issued', credit_date: '2025-08-01', claim_no: 'WC-1' },
        { id: 'w2', serial_number: 'YMA55310', country: 'KSA', claim_status: 'Rejected', decision_date: '2025-08-02', rejection_reason: 'wear' },
      ],
      marks: [{ id: 'm1', serial: 'YMA55310', country: 'KSA', mark_type: 'scrap', created_at: '2025-09-01T10:00:00Z', reason: 'cut' }],
      disposals: [{ tyre_record_id: 'r1', disposed_on: '2025-10-01', disposal_method: 'Recycle' }],
    })
    expect(types(evs)).toEqual(['FIT', 'REMOVAL', 'RETREAD', 'WARRANTY_REPLACEMENT', 'SCRAP', 'DISPOSAL'])
    // the Scrapped status row is not a second scrap when a mark exists
    expect(evs.filter((e) => e.event_type === 'SCRAP')).toHaveLength(1)
    expect(evs.find((e) => e.event_type === 'SCRAP').source_table).toBe('tyre_status_marks')

    const noMark = buildLifecycleEvents({ fitments: [fit({ id: 'r2', serial_no: 'QQ998877', removal_date: '2025-06-01', issue_date: '2025-01-01', status: 'Scrapped' })] })
    const sc = noMark.find((e) => e.event_type === 'SCRAP')
    expect(sc.detail).toBe('status Scrapped, no scrap mark')
    expect(sc.event_date).toBe('2025-06-01')
  })

  it('a weak serial is its own tyre and a system-closed removal is annotated', () => {
    const evs = buildLifecycleEvents({
      fitments: [
        fit({ id: 'w1', serial_no: 'DOT1234', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-02-01' }),
        fit({ id: 'w2', serial_no: 'DOT1234', asset_no: 'TM2', issue_date: '2025-03-01' }),
      ],
      replacementLog: [{ id: 7, tyre_id: 'w1', source: 'serial_two_vehicles_cleanup', undone_at: null }],
    })
    expect(new Set(evs.map((e) => e.tyre_key))).toEqual(new Set(['row:w1', 'row:w2']))
    expect(evs.filter((e) => e.event_type === 'FIT')).toHaveLength(2)
    expect(evs.find((e) => e.event_type === 'REMOVAL').detail).toBe('closed by system reconcile (serial_two_vehicles_cleanup, log 7)')
  })

  it('counts and descriptions', () => {
    const evs = buildLifecycleEvents({ fitments: [
      fit({ id: 'a', asset_no: 'TM1', tyre_position: 'LHF1', issue_date: '2025-01-01', removal_date: '2025-04-01' }),
      fit({ id: 'b', asset_no: 'TM2', tyre_position: 'RHF1', issue_date: '2025-04-01' }),
    ] })
    expect(countLifecycleEvents(evs).byType).toEqual({ FIT: 1, REMOVAL: 1, TRANSFER: 1 })
    expect(describeLifecycleEvent(evs[2])).toBe('Moved to another vehicle: TM1 / LHF1 to TM2 / RHF1')
    for (const t of EVENT_TYPES) expect(EVENT_TYPE_LABEL[t]).toBeTruthy()
    for (const r of AMBIGUOUS_REASONS) expect(AMBIGUOUS_REASON_LABEL[r]).toBeTruthy()
    const labels = [...Object.values(EVENT_TYPE_LABEL), ...Object.values(AMBIGUOUS_REASON_LABEL)].join(' ')
    expect(labels).not.toMatch(/[–—]/)
  })

  it('SQL mirror: the migration carries the same event and reason vocabulary', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261110100000_tyre_lifecycle_events.sql'), 'utf8')
    for (const t of EVENT_TYPES) expect(sql).toContain(`'${t}'`)
    for (const r of AMBIGUOUS_REASONS) expect(sql).toContain(`'${r}'`)
    expect(sql).toContain('v_tyre_lifetime_fitments')
    expect(sql).toContain("(e.fit_seq = 1 and e.tyre_priced) as is_purchase")
    expect(sql).toContain("'inferred: off a vehicle '")
    expect(sql).toContain("'status Scrapped, no scrap mark'")
    expect(sql).toContain("in ('Approved', 'Credit Issued', 'Closed')")
    expect(sql).toMatch(/security invoker/)
    expect(sql).toMatch(/revoke all on function public\.get_tyre_lifecycle_events\(text, text\) from public, anon/)
  })
})
