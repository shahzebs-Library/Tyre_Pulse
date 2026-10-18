import { describe, it, expect, vi, beforeEach } from 'vitest'
import { avatarInitials, avatarCrop, avatarSource, isAvatarImage, validateAvatarFile, AVATAR_LIMIT } from '../lib/profileAvatar'
const h = vi.hoisted(() => ({ identity: null, result: null, patch: null, filter: null }))
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: h.identity }, error: null }) },
  from: () => ({ update: patch => { h.patch = patch; return { eq: (key, value) => { h.filter = [key, value]; return { select: () => ({ single: async () => h.result }) } } } } }),
} }))
import { saveMyAvatar } from '../lib/api/profileAvatar'
const photo = 'data:image/jpeg;base64,/9j/AA=='
beforeEach(() => { h.identity = { id: 'self' }; h.patch = null; h.filter = null; h.result = { data: { id: 'self', avatar_url: photo }, error: null } })

describe('profile pictures', () => {
  it('supports names in either language without HTML interpolation', () => {
    expect(avatarInitials(' Shahzeb Rahman ')).toBe('SR')
    expect(avatarInitials('محمد علي')).toBe('مع')
    expect(avatarInitials('')).toBe('U')
  })
  it('bounds the crop inside portrait and landscape images at every zoom and position', () => {
    for (const [width, height] of [[600, 1200], [1600, 800]]) for (const zoom of [0, 1, 2, 3, 10]) for (const vertical of [-5, 0, 50, 100, 200]) {
      const crop = avatarCrop(width, height, zoom, vertical)
      expect(crop.x).toBeGreaterThanOrEqual(0); expect(crop.y).toBeGreaterThanOrEqual(0)
      expect(crop.x + crop.side).toBeLessThanOrEqual(width); expect(crop.y + crop.side).toBeLessThanOrEqual(height)
    }
  })
  it('rejects unsupported uploads, oversized thumbnails, and script or SVG sources', () => {
    expect(() => validateAvatarFile({ type: 'image/svg+xml', size: 20 })).toThrow()
    expect(() => validateAvatarFile({ type: 'image/jpeg', size: 6000000 })).toThrow()
    expect(isAvatarImage(photo)).toBe(true)
    expect(isAvatarImage(photo + 'a'.repeat(AVATAR_LIMIT))).toBe(false)
    expect(avatarSource('javascript:alert(1)')).toBe('')
    expect(avatarSource('data:image/svg+xml,<svg/>')).toBe('')
    expect(avatarSource('https://example.com/avatar.jpg')).toBe('https://example.com/avatar.jpg')
  })
  it('updates only the current user photo and announces the verified save', async () => {
    const listener = vi.fn(); window.addEventListener('tp-profile-avatar', listener)
    await expect(saveMyAvatar(photo, 'self')).resolves.toBe(photo)
    expect(h.patch).toEqual({ avatar_url: photo }); expect(h.filter).toEqual(['id', 'self'])
    expect(listener.mock.calls[0][0].detail).toEqual({ id: 'self', value: photo })
    window.removeEventListener('tp-profile-avatar', listener)
  })
  it('rejects a stale account identity before writing and does not report success for a missing row', async () => {
    await expect(saveMyAvatar(photo, 'other')).rejects.toThrow(); expect(h.patch).toBeNull()
    h.result = { data: null, error: null }
    await expect(saveMyAvatar(photo, 'self')).rejects.toThrow()
  })
  it('removes a picture and surfaces save errors without announcing success', async () => {
    h.result = { data: { id: 'self', avatar_url: null }, error: null }
    await expect(saveMyAvatar(null, 'self')).resolves.toBeNull()
    expect(h.patch).toEqual({ avatar_url: null })
    h.result = { data: null, error: { message: 'not permitted', code: '42501' } }
    await expect(saveMyAvatar(photo, 'self')).rejects.toThrow()
  })
})
