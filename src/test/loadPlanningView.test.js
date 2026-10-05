import { describe, it, expect } from 'vitest'
import {
  fleetAvailability, depotOptions, filterVehicles, headlineTiles, constraintCards, bandDistribution,
  weekTonnage, capacityOutlook, planTabCounts, planTabMatch, placeOptions, plannerStatus, fleetIndex, routeLegs,
  capacityKg, vehiclePayload, unassignedPlans, suggestAssignments, assignmentPatch,
} from '../lib/loadPlanningView'

const NOW = new Date('2026-10-05T10:00:00')

const FLEET = [
  { id: 1, asset_no: 'TM101', vehicle_type: 'TR-MIXER', site: 'NHC', status: 'Active', ops_status: 'running' },
  { id: 2, asset_no: 'TM102', vehicle_type: 'TR-MIXER', site: 'JED', status: 'Active', ops_status: 'breakdown' },
  { id: 3, asset_no: 'tm 103', vehicle_type: 'TRAILER', site: 'NHC', status: 'Active' },
  { id: 4, asset_no: 'TM104', vehicle_type: 'TR-MIXER', site: 'NHC', status: 'Inactive' },
]
const PLANS = [
  { id: 'p1', reference: 'LP-1', asset_no: 'TM103', origin: 'Riyadh', destination: 'Jeddah', status: 'dispatched', cargo_weight_kg: 26000, max_payload_kg: 24000, plan_date: '2026-10-05' },
  { id: 'p2', reference: 'LP-2', asset_no: 'TM101', origin: 'Riyadh', destination: 'Jeddah', status: 'planned', cargo_weight_kg: 18000, max_payload_kg: 24000, plan_date: '2026-10-07' },
  { id: 'p3', reference: 'LP-3', asset_no: '', origin: 'Dammam', destination: 'Riyadh', status: 'draft', cargo_weight_kg: 10000, plan_date: '2026-10-01' },
  { id: 'p4', reference: 'LP-4', asset_no: 'TM101', status: 'delivered', cargo_weight_kg: 23000, max_payload_kg: 24000, plan_date: '2026-09-01' },
]

describe('loadPlanningView', () => {
  it('splits the active fleet by availability and ignores inactive assets', () => {
    const a = fleetAvailability(FLEET, PLANS)
    expect(a.counts).toEqual({ available: 1, inUse: 1, maintenance: 1 })
    expect(a.inUse[0].asset_no).toBe('tm 103')
    expect(a.inUse[0]._util).toBeCloseTo(108.3, 1)
    expect(depotOptions(FLEET)).toEqual(['JED', 'NHC'])
    expect(filterVehicles(FLEET, { depot: 'NHC', search: 'trailer' }).map((v) => v.id)).toEqual([3])
  })

  it('computes headline tiles with honest nulls', () => {
    const t = headlineTiles(PLANS)
    expect(t.planned).toBe(3)
    expect(t.overweight).toBe(1)
    expect(t.pending).toBe(1)
    expect(t.capacityUtil).toBe(93)
    expect(t.dispatchReady).toBe(100)
    const e = headlineTiles([])
    expect(e.capacityUtil).toBeNull()
    expect(e.dispatchReady).toBeNull()
  })

  it('reports constraint cards and leaves unrecorded ones null with a reason', () => {
    const c = constraintCards(PLANS)
    expect(c[0].value).toBe(67)
    expect(c[1].value).toBe(67)
    expect(c[2].value).toBeNull()
    expect(c[2].reason).toMatch(/driver/i)
    expect(constraintCards([])[0].reason).toBeTruthy()
  })

  it('distributes bands', () => {
    expect(bandDistribution(PLANS).map((b) => b.count)).toEqual([1, 1, 1, 1])
    expect(bandDistribution(PLANS).map((b) => b.short)).toEqual(['Within', 'Near', 'Over', 'No rating'])
  })

  it('builds the week and the 14 day outlook without inventing zeros', () => {
    const w = weekTonnage(PLANS, NOW)
    expect(w).toHaveLength(7)
    expect(w[6]).toMatchObject({ day: '2026-10-05', planned: 26000, capacity: 24000, plans: 1 })
    expect(w[0].planned).toBeNull()
    const o = capacityOutlook(PLANS, NOW, 14)
    expect(o).toHaveLength(14)
    expect(o[0].util).toBe(108)
    expect(o[2]).toMatchObject({ plans: 1, util: 75 })
    expect(o[1].util).toBeNull()
  })

  it('counts and matches register tabs', () => {
    expect(planTabCounts(PLANS)).toEqual({ all: 4, pending: 2, assigned: 2, risk: 1, dispatched: 2 })
    expect(planTabMatch(PLANS[2], 'pending')).toBe(true)
    expect(placeOptions(PLANS)).toEqual({ origins: ['Dammam', 'Riyadh'], destinations: ['Jeddah', 'Riyadh'] })
  })

  it('derives the planner status with risk first', () => {
    expect(plannerStatus(PLANS[0]).label).toBe('Over capacity')
    expect(plannerStatus(PLANS[1]).label).toBe('Assigned')
    expect(plannerStatus(PLANS[2]).label).toBe('Unassigned')
    expect(plannerStatus(PLANS[3]).label).toBe('Delivered')
  })

  it('indexes the fleet and rolls up route legs', () => {
    expect(fleetIndex(FLEET)('TM103').vehicle_type).toBe('TRAILER')
    expect(fleetIndex(FLEET)('nope')).toBeNull()
    const legs = routeLegs(PLANS)
    expect(legs[0]).toMatchObject({ origin: 'Riyadh', destination: 'Jeddah', plans: 2, over: 1 })
  })
})


describe('loadPlanningView optimize', () => {
  it('reads a weight from the register capacity, ignoring volumes', () => {
    expect(capacityKg('26T')).toBe(26000)
    expect(capacityKg('ISUZU - CAPACITY (5000 LTR) 6TON')).toBe(6000)
    expect(capacityKg('18000 KG')).toBe(18000)
    expect(capacityKg('12.5 tonnes')).toBe(12500)
    expect(capacityKg('10 M3')).toBeNull()
    expect(capacityKg('5000 LTR')).toBeNull()
    expect(capacityKg('4 tyres')).toBeNull()
    expect(capacityKg('')).toBeNull()
  })

  it('falls back to the newest payload on the vehicle own plans', () => {
    const plans = [
      { asset_no: 'TR1', max_payload_kg: 20000, plan_date: '2026-09-01' },
      { asset_no: 'tr 1', max_payload_kg: 24000, plan_date: '2026-09-20' },
      { asset_no: 'TR2', max_payload_kg: 30000, plan_date: '2026-09-25' },
    ]
    expect(vehiclePayload({ asset_no: 'TR1' }, plans)).toEqual({ kg: 24000, source: 'plan history' })
    expect(vehiclePayload({ asset_no: 'TR1', capacity: '26T' }, plans)).toEqual({ kg: 26000, source: 'register' })
    expect(vehiclePayload({ asset_no: 'TR9' }, plans)).toEqual({ kg: null, source: null })
  })

  it('only open plans without an asset need a vehicle', () => {
    const plans = [
      { id: 1, status: 'draft' }, { id: 2, status: 'planned', asset_no: 'X' },
      { id: 3, status: 'dispatched' }, { id: 4, status: '' }, { id: 5, status: 'planned' },
    ]
    expect(unassignedPlans(plans).map((p) => p.id)).toEqual([1, 4, 5])
  })

  const vehicles = [
    { asset_no: 'SMALL', capacity: '10T' },
    { asset_no: 'MID', capacity: '20T' },
    { asset_no: 'BIG', capacity: '30T' },
    { asset_no: 'UNRATED' },
  ]

  it('best fit, heaviest first, no double booking on the same date', () => {
    const plans = [
      { id: 'a', reference: 'A', status: 'draft', cargo_weight_kg: 8000, plan_date: '2026-10-06' },
      { id: 'b', reference: 'B', status: 'planned', cargo_weight_kg: 18000, plan_date: '2026-10-06' },
      { id: 'c', reference: 'C', status: 'draft', cargo_weight_kg: 9000, plan_date: '2026-10-06' },
      { id: 'd', reference: 'D', status: 'draft', cargo_weight_kg: 9000, plan_date: '2026-10-07' },
    ]
    const r = suggestAssignments(plans, vehicles)
    const by = Object.fromEntries(r.suggestions.map((s) => [s.plan.id, s.vehicle.asset_no]))
    expect(by).toEqual({ b: 'MID', c: 'SMALL', a: 'BIG', d: 'SMALL' })
    expect(r.ratedCandidates).toBe(3)
    expect(r.candidates).toBe(4)
    const sb = r.suggestions.find((s) => s.plan.id === 'b')
    expect(sb.utilPct).toBe(90)
    expect(sb.slackKg).toBe(2000)
    expect(sb.payloadSource).toBe('register')
  })

  it('respects existing bookings and explains every load it cannot place', () => {
    const plans = [
      { id: 'x', asset_no: 'MID', status: 'planned', cargo_weight_kg: 5000, plan_date: '2026-10-06' },
      { id: 'n1', reference: 'N1', status: 'draft', cargo_weight_kg: null, plan_date: '2026-10-06' },
      { id: 'n2', reference: 'N2', status: 'draft', cargo_weight_kg: 5000 },
      { id: 'n3', reference: 'N3', status: 'draft', cargo_weight_kg: 50000, plan_date: '2026-10-06' },
      { id: 'n4', reference: 'N4', status: 'draft', cargo_weight_kg: 19000, plan_date: '2026-10-06' },
      { id: 'n5', reference: 'N5', status: 'draft', cargo_weight_kg: 25000, plan_date: '2026-10-06' },
    ]
    const r = suggestAssignments(plans, vehicles)
    const sug = Object.fromEntries(r.suggestions.map((s) => [s.plan.id, s.vehicle.asset_no]))
    expect(sug).toEqual({ n5: 'BIG' })
    const why = Object.fromEntries(r.unplaced.map((u) => [u.plan.id, u.reason]))
    expect(why.n1).toMatch(/No cargo weight/)
    expect(why.n2).toMatch(/No plan date/)
    expect(why.n3).toMatch(/No available vehicle is rated/)
    expect(why.n4).toMatch(/already booked/)
  })

  it('says so when no available vehicle has a rated payload', () => {
    const r = suggestAssignments([{ id: 'p', status: 'draft', cargo_weight_kg: 1000, plan_date: '2026-10-06' }], [{ asset_no: 'U' }])
    expect(r.suggestions).toHaveLength(0)
    expect(r.unplaced[0].reason).toMatch(/known rated payload/)
    expect(suggestAssignments([{ id: 'p', status: 'draft', cargo_weight_kg: 1000, plan_date: '2026-10-06' }], []).unplaced[0].reason).toMatch(/No vehicle is available/)
  })

  it('patch assigns the asset, fills a blank payload and promotes a draft', () => {
    expect(assignmentPatch({ plan: { status: 'draft' }, vehicle: { asset_no: 'MID' }, payloadKg: 20000 }))
      .toEqual({ asset_no: 'MID', max_payload_kg: 20000, status: 'planned' })
    expect(assignmentPatch({ plan: { status: 'planned', max_payload_kg: 22000 }, vehicle: { asset_no: 'MID' }, payloadKg: 20000 }))
      .toEqual({ asset_no: 'MID' })
  })
})
