import { describe, it, expect } from 'vitest'
import {
  deriveCustody, classifyFitments, newTyreDemand, custodyTimeline, custodySummary, canonSerial, CUSTODY_STATES,
} from '../lib/inventory/tyreCustody'

const row = (over) => ({ country: 'KSA', status: 'Active', removal_date: null, tyre_position: 'LHF1', ...over })

describe('custody states', () => {
  it('active fitment -> fitted at asset + position', () => {
    const { items } = deriveCustody({ records: [row({ id: 1, serial_no: 'YMA55312', asset_no: 'TM400', issue_date: '2026-07-30' })] })
    expect(items[0]).toMatchObject({ custody_state: 'fitted', basis: 'active_fitment', location: { asset_no: 'TM400', position: 'LHF1' } })
  })

  it('removed with no decision is removed_pending, never reusable', () => {
    const { items } = deriveCustody({ records: [row({ serial_no: 'YMA55313', asset_no: 'TM1', status: 'Removed', removal_date: '2026-05-01', issue_date: '2025-01-01' })] })
    expect(items[0]).toMatchObject({ custody_state: 'removed_pending', basis: 'removed_no_decision' })
  })

  it('a recorded disposition after the removal sets the state', () => {
    const records = [row({ serial_no: 'YMA55314', asset_no: 'TM1', status: 'Removed', removal_date: '2026-05-01', issue_date: '2025-01-01' })]
    const { items } = deriveCustody({ records, dispositions: [{ serial: 'yma55314', country: 'KSA', state: 'reusable', decided_at: '2026-05-03' }] })
    expect(items[0].custody_state).toBe('reusable')
    const stale = deriveCustody({ records, dispositions: [{ serial: 'YMA55314', country: 'KSA', state: 'reusable', decided_at: '2026-01-01' }] })
    expect(stale.items[0].custody_state).toBe('removed_pending')
  })

  it('scrap mark on a removed tyre -> scrapped', () => {
    const { items } = deriveCustody({
      records: [row({ serial_no: 'K507B403590', asset_no: 'TM662', status: 'Removed', removal_date: '2026-03-01', issue_date: '2025-01-01' })],
      scrapMarks: [{ serial: 'k507b403590', country: 'KSA', mark_type: 'scrap', created_at: '2026-03-02' }],
    })
    expect(items[0]).toMatchObject({ custody_state: 'scrapped', basis: 'scrap_mark' })
  })

  it('a store holding with no fitment -> its store state', () => {
    const { items } = deriveCustody({ holdings: [{ serial: 'NEW123456', country: 'KSA', custody_state: 'new_stock', location_id: 'L1' }] })
    expect(items[0]).toMatchObject({ custody_state: 'new_stock', location: { location_id: 'L1' } })
  })

  it('serials are matched case and space insensitively per country', () => {
    expect(canonSerial(' k507 b403590 ')).toBe('K507B403590')
    const { items } = deriveCustody({
      records: [
        row({ serial_no: 'k507B403590', asset_no: 'TM662', status: 'Removed', removal_date: '2025-06-01', issue_date: '2025-01-01' }),
        row({ serial_no: 'K507B403590', asset_no: 'TM662', issue_date: '2026-01-01' }),
        row({ serial_no: 'K507B403590', country: 'UAE', asset_no: 'X1', issue_date: '2026-01-01' }),
      ],
    })
    expect(items).toHaveLength(2)
  })
})

describe('conflicts (never auto-resolved)', () => {
  it('scrapped yet active: evidence says the active row was created after the mark', () => {
    const { items, conflicts } = deriveCustody({
      records: [row({ id: 'r9', serial_no: 'YMN50625', asset_no: 'TM635', issue_date: '2026-09-01', created_at: '2026-10-05' })],
      scrapMarks: [{ serial: 'YMN50625', country: 'KSA', mark_type: 'scrap', created_at: '2026-09-15', reason: null }],
    })
    expect(items[0].custody_state).toBe('unknown')
    expect(items[0].basis).toBe('conflict')
    expect(conflicts[0].type).toBe('scrapped_but_active')
    expect(conflicts[0].evidence.activeRows[0]).toMatchObject({ id: 'r9', createdAfterScrapMark: true })
  })

  it('fitted and in stock', () => {
    const { conflicts } = deriveCustody({
      records: [row({ serial_no: 'ABC123456', asset_no: 'TM1', issue_date: '2026-01-01' })],
      holdings: [{ serial: 'ABC123456', country: 'KSA', custody_state: 'new_stock', location_id: 'L1' }],
    })
    expect(conflicts.map((c) => c.type)).toEqual(['fitted_and_in_stock'])
  })

  it('serial active on two assets', () => {
    const { items, conflicts } = deriveCustody({
      records: [
        row({ serial_no: 'DUP1234567', asset_no: 'TM1', issue_date: '2026-01-01' }),
        row({ serial_no: 'DUP1234567', asset_no: 'TM2', issue_date: '2026-02-01' }),
      ],
    })
    expect(conflicts[0].type).toBe('serial_on_two_assets')
    expect(conflicts[0].evidence.assets).toEqual(['TM1', 'TM2'])
    expect(items[0].conflicts).toHaveLength(1)
  })

  it('weak serials are a backlog, not items', () => {
    const r = deriveCustody({ records: [row({ id: 'w', serial_no: 'NO SERIAL', asset_no: 'TM1' }), row({ serial_no: 'DOT18E56', asset_no: 'TM1' }), row({ serial_no: '315/80R22.5', asset_no: 'TM1' })] })
    expect(r.items).toHaveLength(0)
    expect(r.weakSerialRows).toBe(3)
    expect(r.weakSerialSample[0].id).toBe('w')
  })
})

describe('reuse is not a purchase', () => {
  const records = [
    row({ serial_no: 'REU1234567', asset_no: 'TM1', status: 'Removed', removal_date: '2025-06-01', issue_date: '2025-01-01', cost_per_tyre: 900 }),
    row({ serial_no: 'REU1234567', asset_no: 'TM2', issue_date: '2026-02-01', cost_per_tyre: 900 }),
    row({ serial_no: 'NEW7654321', asset_no: 'TM3', issue_date: '2026-03-01', cost_per_tyre: 1000 }),
    row({ serial_no: 'NO SERIAL', asset_no: 'TM4', issue_date: '2026-03-01' }),
  ]
  it('tags first fit vs refit and flags a refit that still carries a price', () => {
    const t = classifyFitments(records)
    expect(t.map((r) => r.fitKind)).toEqual(['first_fit', 'refit', 'first_fit', 'untracked'])
    expect(t[1].refitCarriesPrice).toBe(true)
    expect(t[0].refitCarriesPrice).toBe(false)
  })
  it('new-tyre demand counts first fits only', () => {
    expect(newTyreDemand(records, { from: '2026-01-01', to: '2026-12-31' })).toMatchObject({ firstFits: 1, refits: 1, untrackedFits: 1 })
  })
})

describe('holding period is not running life', () => {
  it('splits fitted days from store holding days', () => {
    const t = custodyTimeline([
      { state: 'fitted', at: '2026-03-01', asset_no: 'TM1' },
      { state: 'new_stock', at: '2026-01-01', location_id: 'L1' },
      { state: 'reusable', at: '2026-05-01' },
    ], { now: '2026-06-01' })
    expect(t.segments.map((s) => s.state)).toEqual(['new_stock', 'fitted', 'reusable'])
    expect(t.fittedDays).toBe(61)
    expect(t.holdingDays).toBe(59 + 31)
    expect(t.segments[1].countsAsRunningLife).toBe(true)
    expect(t.segments[0].countsAsRunningLife).toBe(false)
    expect(t.note).toMatch(/not running life/)
  })
})

describe('summary', () => {
  it('counts by state and conflict', () => {
    const d = deriveCustody({
      records: [row({ serial_no: 'AAA1234567', asset_no: 'TM1' }), row({ serial_no: 'BBB1234567', asset_no: 'TM2', status: 'Removed', removal_date: '2026-01-01' })],
      scrapMarks: [{ serial: 'AAA1234567', country: 'KSA', mark_type: 'scrap' }],
    })
    const s = custodySummary(d)
    expect(s.byState.unknown).toBe(1)
    expect(s.byState.removed_pending).toBe(1)
    expect(s.byConflict.scrapped_but_active).toBe(1)
    expect(Object.keys(s.byState)).toEqual(CUSTODY_STATES)
  })
})
