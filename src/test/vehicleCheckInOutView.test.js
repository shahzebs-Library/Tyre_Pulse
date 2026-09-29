import { describe, it, expect } from 'vitest'
import {
  fuelPct, fuelLevelText, liveStatus, liveKpis, filterLive, withFleet, makeModel,
  lastOdometer, validateQuickEntry, quickPayload, OVERDUE_HOURS,
} from '../lib/vehicleCheckInOutView'

const NOW = new Date('2026-09-29T12:00:00').getTime()
const iso = (h) => new Date(NOW - h * 3600000).toISOString()

const ROWS = [
  // A: out then back in -> in
  { id: 1, asset_no: 'A1', direction: 'out', status: 'open', checked_at: iso(30), odometer_km: 100, driver_name: 'D1', site: 'NHC' },
  { id: 2, asset_no: 'a1', direction: 'in', status: 'open', checked_at: iso(20), odometer_km: 150, fuel_level: '3/4', site: 'NHC' },
  // B: out 30h ago -> overdue
  { id: 3, asset_no: 'B2', direction: 'out', status: 'open', checked_at: iso(30), odometer_km: 500, site: 'JED' },
  // C: out 2h ago -> out
  { id: 4, asset_no: 'C3', direction: 'out', status: 'open', checked_at: iso(2), fuel_level: '60%', site: 'NHC' },
  // D: closed check-out -> in
  { id: 5, asset_no: 'D4', direction: 'out', status: 'closed', checked_at: iso(5) },
  { id: 6, asset_no: '', direction: 'out', checked_at: iso(1) },
]

describe('fuelPct', () => {
  it('reads quarter words and percentages, and refuses anything else', () => {
    expect(fuelPct('Full')).toBe(100)
    expect(fuelPct('1/4')).toBe(25)
    expect(fuelPct('75%')).toBe(75)
    expect(fuelPct('')).toBeNull()
    expect(fuelPct('half')).toBeNull()
    expect(fuelPct('150%')).toBeNull()
    expect(fuelLevelText('')).toBe('')
    expect(fuelLevelText(74.6)).toBe('75%')
  })
})

describe('liveStatus + liveKpis', () => {
  const live = liveStatus(ROWS, { now: NOW })
  const by = Object.fromEntries(live.map((v) => [v.key, v]))
  it('derives one state per vehicle from its latest entry', () => {
    expect(live).toHaveLength(4)
    expect(by.A1.state).toBe('in')
    expect(by.A1.returnedAt).toBe(ROWS[1].checked_at)
    expect(by.A1.expectedIn).toBeNull()
    expect(by.B2.state).toBe('overdue')
    expect(by.C3.state).toBe('out')
    expect(by.C3.expectedIn).toBe(new Date(NOW - 2 * 3600000 + OVERDUE_HOURS * 3600000).toISOString())
    expect(by.C3.fuel_pct).toBe(60)
    expect(by.D4.state).toBe('in')
    expect(live[0].state).toBe('overdue')
  })
  it('counts tiles and returns nulls when not loaded', () => {
    const k = liveKpis(live, { now: NOW })
    expect(k).toEqual({ currentlyOut: 2, currentlyIn: 2, overdue: 1, dueToday: 0 })
    expect(liveKpis(null).currentlyOut).toBeNull()
    const early = new Date('2026-09-29T01:00:00').getTime()
    const due = liveKpis(liveStatus([{ asset_no: 'Z', direction: 'out', checked_at: new Date(early - 20 * 3600000).toISOString() }], { now: early }), { now: early })
    expect(due.dueToday).toBe(1)
  })
  it('filters by site, state, search and date, and joins the fleet register', () => {
    expect(filterLive(live, { site: 'JED' }).map((v) => v.key)).toEqual(['B2'])
    expect(filterLive(live, { state: 'in' })).toHaveLength(2)
    const day = new Date(NOW - 2 * 3600000)
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    expect(filterLive(live, { date: ymd }).map((v) => v.key)).toContain('C3')
    const joined = withFleet(live, [{ asset_no: 'c3', make: 'Volvo', model: 'FH', current_km: 900 }])
    const c = joined.find((v) => v.key === 'C3')
    expect(makeModel(c)).toBe('Volvo FH')
    expect(makeModel(joined.find((v) => v.key === 'B2'))).toBeNull()
    expect(filterLive(joined, { search: 'volvo' }).map((v) => v.key)).toEqual(['C3'])
  })
})

describe('quick entry', () => {
  const live = liveStatus(ROWS, { now: NOW })
  it('blocks missing vehicle, odometer and bad fuel', () => {
    const r = validateQuickEntry({ asset_no: '', odometer_km: '', fuel_pct: '120', direction: 'out' })
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(3)
  })
  it('warns (not blocks) on a reading below the last one and on state mismatch', () => {
    expect(lastOdometer(ROWS, 'A1')).toBe(150)
    const r = validateQuickEntry({ asset_no: 'A1', odometer_km: '120', direction: 'in' }, { rows: ROWS, live })
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(2)
    const f = validateQuickEntry({ asset_no: 'C3', odometer_km: '10', direction: 'in' }, { rows: ROWS, live, fleetKm: 900 })
    expect(f.warnings[0]).toMatch(/900/)
    expect(validateQuickEntry({ asset_no: 'C3', odometer_km: '1000', direction: 'in' }, { rows: ROWS, live, fleetKm: 900 }).warnings).toEqual([])
  })
  it('builds the createEntry payload with a percentage fuel level', () => {
    const p = quickPayload({ asset_no: ' C3 ', odometer_km: '1000', fuel_pct: '80', direction: 'in', site: 'NHC' }, { country: 'KSA', now: NOW })
    expect(p).toMatchObject({ asset_no: 'C3', direction: 'in', fuel_level: '80%', site: 'NHC', status: 'open', country: 'KSA' })
    expect(p.checked_at).toBe(new Date(NOW).toISOString())
  })
})
