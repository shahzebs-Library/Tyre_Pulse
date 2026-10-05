import { describe, it, expect } from 'vitest'
import {
  fleetAvailability, depotOptions, filterVehicles, headlineTiles, constraintCards, bandDistribution,
  weekTonnage, capacityOutlook, planTabCounts, planTabMatch, placeOptions, plannerStatus, fleetIndex, routeLegs,
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
