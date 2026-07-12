import { describe, it, expect } from 'vitest'
import { summarizeDvir } from '../lib/dvir'

describe('dvir — summarizeDvir', () => {
  const rows = [
    { asset_no: 'TRK-01', defects_found: true, safe_to_operate: false, status: 'open' },
    { asset_no: 'TRK-01', defects_found: false, safe_to_operate: true, status: 'resolved' },
    { asset_no: 'TRK-02', defects_found: true, safe_to_operate: true, status: 'open' },
    { asset_no: 'TRK-03', defects_found: false, safe_to_operate: true, status: 'closed' },
    { asset_no: 'TRK-02', defects_found: true, safe_to_operate: false, status: 'open' },
  ]

  it('counts total reports', () => {
    expect(summarizeDvir(rows).total).toBe(5)
  })

  it('counts reports with defects', () => {
    expect(summarizeDvir(rows).withDefects).toBe(3)
  })

  it('counts reports flagged unsafe to operate', () => {
    expect(summarizeDvir(rows).unsafe).toBe(2)
  })

  it('counts open reports', () => {
    expect(summarizeDvir(rows).open).toBe(3)
  })

  it('counts distinct assets inspected', () => {
    // TRK-01, TRK-02, TRK-03
    expect(summarizeDvir(rows).distinctAssets).toBe(3)
  })

  it('treats missing safe_to_operate as safe (not unsafe)', () => {
    const s = summarizeDvir([
      { asset_no: 'A', status: 'open' },
      { asset_no: 'B', safe_to_operate: null, status: 'open' },
    ])
    expect(s.unsafe).toBe(0)
  })

  it('tolerates string/number truthy forms for defects_found', () => {
    const s = summarizeDvir([
      { asset_no: 'A', defects_found: 'true' },
      { asset_no: 'B', defects_found: 1 },
      { asset_no: 'C', defects_found: '1' },
      { asset_no: 'D', defects_found: 'false' },
    ])
    expect(s.withDefects).toBe(3)
  })

  it('treats string/number falsy forms of safe_to_operate as unsafe', () => {
    const s = summarizeDvir([
      { asset_no: 'A', safe_to_operate: 'false' },
      { asset_no: 'B', safe_to_operate: 0 },
    ])
    expect(s.unsafe).toBe(2)
  })

  it('ignores blank asset numbers in the distinct-asset count', () => {
    const s = summarizeDvir([
      { asset_no: '', status: 'open' },
      { asset_no: '   ', status: 'open' },
      { asset_no: 'X', status: 'open' },
    ])
    expect(s.distinctAssets).toBe(1)
  })

  it('handles empty / non-array / null input safely', () => {
    expect(summarizeDvir([]).total).toBe(0)
    expect(summarizeDvir([]).distinctAssets).toBe(0)
    expect(summarizeDvir(null).total).toBe(0)
    expect(summarizeDvir(undefined).withDefects).toBe(0)
    expect(summarizeDvir(null).unsafe).toBe(0)
  })

  it('skips null entries within the list', () => {
    const s = summarizeDvir([null, { asset_no: 'A', defects_found: true, status: 'open' }, undefined])
    expect(s.total).toBe(3)
    expect(s.withDefects).toBe(1)
    expect(s.distinctAssets).toBe(1)
  })
})
