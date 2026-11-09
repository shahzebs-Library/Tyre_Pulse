import { describe, it, expect } from 'vitest'
import { sizeKeyFromText, assetSizeKeys, stockReadiness } from '../lib/workforceStockReadiness'

describe('sizeKeyFromText (real stock descriptions)', () => {
  it.each([
    ['TIRE 315/80 R22.5 TECHKING', '315/80R22.5'],
    ['315/80R22.5 Eracle', '315/80R22.5'],
    ['TIRE 385-65R22.5', '385/65R22.5'],
    ['TIRE 235-75R17.5 TL 16PR', '235/75R17.5'],
    ['TIRE 215/70 R 16', '215/70R16'],
    ['TIRE 23.5 R25 20PR TL RADIAL', '23.5R25'],
    ['23.5.R.25 Doublecoin', '23.5R25'],
    ['TIRE 11R22.5 TL 16PR', '11R22.5'],
    ['TIRE 9.00R20 HANK', '9.00R20'],
    ['TIRE 7.00 R16 10PR R 230TT BRIDGESTONE', '7.00R16'],
    ['TIRE 195R15 6PR', '195R15'],
    ['TIRE 205R16 /689', '205R16'],
    ['TIRE 10-16.5/10 SKS-1 allainz', '10-16.5'],
    ['TIRE 10-16.5', '10-16.5'],
  ])('%s -> %s', (text, key) => expect(sizeKeyFromText(text)).toBe(key))

  it.each([
    ['700 R 16', '7.00R16'], ['1200 R 24', '12.00R24'], ['315 /80R22.5', '315/80R22.5'],
    ['11 R 22.5', '11R22.5'], ['195 R 15', '195R15'], ['10-16.5/10', '10-16.5'],
  ])('fitted-tyre spelling %s -> %s', (text, key) => expect(sizeKeyFromText(text)).toBe(key))

  it('does not guess a size from a typo or a bare width', () => {
    expect(sizeKeyFromText('35/70 R 16')).toBeNull()
    expect(sizeKeyFromText('315')).toBeNull()
    expect(sizeKeyFromText('ITEM/TYRE')).toBeNull()
  })

  it('returns null when no size can be read', () => {
    expect(sizeKeyFromText('TYRE VALVE')).toBeNull()
    expect(sizeKeyFromText('')).toBeNull()
    expect(sizeKeyFromText(null)).toBeNull()
  })
})

describe('assetSizeKeys', () => {
  it('prefers tyres currently fitted and ignores removed ones', () => {
    expect(assetSizeKeys([
      { size: '315/80 R22.5', status: 'Active' },
      { size: '385/65R22.5', status: 'Removed', removal_date: '2026-01-01' },
    ])).toEqual(['315/80R22.5'])
  })
  it('falls back to history when nothing is active', () => {
    expect(assetSizeKeys([{ size: '12.00R24', status: 'Removed', removal_date: '2025-01-01' }])).toEqual(['12.00R24'])
  })
})

describe('stockReadiness', () => {
  const stock = [
    { site: 'NHC', description: 'TIRE 315/80 R22.5 TECHKING', tyre_size: '315/80 R22.5', stock_qty: 73, stock_status: 'OK' },
    { site: 'NHC', description: '315/80R22.5 Double coin', stock_qty: 35, stock_status: 'OK' },
    { site: 'NHC', description: 'TIRE 23.5 R25 20PR TL RADIAL', stock_qty: 0, stock_status: 'Critical' },
    { site: 'RIY-MET', description: '385/65R22.5 Double coin', stock_qty: 2, stock_status: 'Critical' },
    { site: 'DIRIYAH', description: 'TIRE 23.5 R25 20PR', stock_qty: 1, stock_status: 'OK' },
  ]
  it('sums every row of the size at the site', () => {
    const r = stockReadiness({ sizes: ['315/80R22.5'], site: 'nhc', stockRows: stock })
    expect(r.state).toBe('in_stock')
    expect(r.lines[0].qty).toBe(108)
  })
  it('out of stock here, and names where it is', () => {
    const r = stockReadiness({ sizes: ['23.5R25'], site: 'NHC', stockRows: stock })
    expect(r.state).toBe('out')
    expect(r.lines[0].elsewhere).toEqual([{ site: 'DIRIYAH', qty: 1 }])
  })
  it('a status the store marked Critical reads low even with stock', () => {
    expect(stockReadiness({ sizes: ['385/65R22.5'], site: 'RIY-MET', stockRows: stock }).state).toBe('low')
  })
  it('no stock row is not the same as zero stock', () => {
    const r = stockReadiness({ sizes: ['385/65R22.5'], site: 'NHC', stockRows: stock })
    expect(r.state).toBe('no_record')
    expect(r.lines[0].qty).toBeNull()
  })
  it('honest states when size or site is missing', () => {
    expect(stockReadiness({ sizes: [], site: 'NHC', stockRows: stock }).state).toBe('unknown_size')
    expect(stockReadiness({ sizes: ['315/80R22.5'], site: '', stockRows: stock }).state).toBe('no_site')
  })
  it('the worst size decides the overall state', () => {
    expect(stockReadiness({ sizes: ['315/80R22.5', '23.5R25'], site: 'NHC', stockRows: stock }).state).toBe('out')
  })
})
