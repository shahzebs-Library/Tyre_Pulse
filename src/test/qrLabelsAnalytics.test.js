import { describe, it, expect } from 'vitest'
import {
  labelCode, labelSub, qrState, filterLabelRows, summarizeLabels,
} from '../lib/qrLabelsAnalytics'

const tyres = [
  { id: 1, serial_number: 'EP060420711', asset_no: 'TM360', brand: 'Pirelli', site: 'NHC' },
  { id: 2, serial_number: null, asset_no: 'TM361', brand: 'Triangle', site: 'JED' },
  { id: 3, serial_number: null, asset_no: null, site: 'NHC' },
]

describe('labelCode / labelSub', () => {
  it('encodes the serial, falling back to the asset then the id', () => {
    expect(labelCode(tyres[0], 'tyres')).toBe('EP060420711')
    expect(labelCode(tyres[1], 'tyres')).toBe('TM361')
    expect(labelCode(tyres[2], 'tyres')).toBe('3')
    expect(labelCode({ asset_no: 'TM1' }, 'assets')).toBe('TM1')
  })
  it('builds an ASCII secondary line', () => {
    expect(labelSub(tyres[0], 'tyres')).toBe('Pirelli - NHC')
    expect(labelSub({ vehicle_type: 'TR-MIXER' }, 'assets')).toBe('TR-MIXER')
  })
})

describe('qrState + filterLabelRows', () => {
  const selected = new Set([1, 2])
  const qrImages = { 1: 'data:image/png;base64,x' }
  it('classifies each row', () => {
    expect(tyres.map(r => qrState(r, selected, qrImages))).toEqual(['ready', 'pending', 'idle'])
  })
  it('filters by search, site and QR state', () => {
    const ctx = { selected, qrImages }
    expect(filterLabelRows(tyres, { mode: 'tyres', search: 'ep06' }, ctx).map(r => r.id)).toEqual([1])
    expect(filterLabelRows(tyres, { mode: 'tyres', search: 'tm361' }, ctx).map(r => r.id)).toEqual([2])
    expect(filterLabelRows(tyres, { mode: 'tyres', site: 'NHC' }, ctx).map(r => r.id)).toEqual([1, 3])
    expect(filterLabelRows(tyres, { mode: 'tyres', qr: 'pending' }, ctx).map(r => r.id)).toEqual([2])
  })
})

describe('summarizeLabels', () => {
  it('counts selection, readiness and tyres labelled without a serial', () => {
    const s = summarizeLabels(tyres, 'tyres', new Set([1, 2, 99]), { 1: 'x' })
    expect(s).toEqual({ total: 3, selected: 2, ready: 1, pending: 1, sites: 2, noSerial: 2 })
    expect(summarizeLabels([{ id: 1, asset_no: 'A' }], 'assets').noSerial).toBeNull()
  })
})
