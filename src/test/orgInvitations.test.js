import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc, from } }))

import {
  invitationStatus, canRevoke, buildInviteUrl, isPlausibleInviteToken,
  getInvitationPreview, createInvitation, revokeInvitation, listInvitations,
} from '../lib/api/orgInvitations'
import {
  validateInviteForm, buildInviteSignUp, signInIdFor, inviteSignUpErrorKey, minPasswordLength,
} from '../lib/inviteSignup'

const TOKEN = 'a'.repeat(64)
const NOW = new Date('2026-11-15T12:00:00Z')

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('invitationStatus', () => {
  it('revoked beats accepted beats expired beats waiting', () => {
    expect(invitationStatus({ revoked_at: 'x', accepted_at: 'y', expires_at: '2026-12-01' }, NOW)).toBe('revoked')
    expect(invitationStatus({ accepted_at: 'y', expires_at: '2026-01-01' }, NOW)).toBe('accepted')
    expect(invitationStatus({ expires_at: '2026-11-15T11:59:59Z' }, NOW)).toBe('expired')
    expect(invitationStatus({ expires_at: '2026-11-16T00:00:00Z' }, NOW)).toBe('pending')
  })
  it('a missing or broken expiry is treated as expired, never as waiting', () => {
    expect(invitationStatus({ expires_at: null }, NOW)).toBe('expired')
    expect(invitationStatus({ expires_at: 'nonsense' }, NOW)).toBe('expired')
  })
  it('only a waiting invitation can be cancelled', () => {
    expect(canRevoke({ expires_at: '2026-12-01' }, NOW)).toBe(true)
    expect(canRevoke({ expires_at: '2026-12-01', accepted_at: 'y' }, NOW)).toBe(false)
  })
})

describe('links and token shape', () => {
  it('builds /invite/<token> without a double slash', () => {
    expect(buildInviteUrl('abc', 'https://tyrepulse.app/')).toBe('https://tyrepulse.app/invite/abc')
  })
  it('matches the server length bounds (32..200)', () => {
    expect(isPlausibleInviteToken('a'.repeat(31))).toBe(false)
    expect(isPlausibleInviteToken('a'.repeat(32))).toBe(true)
    expect(isPlausibleInviteToken('a'.repeat(201))).toBe(false)
  })
})

describe('getInvitationPreview', () => {
  it('does not call the server for an impossible token', async () => {
    expect(await getInvitationPreview('short')).toEqual({ ok: false, reason: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('passes a good answer through', async () => {
    rpc.mockResolvedValue({ data: { ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false }, error: null })
    const res = await getInvitationPreview(TOKEN)
    expect(rpc).toHaveBeenCalledWith('get_invitation_preview', { p_token: TOKEN })
    expect(res.organisation_name).toBe('Beta')
  })
  it('keeps a known refusal reason and folds unknown ones to invalid', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'expired' }, error: null })
    expect((await getInvitationPreview(TOKEN)).reason).toBe('expired')
    rpc.mockResolvedValue({ data: { ok: false, reason: 'weird' }, error: null })
    expect((await getInvitationPreview(TOKEN)).reason).toBe('invalid')
  })
  it('a network failure is "error" (retry), never "invalid" (bad link)', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    expect((await getInvitationPreview(TOKEN)).reason).toBe('error')
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect((await getInvitationPreview(TOKEN)).reason).toBe('error')
  })
})

describe('admin calls', () => {
  it('createInvitation sends null for a blank email and returns the token', async () => {
    rpc.mockResolvedValue({ data: { ok: true, invite_token: TOKEN, invitation_id: 'i1' }, error: null })
    const res = await createInvitation({ email: '  ', role: 'Driver', days: 14 })
    expect(rpc).toHaveBeenCalledWith('org_invite_member', { p_email: null, p_role: 'Driver', p_days: 14 })
    expect(res.invite_token).toBe(TOKEN)
  })
  it('createInvitation throws a clean error, not the raw database text', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function org_invite_member' } })
    await expect(createInvitation({})).rejects.toThrow()
    try { await createInvitation({}) } catch (e) { expect(e.message).not.toMatch(/org_invite_member/) }
  })
  it('revokeInvitation is true only when the server changed a row', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await revokeInvitation('i1')).toBe(true)
    rpc.mockResolvedValue({ data: { ok: false }, error: null })
    expect(await revokeInvitation('i1')).toBe(false)
  })
  it('listInvitations never selects the token hash', async () => {
    const chain = { select: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(() => Promise.resolve({ data: [{ id: 'i1' }], error: null })) }
    from.mockReturnValue(chain)
    const rows = await listInvitations()
    expect(from).toHaveBeenCalledWith('org_invitations')
    expect(chain.select.mock.calls[0][0]).not.toMatch(/token/)
    expect(rows).toHaveLength(1)
  })
})

describe('invite sign-up rules', () => {
  const preview = { ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false }
  const form = { fullName: ' Ali K ', username: 'ali.k', employeeId: '', email: '', password: 'longenough1', confirm: 'longenough1' }

  it('validates username, password length and confirmation', () => {
    expect(validateInviteForm({ ...form, username: 'al' })?.key).toBe('errUsername')
    expect(validateInviteForm({ ...form, username: 'ali k' })?.key).toBe('errUsername')
    expect(validateInviteForm({ ...form, password: 'short', confirm: 'short' }, { minLen: 8 })).toEqual({ key: 'errPassword', vars: { min: 8 } })
    expect(validateInviteForm({ ...form, confirm: 'other' })?.key).toBe('errMismatch')
    expect(validateInviteForm(form)).toBeNull()
  })
  it('demands the email only when the invitation names one', () => {
    expect(validateInviteForm(form, { emailRequired: true })?.key).toBe('errEmail')
    expect(validateInviteForm({ ...form, email: 'ali@beta.com' }, { emailRequired: true })).toBeNull()
  })
  it('minimum password never drops below 6, defaults to 8', () => {
    expect(minPasswordLength(null)).toBe(8)
    expect(minPasswordLength({ password_min_length: '4' })).toBe(6)
    expect(minPasswordLength({ password_min_length: '12' })).toBe(12)
  })
  it('signs up with a made-up address carrying the code, and the token in metadata', () => {
    const req = buildInviteSignUp({ token: TOKEN, preview, form })
    expect(req.email).toBe('ali.k+beta@users.tyrepulse.app')
    expect(req.options.data).toEqual({ username: 'ali.k', full_name: 'Ali K', employee_id: null, invite_token: TOKEN, company_code: 'BETA' })
    expect(req.options.captchaToken).toBeUndefined()
  })
  it('uses the real address when the invitation names an email', () => {
    const req = buildInviteSignUp({ token: TOKEN, preview: { ...preview, email_required: true }, form: { ...form, email: ' Ali@Beta.com ' }, captchaToken: 'c' })
    expect(req.email).toBe('ali@beta.com')
    expect(req.options.captchaToken).toBe('c')
  })
  it('sends no company_code when the company has none', () => {
    const req = buildInviteSignUp({ token: TOKEN, preview: { ...preview, company_code: null }, form })
    expect(req.email).toBe('ali.k@users.tyrepulse.app')
    expect('company_code' in req.options.data).toBe(false)
  })
  it('tells the person what to type next time', () => {
    expect(signInIdFor('ali.k', preview)).toBe('BETA/ali.k')
    expect(signInIdFor('ali.k', { ...preview, company_code: '' })).toBe('ali.k')
  })
  it('maps auth errors to plain messages', () => {
    expect(inviteSignUpErrorKey({ code: 'weak_password' })).toBe('errWeak')
    expect(inviteSignUpErrorKey({ status: 429 })).toBe('errRateLimited')
    expect(inviteSignUpErrorKey({ message: 'Database error saving new user' })).toBe('errTaken')
    expect(inviteSignUpErrorKey({ message: 'boom' })).toBe('errFailed')
  })
})
