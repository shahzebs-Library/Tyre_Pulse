import { describe, it, expect } from 'vitest'
import { buildAliasMap, applyAliases, applyAliasesToRow } from '../lib/import'
import { normaliseToken } from '../lib/import/synonyms'

describe('import engine - master-data aliases', () => {
  const aliases = [
    { raw_value: 'Qiddiya-1', canonical_value: 'Qiddiya G1', canonical_id: 'q1' },
    { raw_value: 'QD G1', canonical_value: 'Qiddiya G1' },
    { raw_value: 'Bridge Stone', canonical_value: 'Bridgestone' },
  ]

  it('builds a map keyed by normalised raw value (case/punctuation-insensitive)', () => {
    const m = buildAliasMap(aliases)
    // 'Qiddiya-1' and 'qiddiya 1' collapse to the same key
    expect(m.get(normaliseToken('qiddiya 1'))?.canonical_value).toBe('Qiddiya G1')
  })

  it('rewrites a matching field to the canonical value and preserves casing', () => {
    const m = buildAliasMap(aliases)
    const out = applyAliasesToRow({ site: 'qiddiya-1', asset_no: 'A1' }, 'site', m)
    expect(out.site).toBe('Qiddiya G1')
    expect(out.asset_no).toBe('A1')
  })

  it('returns a NEW array and never mutates inputs', () => {
    const m = buildAliasMap(aliases)
    const rows = [{ brand: 'Bridge Stone' }, { brand: 'Michelin' }]
    const out = applyAliases(rows, 'brand', m)
    expect(out).not.toBe(rows)
    expect(rows[0].brand).toBe('Bridge Stone') // original untouched
    expect(out[0].brand).toBe('Bridgestone')
  })

  it('leaves unmatched / blank values exactly as-is (no auto-create, no blanking)', () => {
    const m = buildAliasMap(aliases)
    expect(applyAliasesToRow({ site: 'Unknown Site' }, 'site', m).site).toBe('Unknown Site')
    expect(applyAliasesToRow({ site: '' }, 'site', m).site).toBe('')
    expect(applyAliasesToRow({ asset_no: 'A1' }, 'site', m)).toEqual({ asset_no: 'A1' })
  })

  it('an empty map is a no-op passthrough', () => {
    const rows = [{ site: 'x' }]
    expect(applyAliases(rows, 'site', buildAliasMap([]))).toEqual(rows)
  })
})
