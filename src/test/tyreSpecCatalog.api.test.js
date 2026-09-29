import { describe, it, expect } from 'vitest'
import { catalogPayload, validateCatalogFile, safeFileName, fileRef } from '../lib/api/tyreSpecCatalog'

describe('tyreSpecCatalog payload whitelist', () => {
  it('drops server-owned and unknown keys and coerces types', () => {
    const p = catalogPayload({
      id: 'x', organisation_id: 'o', approved_by: 'u', approved_at: 'now', created_by: 'u', updated_at: 'now', hacker: 1,
      brand: ' Triangle ', pattern: 'TR685', size: '315/80R22.5', load_index_single: '156.4', load_index_dual: '',
      weight_kg: '68.5', tyre_type: 'bogus', tube_type: 'tube', approval_status: 'approved', suitable_for: [' Mixer ', ''],
      images: [{ path: 'o/spec-catalog/1/a.png', name: 'a.png', type: 'image/png', size: 10, junk: 1 }, { name: 'nopath' }],
    })
    expect(Object.keys(p).sort()).toEqual(['approval_status', 'brand', 'images', 'load_index_dual', 'load_index_single',
      'pattern', 'size', 'suitable_for', 'tube_type', 'tyre_type', 'weight_kg'])
    expect(p).toMatchObject({ brand: 'Triangle', load_index_single: 156, load_index_dual: null, weight_kg: 68.5, tyre_type: null, tube_type: 'tube', suitable_for: ['Mixer'] })
    expect(p.images).toEqual([{ path: 'o/spec-catalog/1/a.png', name: 'a.png', type: 'image/png', size: 10, uploaded_at: null }])
  })
  it('writes only keys present (a status change does not blank other columns)', () => {
    expect(catalogPayload({ approval_status: 'not_approved' })).toEqual({ approval_status: 'not_approved' })
    expect(catalogPayload({ approval_status: 'maybe' })).toEqual({})
  })
  it('validates files and builds safe storage names', () => {
    expect(validateCatalogFile({ type: 'application/pdf', size: 100 })).toBe('pdf')
    expect(() => validateCatalogFile({ type: 'image/gif', size: 1 })).toThrow(/JPG, PNG or PDF/)
    expect(() => validateCatalogFile({ type: 'image/png', size: 11 * 1024 * 1024 })).toThrow(/10 MB/)
    expect(safeFileName('../evil name!!.png', 'png')).toBe('evil-name.png')
    expect(fileRef({ path: 'o/spec-catalog/1/a.png' })).toBe('tp-storage://tyre-photos/o/spec-catalog/1/a.png')
  })
})
