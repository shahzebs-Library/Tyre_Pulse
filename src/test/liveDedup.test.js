import { describe, it, expect } from 'vitest'
import { naturalKey } from '../lib/import'

/**
 * Live-table duplicate detection (Phase 2).
 *
 * naturalKey() must produce EXACTLY the same key the server RPC
 * import_existing_keys() builds: norm(v)=lower(trim(v)), parts joined with a
 * U+0001 (SOH) separator (chr(1) in SQL). The UI matches a freshly transformed
 * row against the set of keys already present in the live table and skips it.
 */

const SEP = String.fromCharCode(1) // keyParts() part separator (U+0001) - must match SQL chr(1)

describe('naturalKey - module key construction', () => {
  it('fleet key = norm(country) | norm(asset_no)', () => {
    expect(naturalKey({ country: 'KSA', asset_no: 'V-100' }, 'fleet')).toBe(`ksa${SEP}v-100`)
    // whitespace + case are normalised identically to the SQL norm()
    expect(naturalKey({ country: ' ksa ', asset_no: ' V-100 ' }, 'fleet')).toBe(`ksa${SEP}v-100`)
  })

  it('tyre key = norm(country) | norm(serial_no)', () => {
    expect(naturalKey({ country: 'UAE', serial_no: 'SN-1' }, 'tyre')).toBe(`uae${SEP}sn-1`)
  })

  it('stock key = norm(country) | norm(site) | norm(description)', () => {
    expect(naturalKey({ country: 'KSA', site: 'Riyadh', description: 'Filter' }, 'stock')).toBe(`ksa${SEP}riyadh${SEP}filter`)
  })

  it('accepts a wrapped { transformed } row as well as a flat row', () => {
    const flat = { country: 'KSA', asset_no: 'V-100' }
    expect(naturalKey({ transformed: flat }, 'fleet')).toBe(naturalKey(flat, 'fleet'))
  })

  it('returns null when the identifying component is missing', () => {
    expect(naturalKey({ country: 'KSA' }, 'fleet')).toBeNull()      // no asset_no
    expect(naturalKey({ country: 'UAE' }, 'tyre')).toBeNull()       // no serial_no
    // stock: null only when BOTH site and description are blank (keyParts rule)
    expect(naturalKey({ country: 'KSA' }, 'stock')).toBeNull()
  })

  it('throws for an unknown module', () => {
    expect(() => naturalKey({}, 'nope')).toThrow()
  })
})

/**
 * Pure re-implementation of the wizard's skip transformation, kept identical to
 * DataIntakeCenter.runValidation(): a row whose natural key is already live
 * becomes dup_status='duplicate' (unless already 'conflict') and action='skip'.
 */
function applyLiveDedup(rows, liveKeys, module) {
  return rows.map((r) => {
    let action = r.validationStatus === 'error' ? 'reject' : 'insert'
    let liveDuplicate = false
    let dupStatus = r.dupStatus || 'none'
    if (liveKeys && r.validationStatus !== 'error') {
      const key = naturalKey(r.transformed, module)
      if (key && liveKeys.has(key)) {
        liveDuplicate = true
        if (dupStatus !== 'conflict') dupStatus = 'duplicate'
        action = 'skip'
      }
    }
    return { ...r, action, liveDuplicate, dupStatus }
  })
}

describe('live dedup - skip transformation', () => {
  const module = 'fleet'
  const live = new Set([naturalKey({ country: 'KSA', asset_no: 'V-100' }, module)])

  it('marks a row already present in the live table as skip', () => {
    const rows = [
      { transformed: { country: 'KSA', asset_no: 'V-100' }, validationStatus: 'ready', dupStatus: 'none' },
      { transformed: { country: 'KSA', asset_no: 'V-200' }, validationStatus: 'ready', dupStatus: 'none' },
    ]
    const out = applyLiveDedup(rows, live, module)
    expect(out[0].action).toBe('skip')
    expect(out[0].dupStatus).toBe('duplicate')
    expect(out[0].liveDuplicate).toBe(true)
    // a row not present live stays insertable
    expect(out[1].action).toBe('insert')
    expect(out[1].liveDuplicate).toBe(false)
  })

  it('never overrides a pre-existing conflict status', () => {
    const rows = [{ transformed: { country: 'KSA', asset_no: 'V-100' }, validationStatus: 'warning', dupStatus: 'conflict' }]
    const out = applyLiveDedup(rows, live, module)
    expect(out[0].action).toBe('skip')
    expect(out[0].dupStatus).toBe('conflict')
  })

  it('leaves error rows as reject, never skip', () => {
    const rows = [{ transformed: { country: 'KSA', asset_no: 'V-100' }, validationStatus: 'error', dupStatus: 'none' }]
    const out = applyLiveDedup(rows, live, module)
    expect(out[0].action).toBe('reject')
    expect(out[0].liveDuplicate).toBe(false)
  })

  it('falls back to insert when live keys are unavailable (RPC not deployed)', () => {
    const rows = [{ transformed: { country: 'KSA', asset_no: 'V-100' }, validationStatus: 'ready', dupStatus: 'none' }]
    const out = applyLiveDedup(rows, null, module)
    expect(out[0].action).toBe('insert')
    expect(out[0].liveDuplicate).toBe(false)
  })
})
