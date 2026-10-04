import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), verifyOtp: vi.fn() }))
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: h.rpc, functions: { invoke: h.invoke }, auth: { verifyOtp: h.verifyOtp } },
}))

import {
  shapeShowcase, signInOptions, qrPayload, QR_PREFIX,
  getLoginShowcase, startQrLogin, pollQrLogin, redeemQrLogin,
} from '../lib/api/loginShowcase'

beforeEach(() => { h.rpc.mockReset(); h.invoke.mockReset(); h.verifyOtp.mockReset() })

describe('shapeShowcase', () => {
  it('keeps real counts and leaves unreadable ones null, never 0', () => {
    expect(shapeShowcase({ vehicles: 1618, active_vehicles: '1203', in_workshop: null, sites: 67, users: 727, countries: ['KSA', null, 'UAE'] }))
      .toEqual({ vehicles: 1618, activeVehicles: 1203, inWorkshop: null, sites: 67, users: 727, countries: ['KSA', 'UAE'] })
    expect(shapeShowcase(null)).toBeNull()
  })
})

describe('signInOptions', () => {
  it('shows a provider only when switched on', () => {
    expect(signInOptions({})).toEqual({ google: false, microsoft: false, qr: false })
    expect(signInOptions({ auth_google_enabled: 'true', auth_microsoft_enabled: 'false', qr_login_enabled: true }))
      .toEqual({ google: true, microsoft: false, qr: true })
  })
})

describe('qr flow', () => {
  it('encodes the payload the phone parses', () => {
    expect(qrPayload('abc', 'f00')).toBe(`${QR_PREFIX}?id=abc&s=f00`)
  })
  it('getLoginShowcase returns null on error instead of throwing', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await getLoginShowcase()).toBeNull()
  })
  it('startQrLogin passes the server reason through', async () => {
    h.rpc.mockResolvedValue({ data: { ok: false, reason: 'disabled' }, error: null })
    expect(await startQrLogin()).toEqual({ ok: false, reason: 'disabled' })
    h.rpc.mockResolvedValue({ data: { ok: true, id: 'i', secret: 's', expires_at: 't' }, error: null })
    expect(await startQrLogin()).toEqual({ ok: true, id: 'i', secret: 's', expiresAt: 't' })
  })
  it('pollQrLogin reports error on a failed read', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await pollQrLogin('i', 's')).toBe('error')
    h.rpc.mockResolvedValue({ data: { status: 'approved' }, error: null })
    expect(await pollQrLogin('i', 's')).toBe('approved')
  })
  it('redeemQrLogin exchanges the token for a session, and refuses a failed redeem', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, token_hash: 'th' }, error: null })
    h.verifyOtp.mockResolvedValue({ error: null })
    await redeemQrLogin('i', 's')
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'th', type: 'magiclink' })
    h.invoke.mockResolvedValue({ data: { ok: false, reason: 'not_approved' }, error: null })
    await expect(redeemQrLogin('i', 's')).rejects.toThrow(/could not be used/)
  })
})
