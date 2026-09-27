import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/api/_client', () => ({ supabase: {}, unwrap: (r) => r?.data, ServiceError: Error }))

const { vehiclePhotoPath, legacyVehiclePhotoPath, resolveVehiclePhotoPath } = await import('../lib/api/vehicle360.js')

const ORG = '00000000-0000-0000-0000-000000000001'

describe('vehiclePhotoPath - org/country scoped storage path', () => {
  it('same asset code in two countries gets two different paths', () => {
    const ksa = vehiclePhotoPath({ orgId: ORG, country: 'KSA', assetNo: 'GN103', ext: 'jpg' })
    const uae = vehiclePhotoPath({ orgId: ORG, country: 'UAE', assetNo: 'GN103', ext: 'jpg' })
    expect(ksa).toBe(`${ORG}/KSA/GN103/photo.jpg`)
    expect(uae).toBe(`${ORG}/UAE/GN103/photo.jpg`)
    expect(ksa).not.toBe(uae)
  })

  it('same asset in two organisations gets two different paths', () => {
    const a = vehiclePhotoPath({ orgId: 'org-a', country: 'KSA', assetNo: 'TM514', ext: 'png' })
    const b = vehiclePhotoPath({ orgId: 'org-b', country: 'KSA', assetNo: 'TM514', ext: 'png' })
    expect(a).not.toBe(b)
  })

  it('upper-cases asset and country so spelling variants share one object', () => {
    expect(vehiclePhotoPath({ orgId: ORG, country: 'egypt', assetNo: ' tm514 ', ext: 'webp' }))
      .toBe(`${ORG}/EGYPT/TM514/photo.webp`)
  })

  it('sanitises every segment - no traversal or slashes', () => {
    const p = vehiclePhotoPath({ orgId: '../x', country: 'K/SA', assetNo: '../../etc', ext: 'jpg' })
    expect(p.split('/')).toHaveLength(4)
    expect(p).not.toContain('..')
  })

  it('never emits an empty segment; All is not a country', () => {
    expect(vehiclePhotoPath({ orgId: null, country: 'All', assetNo: 'BP041', ext: 'jpg' }))
      .toBe('no-org/NO-COUNTRY/BP041/photo.jpg')
  })
})

describe('legacy compatibility', () => {
  it('a row carrying the old path keeps reading that path', () => {
    const legacy = legacyVehiclePhotoPath('GN103', 'jpg')
    expect(legacy).toBe('GN103/photo.jpg')
    expect(resolveVehiclePhotoPath({ image_path: legacy })).toBe('GN103/photo.jpg')
  })

  it('a row carrying the new path reads the new path', () => {
    const p = `${ORG}/KSA/GN103/photo.jpg`
    expect(resolveVehiclePhotoPath({ image_path: p })).toBe(p)
  })

  it('no stored path -> null (no photo, no guessed path)', () => {
    expect(resolveVehiclePhotoPath({ image_path: null })).toBeNull()
    expect(resolveVehiclePhotoPath({ image_path: '  ' })).toBeNull()
    expect(resolveVehiclePhotoPath(null)).toBeNull()
  })
})
