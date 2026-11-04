import { describe, it, expect } from 'vitest'
import { serialProblem, serialFlags, serialFlagText, fleetSerialFindings, isRealSerial } from '../lib/tyreSerialCheck'

describe('serialProblem', () => {
  it('spots values that are not serials', () => {
    expect(serialProblem('205/85 R 16')).toBe('size')
    expect(serialProblem('195 R 15')).toBe('size')
    expect(serialProblem('315/80R22.5')).toBe('size')
    expect(serialProblem('12.00R24')).toBe('size')
    expect(serialProblem('1.25131E+11')).toBe('excel')
    expect(serialProblem('1')).toBe('too_short')
  })
  it('accepts real serials and treats blanks as not recorded', () => {
    expect(serialProblem('YMM36599')).toBeNull()
    expect(serialProblem('11041331402')).toBeNull()
    expect(serialProblem('DOT18E56')).toBeNull()
    expect(serialProblem('')).toBeNull()
    expect(serialProblem('N/A')).toBeNull()
    expect(isRealSerial('N/A')).toBe(false)
    expect(isRealSerial('YMM36599')).toBe(true)
  })
})

describe('serialFlags', () => {
  it('flags the same serial on two wheels of one vehicle (TM424)', () => {
    const f = serialFlags([
      { position: 'LHF2', serial: 'YMM36599' },
      { position: 'LHRI', serial: ' ymm36599 ' },
      { position: 'RHF1', serial: 'ABC12345' },
    ])
    expect(f.duplicates).toEqual([{ serial: 'YMM36599', positions: ['LHF2', 'LHRI'] }])
    expect(serialFlagText(f.byPosition.LHF2)).toBe('Same serial as LHRI')
    expect(f.byPosition.RHF1).toBeUndefined()
  })
  it('does not call blank wheels duplicates', () => {
    const f = serialFlags([{ position: 'A', serial: 'N/A' }, { position: 'B', serial: 'N/A' }, { position: 'C', serial: null }])
    expect(f.count).toBe(0)
  })
  it('reports bad serials once, not as duplicates', () => {
    const f = serialFlags([{ position: 'LHF1', serial: '1' }, { position: 'RHF1', serial: '1' }])
    expect(f.duplicates).toEqual([])
    expect(f.invalid.map((x) => x.kind)).toEqual(['too_short', 'too_short'])
  })
})

describe('fleetSerialFindings', () => {
  it('keeps countries apart and finds two-vehicle serials', () => {
    const r = fleetSerialFindings([
      { asset_no: 'TM424', country: 'KSA', tyre_position: 'LHF2', serial_no: 'YMM36599' },
      { asset_no: 'TM424', country: 'KSA', tyre_position: 'LHRI', serial_no: 'YMM36599' },
      { asset_no: 'TM500', country: 'KSA', tyre_position: 'LHF1', serial_no: 'SERIAL99' },
      { asset_no: 'TM501', country: 'KSA', tyre_position: 'LHF1', serial_no: 'SERIAL99' },
      { asset_no: 'TM500', country: 'UAE', tyre_position: 'LHF1', serial_no: 'SERIAL77' },
      { asset_no: 'TM777', country: 'KSA', tyre_position: 'LHF1', serial_no: 'SERIAL77' },
      { asset_no: 'PL083', country: 'KSA', tyre_position: 'LHF1', serial_no: '195 R 15' },
    ])
    expect(r.sameVehicle).toEqual([{ asset_no: 'TM424', country: 'KSA', serial: 'YMM36599', positions: ['LHF2', 'LHRI'] }])
    expect(r.multiVehicle.map((x) => x.serial)).toEqual(['SERIAL99'])
    expect(r.invalid).toHaveLength(1)
  })
})
