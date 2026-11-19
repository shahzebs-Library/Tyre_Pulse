import { describe, it, expect } from 'vitest'
import { positionInfo, positionCaption, locationInfo, currentAssignment } from '../lib/serialTrackerView'

describe('positionInfo', () => {
  it('Active tyre: padded code is trimmed and shown as fitted now', () => {
    const i = positionInfo({ status: 'Active', tyre_position: 'LHF1    ' })
    expect(i).toMatchObject({ kind: 'current', code: 'LHF1', fitted: true })
    expect(positionCaption(i)).toBe('Fitted now')
    expect(i.label).toBeTruthy()
  })
  it('Removed and Scrapped tyres are last known, never fitted', () => {
    for (const status of ['Removed', 'Scrapped']) {
      const i = positionInfo({ status, position: 'rhco' })
      expect(i).toMatchObject({ kind: 'last', code: 'RHCO', fitted: false })
      expect(positionCaption(i)).toBe('Last known')
    }
  })
  it('prefers tyre_position, falls back to position', () => {
    expect(positionInfo({ status: 'Active', tyre_position: 'LHR1-O', position: 'x' }).code).toBe('LHR1-O')
    expect(positionInfo({ status: 'Active', position: ' RHF2 ' }).code).toBe('RHF2')
  })
  it('unrecognised but real codes are kept as trimmed text', () => {
    expect(positionInfo({ status: 'Removed', tyre_position: ' RHRRO ' })).toMatchObject({ kind: 'last', code: 'RHRRO', label: null })
  })
  it('missing and placeholder positions are unknown with a reason', () => {
    for (const v of [null, '', '   ', '0', '1', 'N/A', 'TYRE POSITION']) {
      const i = positionInfo({ status: 'Active', tyre_position: v })
      expect(i.kind).toBe('unknown')
      expect(i.code).toBe(null)
      expect(i.reason).toBeTruthy()
      expect(positionCaption(i)).toBe(null)
    }
  })
})

describe('locationInfo', () => {
  it('uses the record site first, trimmed', () => {
    expect(locationInfo({ site: ' NHC ', asset_no: 'TM1' }, 'JED')).toEqual({ site: 'NHC', source: 'record', reason: null })
  })
  it('falls back to the vehicle register and says so', () => {
    expect(locationInfo({ site: null, asset_no: 'TM1', fleet_site: 'JED' })).toMatchObject({ site: 'JED', source: 'vehicle register' })
    expect(locationInfo({ site: '', asset_no: 'TM1' }, 'JED')).toMatchObject({ site: 'JED' })
  })
  it('reports an honest reason when nothing is known', () => {
    expect(locationInfo({ asset_no: 'TM1' }).reason).toMatch(/No site/)
    expect(locationInfo({ asset_no: '' }).reason).toMatch(/Not fitted/)
    expect(locationInfo({ asset_no: 'TM1' }).site).toBe(null)
  })
})

describe('currentAssignment position', () => {
  it('uses the canonical trimmed code', () => {
    expect(currentAssignment([{ status: 'Active', asset_no: 'A', tyre_position: 'RHF2   ' }]).position).toBe('RHF2')
  })
})
