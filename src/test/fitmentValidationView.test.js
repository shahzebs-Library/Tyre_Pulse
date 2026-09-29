import { describe, it, expect } from 'vitest'
import {
  parseLoadSpeed, speedRank, specsForVehicle, specForPosition, duplicateFitments,
  buildFitmentChecks, scoreChecks, checksToLedger, auditStatus, filterAudit,
  complianceByCategory, fleetFootprint, catalogFor, catalogLoadSpeed,
} from '../lib/fitmentValidationView'
import { validateFitment, summarizeFitments } from '../lib/fitmentValidation'

const SPECS = [
  { vehicle_type: 'MIXER', position: 'Steer', approved_sizes: ['315/80R22.5'], min_load_index: 154, min_speed_index: 'M', recommended_pressure: 115 },
  { vehicle_type: 'RIGID TRUCK', position: 'Drive', approved_sizes: ['315/80R22.5'], min_load_index: 156, min_speed_index: 'L', recommended_pressure: 110 },
]
const VEH = { asset_no: 'TM1', vehicle_type: 'TR-MIXER', tyre_size: '315/80R22.5' }
const TYRE = { serial_no: 'S1', size: '315/80 R22.5', status: 'Active', tread_depth: null }

const byKey = (checks) => Object.fromEntries(checks.map((c) => [c.key, c]))

describe('fitmentValidationView', () => {
  it('parses load and speed text', () => {
    expect(parseLoadSpeed('156/150 L')).toEqual({ load: 156, loadDual: 150, speed: 'L' })
    expect(parseLoadSpeed('154M')).toEqual({ load: 154, loadDual: null, speed: 'M' })
    expect(parseLoadSpeed('')).toEqual({ load: null, loadDual: null, speed: null })
    expect(speedRank('M')).toBeGreaterThan(speedRank('L'))
    expect(speedRank('?')).toBeNull()
  })

  it('matches specs exactly, then by a single type family', () => {
    expect(specsForVehicle(SPECS, 'RIGID TRUCK').matchedBy).toBe('exact')
    const fam = specsForVehicle(SPECS, 'TR-MIXER')
    expect(fam.matchedBy).toBe('partial')
    expect(specForPosition(fam.rows, 'steer').vehicle_type).toBe('MIXER')
    expect(specsForVehicle(SPECS, 'BUS').rows).toEqual([])
  })

  it('flags a serial active on another asset, not on the target', () => {
    const rows = [{ asset_no: 'TM1', position: 'LHF' }, { asset_no: 'TM2', position: 'RHF' }]
    expect(duplicateFitments(rows, { assetNo: 'tm1' })).toEqual([{ asset_no: 'TM2', position: 'RHF' }])
    expect(duplicateFitments([], { assetNo: 'TM1' })).toEqual([])
  })

  it('builds real checks and leaves unmeasurable ones out of the score', () => {
    const engine = validateFitment(TYRE, VEH, null)
    const { checks } = buildFitmentChecks({
      tyre: TYRE, tyreLooked: true, vehicle: VEH, axleRole: 'Steer', size: TYRE.size, specs: SPECS,
      loadSpeed: '156/150 L', pressure: '', engine, duplicates: [],
    })
    const c = byKey(checks)
    expect(c.size.status).toBe('pass')
    expect(c.load.status).toBe('pass')
    expect(c.speed.status).toBe('fail') // L is below the M minimum
    expect(c.axle.status).toBe('pass')
    expect(c.pressure.status).toBe('na')
    expect(c.duplicate.status).toBe('pass')
    expect(c.tread.status).toBe('na')
    const s = scoreChecks(checks)
    expect(s.allowed).toBe(false)
    expect(s.score).toBe(Math.round((5 / 6) * 100))
  })

  it('checks pressure only with a real target', () => {
    const run = (pressure) => byKey(buildFitmentChecks({ vehicle: VEH, axleRole: 'Steer', specs: SPECS, pressure, size: '315/80R22.5' }).checks).pressure
    expect(run('113').status).toBe('pass')
    expect(run('105').status).toBe('advisory')
    expect(run('90').status).toBe('fail')
    const noTarget = byKey(buildFitmentChecks({ vehicle: { vehicle_type: 'BUS' }, axleRole: 'Steer', specs: SPECS, pressure: '100' }).checks).pressure
    expect(noTarget.status).toBe('na')
  })

  it('reports a missing tyre and scores null when nothing ran', () => {
    const { checks } = buildFitmentChecks({ tyre: null, tyreLooked: true, specs: [] })
    expect(byKey(checks).record.status).toBe('fail')
    expect(scoreChecks([{ status: 'na' }]).score).toBeNull()
    const led = checksToLedger([{ key: 'size', label: 'Tyre size', status: 'fail', detail: 'x' }, { key: 'p', label: 'P', status: 'advisory', detail: 'y' }])
    expect(led.is_valid).toBe(false)
    expect(led.violations).toHaveLength(1)
    expect(led.warnings).toHaveLength(1)
  })

  it('classifies, filters and groups the fleet audit', () => {
    const vehicles = [
      { asset_no: 'A', vehicle_type: 'MIXER', site: 'NHC', tyre_size: '315/80R22.5' },
      { asset_no: 'B', vehicle_type: 'MIXER', site: 'NHC', tyre_size: '315/80R22.5' },
      { asset_no: 'C', vehicle_type: 'BUS', site: 'JED', tyre_size: '' },
      { asset_no: 'D', vehicle_type: 'BUS', site: 'JED', tyre_size: '295/80R22.5' },
    ]
    const tyres = [
      { asset_no: 'A', size: '315/80R22.5' }, { asset_no: 'B', size: '385/65R22.5' }, { asset_no: 'C', size: '295/80R22.5' },
    ]
    const { rows } = summarizeFitments(vehicles, tyres)
    const st = Object.fromEntries(rows.map((r) => [r.asset_no, auditStatus(r)]))
    expect(st).toEqual({ A: 'compliant', B: 'wrong_size', C: 'no_spec', D: 'no_tyres' })
    expect(filterAudit(rows, { severity: 'data' }).map((r) => r.asset_no)).toEqual(['C', 'D'])
    expect(filterAudit(rows, { site: 'NHC', search: '385' }).map((r) => r.asset_no)).toEqual(['B'])
    expect(complianceByCategory(rows)).toEqual([{ category: 'MIXER', match: 1, checked: 2, pct: 50 }])
    expect(fleetFootprint(vehicles)).toEqual({ vehicles: 4, sites: 2 })
  })

  it('reads the catalogue by size and brand', () => {
    const cat = [
      { id: 1, size: '315/80R22.5', brand: 'X', approval_status: 'pending', load_index_single: 156, load_index_dual: 150, speed_rating: 'L' },
      { id: 2, size: '315/80 R22.5', brand: 'Y', approval_status: 'approved', load_index_single: 154, speed_rating: 'M' },
    ]
    expect(catalogFor(cat, '315/80R22.5').map((r) => r.id)).toEqual([2, 1])
    expect(catalogFor(cat, '315/80R22.5', 'x').map((r) => r.id)).toEqual([1])
    expect(catalogLoadSpeed(cat[0])).toBe('156/150 L')
    expect(catalogLoadSpeed(null)).toBe('')
  })
})
