import { describe, it, expect } from 'vitest'
import {
  PRIORITY_MATRIX, CRITICALITY_CRITERIA, normalizeType, assetPrefix, priorityFor,
  priorityTypes, priorityPrefixes, summarizePriorities, buildPriorityFilter, prioritySetFor,
} from '../lib/assetPriority'

const p = (row) => priorityFor(row)

describe('matrix', () => {
  it('has six rows in order with the owner criticality', () => {
    expect(PRIORITY_MATRIX.map((m) => [m.priority, m.criticality])).toEqual([
      [1, 'Critical'], [2, 'High'], [3, 'High'], [4, 'Medium'], [5, 'Medium'], [6, 'Low'],
    ])
    expect(CRITICALITY_CRITERIA.map((c) => c.criticality)).toEqual(['Critical', 'High', 'Medium', 'Low'])
  })
  it('contains no en or em dashes in user-facing text', () => {
    const text = JSON.stringify([PRIORITY_MATRIX, CRITICALITY_CRITERIA])
    expect(text).not.toMatch(/[–—]/)
  })
})

describe('normalizeType / assetPrefix', () => {
  it('normalizes case, spaces, underscores and hyphens', () => {
    expect(normalizeType(' wheel_loader ')).toBe('WHEEL LOADER')
    expect(normalizeType('Tr-Mixer')).toBe('TR MIXER')
    expect(normalizeType('BATCHING   PLANT')).toBe('BATCHING PLANT')
    expect(normalizeType(null)).toBe('')
  })
  it('takes the leading letters of the asset number', () => {
    expect(assetPrefix('tm514')).toBe('TM')
    expect(assetPrefix('REC04')).toBe('REC')
    expect(assetPrefix('123')).toBe('')
    expect(assetPrefix(null)).toBe('')
  })
})

describe('priorityFor by type (every live type)', () => {
  const cases = [
    ['WHEEL_LOADER', 1], ['WHEEL LOADER', 1],
    ['BT-PLANT', 2], ['BATCHING PLANT', 2], ['ICE PLANT', 2], ['CHILLER', 2], ['RECLAIMER', 2],
    ['PUMPS', 3], ['SPIDER PUMP', 3], ['PLACING BOOM', 3], ['STATIONARY PUMP', 3], ['LINE PUMP', 3], ['CONCRETE PUMP', 3],
    ['GENERATOR', 4],
    ['TR-MIXER', 5], ['TRANSIT MIXER', 5],
    ['PICKUP', 6], ['BUS', 6], ['FORKLIFT', 6], ['TRAILER', 6], ['D TANKER', 6], ['SKID LOADER', 6],
    ['EXCAVATOR', 6], ['HEAVY EQP', 6], ['WATER TREATMENT PLANT', 6], ['BUILDINGS', 6], ['HD-DISTRIBUTOR', 6],
  ]
  it.each(cases)('%s -> P%i by type', (type, expected) => {
    const r = p({ vehicle_type: type, asset_no: 'XX1' })
    expect(r.priority).toBe(expected)
    expect(r.basis).toBe('type')
  })
  it('is case and separator insensitive', () => {
    expect(p({ vehicle_type: 'wheel loader' }).priority).toBe(1)
    expect(p({ vehicle_type: 'Tr Mixer' }).priority).toBe(5)
    expect(p({ vehicle_type: 'bt_plant' }).priority).toBe(2)
  })
})

describe('priorityFor by asset code (blank type)', () => {
  const cases = [
    ['WL001', 1], ['BP041', 2], ['IP065', 2], ['REC04', 2],
    ['MP083', 3], ['SP010', 3], ['LP002', 3], ['PB014', 3], ['HD021', 3],
    ['GN103', 4], ['TM514', 5], ['DT007', 5],
  ]
  it.each(cases)('%s -> P%i by code', (assetNo, expected) => {
    for (const blank of [null, undefined, '', '   ']) {
      const r = p({ vehicle_type: blank, asset_no: assetNo })
      expect(r.priority).toBe(expected)
      expect(r.basis).toBe('code')
    }
  })
  it('lower-case asset numbers still match', () => {
    expect(p({ asset_no: 'tm12' })).toMatchObject({ priority: 5, basis: 'code' })
  })
  it('unknown or missing prefix is default P6', () => {
    expect(p({ asset_no: 'BH009' })).toMatchObject({ priority: 6, basis: 'default', criticality: 'Low' })
    expect(p({ asset_no: '12345' })).toMatchObject({ priority: 6, basis: 'default' })
    expect(p({})).toMatchObject({ priority: 6, basis: 'default' })
    expect(p(null)).toMatchObject({ priority: 6, basis: 'default' })
  })
  it('longer prefix that only starts with a known one does not match', () => {
    expect(p({ asset_no: 'TMX12' })).toMatchObject({ priority: 6, basis: 'default' })
  })
})

describe('type beats code', () => {
  it('PUMPS with prefix BH is P3 by type', () => {
    expect(p({ vehicle_type: 'PUMPS', asset_no: 'BH001' })).toMatchObject({ priority: 3, basis: 'type' })
  })
  it('HD-DISTRIBUTOR with prefix HD is P6 by type, blank type HD is P3 by code', () => {
    expect(p({ vehicle_type: 'HD-DISTRIBUTOR', asset_no: 'HD021' })).toMatchObject({ priority: 6, basis: 'type' })
    expect(p({ vehicle_type: '', asset_no: 'HD021' })).toMatchObject({ priority: 3, basis: 'code' })
  })
  it('known other type with a P5 prefix stays P6', () => {
    expect(p({ vehicle_type: 'PICKUP', asset_no: 'TM900' })).toMatchObject({ priority: 6, basis: 'type' })
  })
})

describe('stored and override', () => {
  it('stored equal to derived keeps the derived basis', () => {
    expect(p({ vehicle_type: 'GENERATOR', maintenance_priority: 4 })).toMatchObject({ priority: 4, basis: 'type' })
  })
  it('stored different from derived is basis stored', () => {
    expect(p({ vehicle_type: 'GENERATOR', maintenance_priority: 2 })).toMatchObject({ priority: 2, basis: 'stored', criticality: 'High' })
  })
  it('override reason makes basis override', () => {
    expect(p({ vehicle_type: 'BUS', maintenance_priority: '1', priority_override_reason: 'Only bus on site' }))
      .toMatchObject({ priority: 1, basis: 'override', criticality: 'Critical' })
  })
  it('invalid stored values are ignored', () => {
    for (const v of [0, 7, 2.5, 'x', '', null]) {
      expect(p({ vehicle_type: 'TR-MIXER', maintenance_priority: v })).toMatchObject({ priority: 5, basis: 'type' })
    }
  })
  it('a reason without a valid stored value does not override', () => {
    expect(p({ vehicle_type: 'BUS', priority_override_reason: 'why' })).toMatchObject({ priority: 6, basis: 'type' })
  })
})

describe('lists and summary', () => {
  it('priorityTypes include the exact stored spellings', () => {
    expect(priorityTypes(1)).toEqual(expect.arrayContaining(['WHEEL LOADER', 'WHEEL_LOADER']))
    expect(priorityTypes(2)).toEqual(expect.arrayContaining(['BT-PLANT', 'BATCHING PLANT', 'ICE PLANT', 'CHILLER', 'RECLAIMER']))
    expect(priorityTypes(5)).toEqual(expect.arrayContaining(['TR-MIXER', 'TRANSIT MIXER']))
    expect(priorityTypes(6)).toEqual([])
  })
  it('every listed spelling resolves back to its own priority', () => {
    for (const lvl of [1, 2, 3, 4, 5]) {
      for (const t of priorityTypes(lvl)) expect(p({ vehicle_type: t }).priority).toBe(lvl)
      for (const pre of priorityPrefixes(lvl)) expect(p({ asset_no: `${pre}01` }).priority).toBe(lvl)
    }
    expect(priorityPrefixes(6)).toEqual([])
  })
  it('summarizePriorities counts levels, basis and P1 to P3', () => {
    const s = summarizePriorities([
      { vehicle_type: 'WHEEL LOADER' }, { asset_no: 'BP1' }, { vehicle_type: 'PUMPS' },
      { vehicle_type: 'GENERATOR' }, { asset_no: 'TM1' }, { asset_no: 'ZZ1' },
    ])
    expect(s.total).toBe(6)
    expect(s.byPriority).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 })
    expect(s.criticalHigh).toBe(3)
    expect(s.byBasis).toMatchObject({ type: 3, code: 2, default: 1 })
    expect(summarizePriorities().total).toBe(0)
  })
})

describe('buildPriorityFilter', () => {
  it('P1 filter string', () => {
    expect(buildPriorityFilter(1)).toBe(
      'vehicle_type.in.("WHEEL LOADER","WHEEL_LOADER","WHEEL-LOADER"),and(or(vehicle_type.is.null,vehicle_type.eq.""),asset_no.imatch."^(WL)([^A-Z]|$)")',
    )
  })
  it('P6 is the complement of P1 to P5', () => {
    const f = buildPriorityFilter(6)
    expect(f.startsWith('and(vehicle_type.not.in.(')).toBe(true)
    expect(f).toContain('vehicle_type.neq.""')
    expect(f).toContain('asset_no.not.imatch."^(WL|BP|IP|REC|MP|SP|LP|PB|HD|GN|TM|DT)([^A-Z]|$)"')
    for (const lvl of [1, 2, 3, 4, 5]) for (const t of priorityTypes(lvl)) expect(f).toContain(`"${t}"`)
  })
  it('a set of levels unions types and prefixes', () => {
    const f = buildPriorityFilter([3, 1, 2])
    expect(f).toContain('"WHEEL LOADER"')
    expect(f).toContain('"CHILLER"')
    expect(f).toContain('"PUMPS"')
    expect(f).not.toContain('"GENERATOR"')
    expect(f).toContain('^(WL|BP|IP|REC|MP|SP|LP|PB|HD)([^A-Z]|$)')
  })
  it('a set with 6 excludes only the missing levels', () => {
    const f = buildPriorityFilter([5, 6])
    expect(f).toContain('vehicle_type.not.in.(')
    expect(f).not.toContain('"TR-MIXER"')
    expect(f).toContain('"GENERATOR"')
    expect(f).toContain('^(WL|BP|IP|REC|MP|SP|LP|PB|HD|GN)([^A-Z]|$)')
  })
  it('empty, invalid or all levels give no filter', () => {
    expect(buildPriorityFilter([])).toBeNull()
    expect(buildPriorityFilter(9)).toBeNull()
    expect(buildPriorityFilter(undefined)).toBeNull()
    expect(buildPriorityFilter([1, 2, 3, 4, 5, 6])).toBeNull()
  })
  it('with the stored column, a stored priority wins and blanks fall back to the derived rule', () => {
    const f = buildPriorityFilter([3, 1], { storedColumn: true })
    expect(f.startsWith('maintenance_priority.in.(1,3),and(maintenance_priority.is.null,or(')).toBe(true)
    expect(f).toContain(buildPriorityFilter([1, 3]))
    expect(f.endsWith('))')).toBe(true)
    const six = buildPriorityFilter(6, { storedColumn: true })
    expect(six).toContain('maintenance_priority.in.(6)')
    expect(six).toContain(buildPriorityFilter(6))
  })
  it('without the stored column the filter never names it', () => {
    expect(buildPriorityFilter(2)).not.toContain('maintenance_priority')
    expect(buildPriorityFilter(2, { storedColumn: false })).toBe(buildPriorityFilter(2))
    expect(buildPriorityFilter([1, 2, 3, 4, 5, 6], { storedColumn: true })).toBeNull()
  })
  it('prioritySetFor accepts only offered values', () => {
    expect(prioritySetFor('1')).toEqual([1])
    expect(prioritySetFor('1-3')).toEqual([1, 2, 3])
    expect(prioritySetFor('7')).toBeNull()
    expect(prioritySetFor('')).toBeNull()
  })
})
