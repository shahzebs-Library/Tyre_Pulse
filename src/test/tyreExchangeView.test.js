import { describe, it, expect } from 'vitest'
import {
  deriveExchanges, filterExchanges, exchangeKpis, typeSegments, exchangeOptions,
  summaryWindow, shiftRange, buildExchangePayload, currentTyreAt, registerExportRows, assetChoices,
  serialWarnings, isExchangeEvent, movementFlow, registerSerials,
} from '../lib/tyreExchangeView'

const R = (o) => ({ status: 'Active', site: 'NHC', ...o })
const recs = [
  R({ id: 1, serial_no: 'A1', asset_no: 'tm1', position: 'LHF1', issue_date: '2026-01-05', status: 'Removed', removal_date: '2026-03-01' }),
  R({ id: 2, serial_no: 'B2', asset_no: 'TM1', position: 'LHF1', issue_date: '2026-03-01' }),
  R({ id: 3, serial_no: 'A1', asset_no: 'TM2', position: 'RHF1', issue_date: '2026-03-10', category: 'Retread' }),
  R({ id: 4, serial_no: 'C3', asset_no: 'TM2', position: 'LHF1', issue_date: '2026-02-01' }),
  R({ id: 5, serial_no: 'C3', asset_no: 'TM2', position: 'RHF2', issue_date: '2026-04-01', site: 'JED' }),
  R({ id: 6, serial_no: 'D4', asset_no: 'TM3', position: 'LHF1', issue_date: '2026-02-01', status: 'Removed', removal_date: '2026-05-01' }),
]

describe('tyreExchangeView', () => {
  const ev = deriveExchanges(recs)
  const byRec = (id, type) => ev.find((e) => e.recordId === id && (!type || e.type === type))

  it('classifies fitting, replacement, transfer, interchange and removal', () => {
    expect(byRec(1).type).toBe('Fitting')
    expect(byRec(1).installedKind).toBe('New')
    expect(byRec(2).type).toBe('Replacement')
    expect(byRec(2).removed.serial).toBe('A1')
    expect(byRec(3).type).toBe('Transfer')
    expect(byRec(3).from.asset).toBe('TM1')
    expect(byRec(3).installedKind).toBe('Retreaded')
    expect(byRec(5).type).toBe('Interchange')
    expect(byRec(5).from.position).toBe('LHF1')
    expect(byRec(6, 'Removal').date).toBe('2026-05-01')
    // A1 left TM1 LHF1 but B2 was fitted there, so no separate removal event.
    expect(ev.filter((e) => e.type === 'Removal' && e.recordId === 1)).toHaveLength(0)
  })

  it('sorts newest first and counts kpis', () => {
    expect(ev[0].date).toBe('2026-05-01')
    const k = exchangeKpis(ev)
    expect(k.total).toBe(ev.length)
    expect(k.transfers).toBe(1)
    expect(k.retreadFitted).toBe(1)
    expect(k.fittings).toBe(ev.length - 1)
    expect(typeSegments(ev).reduce((s, x) => s + x.count, 0)).toBe(ev.length)
  })

  it('filters by dates, type and search', () => {
    expect(filterExchanges(ev, { from: '2026-03-01', to: '2026-03-31' })).toHaveLength(2)
    expect(filterExchanges(ev, { type: 'Transfer' })).toHaveLength(1)
    expect(filterExchanges(ev, { search: 'b2' })).toHaveLength(1)
    expect(exchangeOptions(ev).sites).toEqual(['JED', 'NHC'])
  })

  it('builds windows and shifts ranges', () => {
    const now = new Date(2026, 8, 29)
    expect(summaryWindow('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-29' })
    expect(summaryWindow('week', now).from).toBe('2026-09-23')
    expect(shiftRange({ from: '2026-09-01', to: '2026-09-10' }, -1)).toEqual({ from: '2026-08-22', to: '2026-08-31' })
  })

  it('validates and builds the service event payload', () => {
    expect(buildExchangePayload({}).ok).toBe(false)
    const res = buildExchangePayload({ type: 'Replacement', asset: 'tm1', position: 'lhf1', installedSerial: 'X9', removedSerial: 'B2', installedKind: 'New' }, { country: 'KSA', today: '2026-09-29' })
    expect(res.ok).toBe(true)
    expect(res.payload).toMatchObject({ event_type: 'replacement', tyre_serial: 'X9', asset_no: 'TM1', position: 'LHF1', event_date: '2026-09-29', country: 'KSA' })
    expect(res.payload.notes).toContain('Removed tyre B2')
    expect(buildExchangePayload({ type: 'Transfer', asset: 'TM1', position: 'LHF1', installedSerial: 'X' }).ok).toBe(false)
    expect(buildExchangePayload({ type: 'Interchange', asset: 'TM1', position: 'LHF1', removedSerial: 'X', toPosition: 'RHF1' }, { country: 'All' }).payload.country).toBeNull()
  })

  it('finds the current tyre and export rows without inventing values', () => {
    expect(currentTyreAt(recs, 'TM1', 'LHF1').serial).toBe('B2')
    expect(currentTyreAt(recs, 'TM9', 'LHF1')).toBeNull()
    const rows = registerExportRows([{ type: 'Fitting', date: null }])
    expect(rows[0].removedSerial).toBe('N/A')
    expect(assetChoices(recs).map((a) => a.asset)).toEqual(['TM1', 'TM2', 'TM3'])
  })

  it('counts two unserialised fitments on one position as a replacement', () => {
    const ev = deriveExchanges([
      R({ id: 'x1', asset_no: 'TM9', tyre_position: 'LHF1', issue_date: '2026-01-01' }),
      R({ id: 'x2', asset_no: 'TM9', tyre_position: 'LHF1', issue_date: '2026-02-01' }),
    ])
    const later = ev.find((e) => e.recordId === 'x2')
    expect(later.type).toBe('Replacement')
    expect(later.removed).not.toBeNull()
  })

  it('refuses a future date, a self transfer, a same slot interchange and the same tyre in and out', () => {
    const base = { asset: 'TM1', position: 'LHF1', installedSerial: 'Z9' }
    const today = '2026-09-29'
    expect(buildExchangePayload({ ...base, type: 'Replacement', date: '2026-10-01' }, { today }).errors)
      .toContain('The exchange date cannot be in the future.')
    expect(buildExchangePayload({ ...base, type: 'Transfer', toAsset: 'tm1' }, { today }).errors)
      .toContain('A transfer must move the tyre to a different vehicle.')
    expect(buildExchangePayload({ ...base, type: 'Interchange', toPosition: 'lhf1' }, { today }).errors)
      .toContain('Choose a different position to move the tyre to.')
    expect(buildExchangePayload({ ...base, type: 'Replacement', removedSerial: 'z9' }, { today }).errors)
      .toContain('The installed tyre must be a different tyre from the removed one.')
    expect(buildExchangePayload({ ...base, type: 'Replacement', date: '2026-09-29' }, { today }).ok).toBe(true)
  })

  it('warns, without blocking, when serials do not match the register', () => {
    const w = serialWarnings({ asset: 'TM1', position: 'LHF1', removedSerial: 'A1', installedSerial: 'NOPE', installedKind: 'Used' }, recs)
    expect(w.some((x) => x.includes('NOPE'))).toBe(true)
    expect(w.some((x) => x.includes('B2 on TM1 LHF1'))).toBe(true)
    expect(serialWarnings({ asset: 'TM1', position: 'LHF1', removedSerial: 'B2', installedSerial: 'NEW1', installedKind: 'New' }, recs)).toEqual([])
    expect(serialWarnings({ installedSerial: 'B2', installedKind: 'New' }, recs)[0]).toContain('may not be new')
    expect(registerSerials(recs).has('A1')).toBe(true)
  })

  it('keeps only exchange events in the recent list', () => {
    expect(isExchangeEvent({ event_type: 'replacement' })).toBe(true)
    expect(isExchangeEvent({ event_type: 'rotation' })).toBe(true)
    expect(isExchangeEvent({ event_type: 'other', notes: 'Transfer. Moved from TM1' })).toBe(true)
    expect(isExchangeEvent({ event_type: 'other', notes: 'Valve replaced' })).toBe(false)
    expect(isExchangeEvent({ event_type: 'inflation' })).toBe(false)
  })

  it('builds the movement flow for each type', () => {
    expect(movementFlow(null)).toBeNull()
    const rem = movementFlow({ type: 'Removal', from: { asset: 'TM1' }, removed: { serial: 'A' } })
    expect(rem.to).toBeNull()
    const fit = movementFlow({ type: 'Fitting', removed: null, to: { asset: 'TM1' }, installed: { serial: 'B' } })
    expect(fit.from).toBeNull()
    expect(fit.toTyre.serial).toBe('B')
  })
})
