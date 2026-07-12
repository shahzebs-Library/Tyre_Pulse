import { describe, it, expect } from 'vitest'
import {
  normalizeSize, classifyFitment, groupFittedByAsset, summarizeFitments,
} from '../lib/fitmentValidation'

describe('normalizeSize', () => {
  it('trims, upper-cases and strips all whitespace', () => {
    expect(normalizeSize(' 295/80 r22.5 ')).toBe('295/80R22.5')
    expect(normalizeSize('295/80R22.5')).toBe('295/80R22.5')
    expect(normalizeSize('11 R 22.5')).toBe('11R22.5')
  })

  it('treats null/undefined/blank as empty', () => {
    expect(normalizeSize(null)).toBe('')
    expect(normalizeSize(undefined)).toBe('')
    expect(normalizeSize('   ')).toBe('')
  })

  it('makes differently-formatted equal sizes compare equal', () => {
    expect(normalizeSize('295/80 R22.5')).toBe(normalizeSize('295/80r22.5'))
  })
})

describe('classifyFitment', () => {
  const veh = { asset_no: 'A1', tyre_size: '295/80 R22.5', site: 'Dubai' }

  it('flags MATCH when every fitted size equals the spec', () => {
    const r = classifyFitment(veh, [
      { size: '295/80R22.5', serial_no: 'S1' },
      { size: '295/80 r22.5', serial_no: 'S2' },
    ])
    expect(r.band).toBe('match')
    expect(r.mismatchSizes).toEqual([])
    expect(r.fittedCount).toBe(2)
  })

  it('flags MISMATCH when a fitted size differs from the spec', () => {
    const r = classifyFitment(veh, [
      { size: '295/80R22.5', serial_no: 'S1' },
      { size: '315/80R22.5', serial_no: 'S2' },
    ])
    expect(r.band).toBe('mismatch')
    expect(r.mismatchSizes).toEqual(['315/80R22.5'])
    expect(r.fitted.find((f) => f.serial === 'S2').matches).toBe(false)
    expect(r.fitted.find((f) => f.serial === 'S1').matches).toBe(true)
  })

  it('flags UNKNOWN when the asset has no spec', () => {
    const r = classifyFitment({ asset_no: 'A2', tyre_size: '' }, [{ size: '295/80R22.5' }])
    expect(r.band).toBe('unknown')
  })

  it('flags UNKNOWN when there are no fitted tyres', () => {
    const r = classifyFitment(veh, [])
    expect(r.band).toBe('unknown')
    expect(r.fittedCount).toBe(0)
  })

  it('dedupes fitted sizes and reads serial/position fallbacks', () => {
    const r = classifyFitment(veh, [
      { size: '295/80R22.5', tyre_serial: 'T1', tyre_position: 'STEER-L' },
      { size: '295/80 R22.5', serial_number: 'T2', position: 'STEER-R' },
    ])
    expect(r.fittedSizes).toHaveLength(1)
    expect(r.fitted.map((f) => f.serial).sort()).toEqual(['T1', 'T2'])
    expect(r.fitted.map((f) => f.position)).toContain('STEER-L')
  })
})

describe('groupFittedByAsset', () => {
  it('groups tyre rows by asset_no and skips rows without one', () => {
    const map = groupFittedByAsset([
      { asset_no: 'A1', size: 'X' },
      { asset_no: 'A1', size: 'Y' },
      { asset_no: 'A2', size: 'Z' },
      { size: 'orphan' },
    ])
    expect(map.get('A1')).toHaveLength(2)
    expect(map.get('A2')).toHaveLength(1)
    expect(map.has(undefined)).toBe(false)
  })
})

describe('summarizeFitments', () => {
  const vehicles = [
    { asset_no: 'A1', tyre_size: '295/80R22.5' }, // match
    { asset_no: 'A2', tyre_size: '295/80R22.5' }, // mismatch
    { asset_no: 'A3', tyre_size: '' },            // unknown (no spec)
    { asset_no: 'A4', tyre_size: '11R22.5' },     // unknown (no fitted tyres)
  ]
  const tyres = [
    { asset_no: 'A1', size: '295/80 r22.5', removal_date: null },
    { asset_no: 'A2', size: '315/80R22.5', removal_date: null },
    { asset_no: 'A3', size: '295/80R22.5', removal_date: null },
  ]

  it('produces correct counts and compliance %', () => {
    const s = summarizeFitments(vehicles, tyres)
    expect(s.counts).toMatchObject({ total: 4, match: 1, mismatch: 1, unknown: 2 })
    // compliance is over the 2 checked (match + mismatch): 1/2 = 50%
    expect(s.compliancePct).toBe(50)
    expect(s.rows).toHaveLength(4)
  })

  it('returns null compliance when nothing is checkable', () => {
    const s = summarizeFitments([{ asset_no: 'X', tyre_size: '' }], [])
    expect(s.compliancePct).toBeNull()
    expect(s.counts.unknown).toBe(1)
  })

  it('is null-safe on empty input', () => {
    const s = summarizeFitments(null, null)
    expect(s.counts).toMatchObject({ total: 0, match: 0, mismatch: 0, unknown: 0 })
  })
})
