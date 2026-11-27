import { describe, it, expect } from 'vitest'
import {
  normalizePlate, plateKey, normalizeChassis, chassisHasInvalidVinChars, assetKey,
  verificationPhotoPath, previewVerification, verificationProgress, canVerify, canApprove,
  verificationBadge,
} from '../lib/fleetVerification'

describe('normalisers mirror the SQL', () => {
  it('normalizePlate collapses whitespace and upper-cases', () => {
    expect(normalizePlate(' 1234  abc ')).toBe('1234 ABC')
    expect(normalizePlate('   ')).toBeNull()
    expect(normalizePlate(null)).toBeNull()
  })
  it('plateKey strips every space but never reorders', () => {
    expect(plateKey('2041  XXB')).toBe('2041XXB')
    expect(plateKey('KAA 4746')).not.toBe(plateKey('4746 KAA'))
  })
  it('normalizeChassis maps Cyrillic lookalikes and strips separators', () => {
    expect(normalizeChassis(' lzg-РС 1.23 ')).toBe('LZGPC123')
    expect(normalizeChassis('АВЕКМНОРСТХУ')).toBe('ABEKMHOPCTXY')
    expect(normalizeChassis('')).toBeNull()
  })
  it('flags I/O/Q in a chassis', () => {
    expect(chassisHasInvalidVinChars('LZG0OQ')).toBe(true)
    expect(chassisHasInvalidVinChars('LZG123')).toBe(false)
    expect(chassisHasInvalidVinChars(null)).toBe(false)
  })
  it('assetKey removes spaces', () => {
    expect(assetKey(' tm 514 ')).toBe('TM514')
  })
})

describe('photo path', () => {
  it('is unique per verification', () => {
    expect(verificationPhotoPath({ orgId: 'ABC-1', country: 'ksa', assetNo: 'tm514', verificationId: 'V-1', ext: 'JPG' }))
      .toBe('abc-1/KSA/TM514/verify/v-1.jpg')
  })
  it('cannot traverse', () => {
    expect(verificationPhotoPath({ orgId: '../x', country: '..', assetNo: 'a/b', verificationId: 'id' })).not.toContain('..')
  })
})

describe('previewVerification', () => {
  const vehicle = { id: 'v1', asset_no: 'TM514', registration_no: null, chassis_no: null }
  it('fills blank fields and applies straight away', () => {
    const p = previewVerification({ vehicle, outcome: 'present', observedPlate: '1234 abc', observedChassis: 'LZG123', hasPhoto: true })
    expect(p.status).toBe('auto_applied')
    expect(p.applyNow).toEqual(['registration_no', 'chassis_no', 'image_path'])
  })
  it('a different plate waits and keeps the old value; blank chassis still fills', () => {
    const p = previewVerification({ vehicle: { ...vehicle, registration_no: '9999 ZZZ' }, outcome: 'present', observedPlate: '1234 ABC', observedChassis: 'LZG123', hasPhoto: true })
    expect(p.status).toBe('pending')
    expect(p.flags).toContain('plate_changed')
    expect(p.applyNow).toEqual(['chassis_no'])
  })
  it('a spacing-only difference is not a change', () => {
    const p = previewVerification({ vehicle: { ...vehicle, registration_no: '1234  ABC' }, outcome: 'present', observedPlate: '1234ABC' })
    expect(p.status).toBe('auto_applied')
  })
  it('duplicate on another machine waits and does not fill', () => {
    const p = previewVerification({ vehicle, outcome: 'present', observedPlate: '1234 ABC', others: [{ id: 'v2', registration_no: '1234ABC' }, { id: 'v1', registration_no: '1234 ABC' }] })
    expect(p.flags).toEqual(['duplicate_plate'])
    expect(p.applyNow).toEqual([])
  })
  it('asset code mismatch waits', () => {
    expect(previewVerification({ vehicle, outcome: 'present', observedAssetNo: 'TM515' }).flags).toEqual(['asset_code_mismatch'])
  })
  it('not found / other country always wait', () => {
    expect(previewVerification({ vehicle, outcome: 'not_found' })).toEqual({ status: 'pending', flags: ['not_found'], applyNow: [] })
    expect(previewVerification({ vehicle, outcome: 'other_country' }).status).toBe('pending')
    expect(previewVerification({ vehicle, outcome: 'x' }).status).toBe('invalid')
  })
})

describe('roles, progress, badge', () => {
  it('only Fleet Supervisor / Fleet Incharge / Admin / super admin verify', () => {
    expect(canVerify({ role: 'Fleet Supervisor' })).toBe(true)
    expect(canVerify({ role: 'Fleet Incharge' })).toBe(true)
    expect(canVerify({ role: 'Admin' })).toBe(true)
    expect(canVerify({ role: 'Manager' })).toBe(false)
    expect(canVerify({ role: 'Driver', isSuperAdmin: true })).toBe(true)
  })
  it('only Admin / Manager approve', () => {
    expect(canApprove({ role: 'Manager' })).toBe(true)
    expect(canApprove({ role: 'Fleet Supervisor' })).toBe(false)
  })
  it('progress counts verified and pending, pct null when empty', () => {
    expect(verificationProgress([{ verification_status: 'verified' }, { verification_status: 'pending' }, {}, {}]))
      .toEqual({ verified: 1, pending: 1, total: 4, pct: 25 })
    expect(verificationProgress([]).pct).toBeNull()
  })
  it('badge falls back to not verified', () => {
    expect(verificationBadge(undefined).key).toBe('fleetVerification.status.never')
    expect(verificationBadge('verified').tone).toBe('good')
  })
})
