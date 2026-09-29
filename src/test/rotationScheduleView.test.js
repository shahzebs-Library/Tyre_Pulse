import { describe, it, expect } from 'vitest'
import {
  parsePlan, planOf, planColumns, attachmentsOf, typeToToken, tokenToType, TYPE_TOKEN, ROTATION_TYPES, newPositionsFor, scheduleNo, scheduleStatus, enrichSchedules,
  filterSchedules, buildScheduleKpis, nextRecommendation, calendarMonth, fleetHistory,
  treadByPosition, validatePlan, optionsOf, movesText,
} from '../lib/rotationScheduleView'

const NOW = new Date(2026, 8, 15) // 15 Sep 2026

describe('rotation type token mapping', () => {
  it('round trips every UI type through the CHECK token', () => {
    expect(TYPE_TOKEN).toEqual({ Standard: 'standard', Cross: 'cross', 'Side to Side': 'side_to_side', 'X Pattern': 'x_pattern', Custom: 'custom' })
    for (const t of ROTATION_TYPES) expect(tokenToType(typeToToken(t))).toBe(t)
    for (const tok of Object.values(TYPE_TOKEN)) expect(typeToToken(tokenToType(tok))).toBe(tok)
  })
  it('only emits CHECK-valid tokens, null for anything else', () => {
    expect(typeToToken('side to side')).toBe('side_to_side')
    expect(typeToToken('x_pattern')).toBe('x_pattern')
    expect(typeToToken('Diagonal')).toBeNull()
    expect(typeToToken('')).toBeNull()
    expect(typeToToken(null)).toBeNull()
    expect(tokenToType('bogus')).toBeNull()
  })
})

describe('plan columns', () => {
  const techs = [{ id: 'u1', name: 'A. Khan' }]
  it('maps the form to real columns, technician from the list keeps its id', () => {
    const c = planColumns({ type: 'Side to Side', from: ['FL', 'RL'], to: ['FR', 'RR'], technician: ' a. khan ', notes: ' Check torque ' }, techs)
    expect(c).toEqual({
      rotation_type: 'side_to_side', from_positions: ['FL', 'RL'], to_positions: ['FR', 'RR'],
      technician_id: 'u1', technician_name: 'a. khan', notes: 'Check torque',
    })
    expect(c.notes).not.toMatch(/^Rotation:/)
  })
  it('stores a typed technician by name only', () => {
    const c = planColumns({ type: 'Custom', from: ['FL'], to: ['RR'], technician: 'Guest Fitter', notes: '' }, techs)
    expect(c.technician_id).toBeNull()
    expect(c.technician_name).toBe('Guest Fitter')
    expect(c.notes).toBeNull()
  })
  it('reads the plan from the columns', () => {
    const p = planOf({ rotationType: 'x_pattern', fromPositions: ['FL'], toPositions: ['RR'], technicianName: 'A. Khan', notes: 'Free text' })
    expect(p).toEqual({ recorded: true, type: 'X Pattern', from: ['FL'], to: ['RR'], technician: 'A. Khan', freeNotes: 'Free text' })
  })
  it('falls back to a legacy notes header only when no column is set', () => {
    const p = planOf({ fromPositions: [], toPositions: [], notes: 'Rotation: Side to Side | From: FL, FR | To: FR, FL | Technician: B\nCheck torque' })
    expect(p.recorded).toBe(true)
    expect(p.type).toBe('Side to Side')
    expect(p.from).toEqual(['FL', 'FR'])
    expect(p.technician).toBe('B')
    expect(p.freeNotes).toBe('Check torque')
  })
  it('reports plain notes as not recorded, never a guessed plan', () => {
    const p = planOf({ notes: 'Auto-scheduled. Due in 500 km.' })
    expect(p.recorded).toBe(false)
    expect(p.type).toBeNull()
    expect(p.freeNotes).toBe('Auto-scheduled. Due in 500 km.')
    expect(parsePlan('Auto-scheduled.').recorded).toBe(false)
  })
  it('keeps only well formed attachments', () => {
    expect(attachmentsOf({ attachments: [{ path: 'o/rotations/1/a.pdf', name: 'a.pdf' }, null, { name: 'x' }, 'bad'] })).toHaveLength(1)
    expect(attachmentsOf({ attachments: null })).toEqual([])
  })
})

describe('patterns', () => {
  it('maps standard, cross, side to side and x pattern; custom is left to the user', () => {
    expect(newPositionsFor('Standard', ['FL', 'RR'])).toEqual(['RL', 'FR'])
    expect(newPositionsFor('Cross', ['FL', 'RL'])).toEqual(['RL', 'FR'])
    expect(newPositionsFor('X Pattern', ['FL'])).toEqual(['RR'])
    expect(newPositionsFor('Side to Side', ['RL'])).toEqual(['RR'])
    expect(newPositionsFor('Custom', ['FL'])).toBeNull()
    expect(movesText(['FL'], ['RL'])).toBe('Front left to Rear left')
  })
})

describe('status and number', () => {
  it('derives a stable schedule number', () => {
    expect(scheduleNo({ id: 'ab12cd34-0000', scheduledDate: '2026-09-27' })).toBe('ROT-2026-AB12CD')
  })
  it('classifies open rows by date', () => {
    expect(scheduleStatus({ status: 'Open', scheduledDate: '2026-09-10' }, NOW)).toBe('Overdue')
    expect(scheduleStatus({ status: 'Open', scheduledDate: '2026-09-15' }, NOW)).toBe('Scheduled')
    expect(scheduleStatus({ status: 'Completed', scheduledDate: '2026-01-01' }, NOW)).toBe('Completed')
    expect(scheduleStatus({ status: 'In Progress' }, NOW)).toBe('In Progress')
  })
})

describe('register', () => {
  const schedules = [
    { id: '1', asset: 'TM1', site: 'NHC', status: 'Open', scheduledDate: '2026-09-20', rotationType: 'standard', fromPositions: ['FL'], toPositions: ['RL'], notes: '' },
    { id: '2', asset: 'TM2', site: 'JED', status: 'Completed', scheduledDate: '2026-08-01', notes: '' },
    { id: '3', asset: 'TM3', site: 'JED', status: 'Open', scheduledDate: '2026-09-01', notes: '' },
  ]
  const fleetByAsset = new Map([['TM1', { vehicle_type: 'TR-MIXER' }]])
  const vehiclesByAsset = new Map([['TM1', { activeTyres: [{ brand: 'Triangle' }] }]])
  const rows = enrichSchedules(schedules, { fleetByAsset, vehiclesByAsset, now: NOW })

  it('joins type and brand, N/A (null) when unknown', () => {
    expect(rows[0].vehicleType).toBe('TR-MIXER')
    expect(rows[0].brand).toBe('Triangle')
    expect(rows[1].brand).toBeNull()
  })
  it('filters by site, status, position, type and search', () => {
    expect(filterSchedules(rows, { site: 'JED' })).toHaveLength(2)
    expect(filterSchedules(rows, { status: 'Overdue' }).map((r) => r.asset)).toEqual(['TM3'])
    expect(filterSchedules(rows, { position: 'RL' }).map((r) => r.asset)).toEqual(['TM1'])
    expect(filterSchedules(rows, { vehicleType: 'TR-MIXER' })).toHaveLength(1)
    expect(filterSchedules(rows, { search: 'tm2' })).toHaveLength(1)
    expect(filterSchedules(rows, { from: '2026-09-02', to: '2026-09-30' })).toHaveLength(1)
    expect(optionsOf(rows, (r) => r.site)).toEqual(['JED', 'NHC'])
  })
  it('builds KPIs and never blends currency under All countries', () => {
    const analytics = { avgLifeWith: 60000, avgLifeWithout: 50000, lifeValueTotal: 1234 }
    const k = buildScheduleKpis(schedules, analytics, { country: 'All', currency: 'SAR', now: NOW })
    expect(k).toMatchObject({ total: 3, dueThisMonth: 2, completed: 1, overdue: 1, lifeIncreasePct: 20, costSaving: null })
    const ksa = buildScheduleKpis(schedules, analytics, { country: 'KSA', currency: 'SAR', now: NOW })
    expect(ksa.costSaving).toEqual({ value: 1234, currency: 'SAR' })
    expect(buildScheduleKpis([], {}, { now: NOW }).lifeIncreasePct).toBeNull()
  })
})

describe('recommendation, calendar, history, tread', () => {
  it('gives an estimated km and a date only when a daily distance is measurable', () => {
    const v = { lastRotationKm: 10000, dueInKm: 3000 }
    const recs = [{ issue_date: '2026-01-01', km_at_fitment: 1000 }, { issue_date: '2026-04-11', km_at_fitment: 11000 }]
    const r = nextRecommendation(v, recs, 20000, NOW)
    expect(r.estimatedKm).toBe(30000)
    expect(r.date).toBe('2026-10-15')
    expect(nextRecommendation(v, [], 20000, NOW).date).toBeNull()
    expect(nextRecommendation(null, [], 20000, NOW)).toBeNull()
  })
  it('lays out the month and places schedules on their day', () => {
    const cal = calendarMonth([{ id: 'a', scheduledDate: '2026-09-20' }], NOW)
    expect(cal.label).toBe('September 2026')
    const cell = cal.weeks.flat().find((d) => d.key === '2026-09-20')
    expect(cell.items).toHaveLength(1)
  })
  it('flattens detected rotations newest first', () => {
    const h = fleetHistory([{ asset: 'A', site: 'S', rotationEvents: [{ serial: 'x', from: 'Steer', to: 'Drive', date: '2026-01-01' }, { serial: 'y', from: 'Drive', to: 'Steer', date: '2026-03-01' }] }])
    expect(h.map((e) => e.serial)).toEqual(['y', 'x'])
  })
  it('returns null tread when nothing is measured', () => {
    expect(treadByPosition([{ position: 'FL', tread_depth: null }])).toBeNull()
    expect(treadByPosition([{ position: 'FL', tread_depth: 8 }, { position: 'FL', tread_depth: 6 }])).toEqual([{ position: 'FL', avg: 7, count: 2 }])
  })
  it('validates the form', () => {
    expect(validatePlan({})).toMatch(/vehicle/)
    expect(validatePlan({ asset: 'A', from: ['FL'], to: ['RL', 'RR'], scheduledDate: '2026-09-20', site: 'S' })).toMatch(/Each current/)
    expect(validatePlan({ asset: 'A', from: ['FL'], to: ['RL'], scheduledDate: '2026-09-20', site: 'S' })).toBe('')
  })
})
