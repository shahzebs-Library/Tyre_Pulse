import { describe, it, expect } from 'vitest'
import {
  isMangledSerial,
  normChassis,
  normPlate,
  normAssetNo,
  buildFleetIndex,
  matchToAsset,
  matchAll,
  linkClaimToAccident,
  summarizeMatches,
  MIN_CONFIDENT_MATCH,
  METHOD_CONFIDENCE,
} from './insuranceMatch'

// Real-shaped fleet rows: KSA codes, Saudi plate spacing, a genuine VIN length.
const FLEET = [
  { id: 'f1', asset_no: 'TM655', country: 'KSA', site: 'DIRIYAH-G1', chassis_no: 'LZGJLDR41MX010101', registration_no: '8448 G X A', vehicle_type: 'TR-MIXER' },
  { id: 'f2', asset_no: 'TM736', country: 'KSA', site: 'NHC', chassis_no: 'LZGJLDR41MX020202', registration_no: '1981  JTA', vehicle_type: 'TR-MIXER' },
  { id: 'f3', asset_no: 'MP083', country: 'KSA', site: 'QIDDIYA', chassis_no: null, registration_no: null, vehicle_type: 'PUMPS' },
  // The V376 collision: the SAME code is a DIFFERENT machine in another country.
  { id: 'f4', asset_no: 'GN103', country: 'KSA', site: 'JED', chassis_no: null, registration_no: null, vehicle_type: 'GENERATOR' },
  { id: 'f5', asset_no: 'GN103', country: 'UAE', site: 'DXB', chassis_no: null, registration_no: null, vehicle_type: 'GENERATOR' },
]

describe('normalisers', () => {
  it('detects Excel scientific-notation wreckage and refuses it as a key', () => {
    expect(isMangledSerial('1.25121E+11')).toBe(true)
    expect(isMangledSerial('2.24E+22')).toBe(true)
    expect(isMangledSerial('LZGJLDR41MX010101')).toBe(false)
    // A mangled chassis normalises to null - it must never become a match key.
    expect(normChassis('1.25121E+11')).toBeNull()
  })

  it('strips ALL whitespace from a plate but never reorders it (V509)', () => {
    expect(normPlate('8448 G X A')).toBe('8448GXA')
    expect(normPlate('1981  JTA')).toBe(normPlate('1981 JTA'))
    // "KAA 4746" vs "4746 KAA" is a transposition, a judgement - stays distinct.
    expect(normPlate('KAA 4746')).not.toBe(normPlate('4746 KAA'))
  })

  it('upper-cases and de-spaces asset codes, and rejects blanks', () => {
    expect(normAssetNo(' tm655 ')).toBe('TM655')
    expect(normAssetNo('')).toBeNull()
    expect(normAssetNo(null)).toBeNull()
  })

  it('refuses a chassis too short to identify anything', () => {
    expect(normChassis('AB1')).toBeNull()
  })
})

describe('buildFleetIndex', () => {
  it('scopes to a country, so a shared code cannot cross the boundary', () => {
    const ksa = buildFleetIndex(FLEET, { country: 'KSA' })
    expect(ksa.size).toBe(4)
    expect(matchToAsset({ asset_no: 'GN103' }, ksa).asset_no).toBe('GN103')
    expect(matchToAsset({ asset_no: 'GN103' }, ksa).fleet.country).toBe('KSA')
  })

  it('publishes how much of the fleet is even reachable by a strong key', () => {
    const ksa = buildFleetIndex(FLEET, { country: 'KSA' })
    // Only 2 of 4 KSA assets carry a chassis or a plate - the honest ceiling.
    expect(ksa.keyCoverage.chassis).toBe(2)
    expect(ksa.keyCoverage.plate).toBe(2)
  })
})

describe('matchToAsset - it refuses rather than guesses', () => {
  const ksa = buildFleetIndex(FLEET, { country: 'KSA' })

  it('matches on chassis first, at the highest confidence', () => {
    const m = matchToAsset({ chassis_no: 'lzgjldr41mx010101', plate_no: 'nonsense' }, ksa)
    expect(m).toMatchObject({ asset_no: 'TM655', method: 'chassis' })
    expect(m.confidence).toBe(METHOD_CONFIDENCE.chassis)
  })

  it('matches on plate despite differing whitespace', () => {
    const m = matchToAsset({ plate_no: '8448GXA' }, ksa)
    expect(m).toMatchObject({ asset_no: 'TM655', method: 'plate' })
    expect(m.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENT_MATCH)
  })

  it('falls back to the asset code only when the strong keys yield nothing', () => {
    expect(matchToAsset({ asset_no: 'MP083' }, ksa)).toMatchObject({ asset_no: 'MP083', method: 'asset_no' })
  })

  it('returns UNMATCHED at confidence 0 when the fleet does not hold the key', () => {
    const m = matchToAsset({ chassis_no: 'LZGJNOTAREALVIN99' }, ksa)
    expect(m.asset_no).toBeNull()
    expect(m.confidence).toBe(0)
    expect(m.reason).toBe('not_in_fleet')
  })

  it('distinguishes "no usable key" from "not in the fleet"', () => {
    expect(matchToAsset({ chassis_no: '1.25121E+11' }, ksa).reason).toBe('no_usable_key')
    expect(matchToAsset({}, ksa).reason).toBe('no_usable_key')
  })

  it('calls a cross-country code AMBIGUOUS and never picks a side', () => {
    const all = buildFleetIndex(FLEET) // unscoped: GN103 exists twice
    const m = matchToAsset({ asset_no: 'GN103' }, all)
    expect(m.method).toBe('ambiguous')
    expect(m.asset_no).toBeNull()
    expect(m.confidence).toBe(0)
    expect(m.candidates).toBe(2)
  })

  it('lets a strong key disambiguate a code that is ambiguous on its own', () => {
    const all = buildFleetIndex(FLEET)
    // Ambiguous on asset_no, but the chassis names exactly one machine.
    const m = matchToAsset({ asset_no: 'GN103', chassis_no: 'LZGJLDR41MX010101' }, all)
    expect(m).toMatchObject({ asset_no: 'TM655', method: 'chassis' })
  })

  it('handles an empty index and a null row without throwing', () => {
    expect(matchToAsset({ asset_no: 'TM655' }, buildFleetIndex([])).asset_no).toBeNull()
    expect(matchToAsset(null, ksa).method).toBe('unmatched')
  })
})

describe('linkClaimToAccident', () => {
  const ACCIDENTS = [
    { id: 'a1', asset_no: 'TM655', incident_date: '2026-03-10', insurance_claim_no: 'CLM-9001' },
    { id: 'a2', asset_no: 'TM736', incident_date: '2026-04-02', insurance_claim_no: null },
    { id: 'a3', asset_no: 'TM736', incident_date: '2026-04-03', insurance_claim_no: null },
  ]

  it('prefers the insurer claim number when the accident echoes it', () => {
    expect(linkClaimToAccident({ claim_no: 'CLM-9001', asset_no: 'TM655', accident_date: '2026-01-01' }, ACCIDENTS))
      .toMatchObject({ accident_id: 'a1', method: 'claim_no' })
  })

  it('falls back to asset plus a date window', () => {
    expect(linkClaimToAccident({ claim_no: 'X', asset_no: 'TM655', accident_date: '2026-03-11' }, ACCIDENTS))
      .toMatchObject({ accident_id: 'a1', method: 'asset_date' })
  })

  it('refuses when two accidents sit in the window - it does not pick one', () => {
    const m = linkClaimToAccident({ claim_no: 'X', asset_no: 'TM736', accident_date: '2026-04-02' }, ACCIDENTS)
    expect(m.accident_id).toBeUndefined()
    expect(m.method).toBe('ambiguous')
    expect(m.candidates).toBe(2)
  })

  it('reports "no accident in window" distinctly from "no usable key"', () => {
    expect(linkClaimToAccident({ asset_no: 'TM655', accident_date: '2025-01-01' }, ACCIDENTS).reason)
      .toBe('no_accident_in_window')
    expect(linkClaimToAccident({ asset_no: null, accident_date: null }, ACCIDENTS).reason).toBe('no_usable_key')
  })
})

describe('summarizeMatches', () => {
  it('counts only confident matches, and reports a null rate on an empty set', () => {
    const ksa = buildFleetIndex(FLEET, { country: 'KSA' })
    const s = summarizeMatches(matchAll([{ chassis_no: 'LZGJLDR41MX010101' }, { chassis_no: 'NOPE12345' }], ksa))
    expect(s).toMatchObject({ total: 2, matched: 1, unresolved: 1 })
    expect(s.matchRate).toBe(0.5)
    // Nothing to match is not a 0% match rate - it is not a measurement.
    expect(summarizeMatches([]).matchRate).toBeNull()
  })
})
