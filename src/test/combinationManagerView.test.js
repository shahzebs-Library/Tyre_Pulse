import { describe, it, expect } from 'vitest'
import {
  parseAxleConfig, normalizeTyreConfig, tyreConfigLabel, axleRows, isConfigComplete, managerKpis,
  filterManager, buildFleetMap, vehicleTypeOptions, typeOptions, tyreConfigSegments, suggestNextNumber,
  validateManagerForm, payloadFromForm, formFromRow, statusMeta,
} from '../lib/combinationManagerView'

const rows = [
  { id: 1, combination_no: 'COMB-001', prime_mover_no: 'TR-032', trailer_nos: ['T1'], site: 'NHC', status: 'active',
    combination_type: 'Lowbed', axle_config: '6x4 + 3A', tyre_config: { steer: 2, drive: 8, trailer: 12 }, max_load_tonnes: 60 },
  { id: 2, combination_no: 'COMB-007', prime_mover_no: 'mg-021', trailer_nos: [], site: 'JED', status: 'under_review',
    combination_type: 'Tanker', axle_config: '6x4', tyre_config: {}, max_load_tonnes: null },
  { id: 3, prime_mover_no: 'X9', trailer_nos: [], status: 'inactive', axle_config: 'junk' },
]
const fleetMap = buildFleetMap([{ asset_no: 'TR-032', vehicle_type: 'TRUCK' }, { asset_no: 'MG-021', vehicle_type: 'TANKER' }])

describe('axle configuration', () => {
  it('parses prime mover and trailer axles', () => {
    expect(parseAxleConfig('6x4 + 3A')).toMatchObject({ prime: { axles: 3, drive: 2, steer: 1 }, trailerAxles: 3, totalAxles: 6 })
    expect(parseAxleConfig('8x4 + 2A + 2A')).toMatchObject({ prime: { axles: 4, steer: 2 }, trailerAxles: 4 })
    expect(parseAxleConfig('junk')).toBeNull()
    expect(parseAxleConfig('5x4')).toBeNull()
    expect(parseAxleConfig('')).toBeNull()
  })
  it('axle rows only fill tyres when counts divide evenly, loads always null', () => {
    const r = axleRows(rows[0])
    expect(r).toHaveLength(6)
    expect(r[0]).toMatchObject({ group: 'steer', tyres: 2, axleLoad: null, legalLimit: null })
    expect(r[1]).toMatchObject({ group: 'drive', tyres: 4 })
    expect(r[5]).toMatchObject({ group: 'trailer', tyres: 4 })
    expect(axleRows({ axle_config: '6x4', tyre_config: { drive: 7 } })[1].tyres).toBeNull()
  })
})

describe('tyre configuration', () => {
  it('normalises and labels', () => {
    expect(normalizeTyreConfig({ steer: 2, drive: '8' })).toEqual({ steer: 2, drive: 8, trailer: null, total: 10 })
    expect(normalizeTyreConfig(null).total).toBeNull()
    expect(tyreConfigLabel(rows[0].tyre_config)).toBe('10 + 12')
    expect(tyreConfigLabel({})).toBeNull()
    expect(tyreConfigSegments({})).toEqual([])
    expect(tyreConfigSegments(rows[0].tyre_config).map((s) => s.count)).toEqual([2, 8, 12])
  })
})

describe('kpis and filters', () => {
  it('counts statuses and compliance, null when empty', () => {
    const k = managerKpis(rows)
    expect(k).toMatchObject({ total: 3, active: 1, underReview: 1, inactive: 1, complete: 1, compliancePct: 33 })
    expect(managerKpis([]).compliancePct).toBeNull()
    expect(isConfigComplete(rows[1])).toBe(false)
  })
  it('filters by vehicle type via the fleet map, type, status and search', () => {
    expect(filterManager(rows, { vehicleType: 'TANKER' }, fleetMap).map((r) => r.id)).toEqual([2])
    expect(filterManager(rows, { type: 'Lowbed' }).map((r) => r.id)).toEqual([1])
    expect(filterManager(rows, { status: 'inactive' }).map((r) => r.id)).toEqual([3])
    expect(filterManager(rows, { search: 't1' }).map((r) => r.id)).toEqual([1])
    expect(vehicleTypeOptions(rows, fleetMap)).toEqual(['TANKER', 'TRUCK'])
    expect(typeOptions(rows)).toEqual(['Lowbed', 'Tanker'])
  })
})

describe('form', () => {
  it('suggests the next number', () => {
    expect(suggestNextNumber(rows)).toBe('COMB-008')
    expect(suggestNextNumber([])).toBe('COMB-001')
  })
  it('validates and builds a payload', () => {
    expect(validateManagerForm({ prime_mover_no: '' }).prime_mover_no).toBeTruthy()
    const e = validateManagerForm({ prime_mover_no: 'A', axle_config: 'bad', steer: '-1', max_load_tonnes: '0' })
    expect(Object.keys(e).sort()).toEqual(['axle_config', 'max_load_tonnes', 'steer'])
    const p = payloadFromForm({ ...formFromRow(rows[0]), trailer: '' })
    expect(p.tyre_config).toEqual({ steer: 2, drive: 8 })
    expect(p.max_load_tonnes).toBe(60)
    expect(payloadFromForm({ max_load_tonnes: '' }).max_load_tonnes).toBeNull()
    expect(statusMeta('under_review').label).toBe('Under Review')
    expect(statusMeta('weird').label).toBe('Inactive')
  })
})
