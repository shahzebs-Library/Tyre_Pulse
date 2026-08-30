import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import {
  RECOVERY_GENERIC_MESSAGE,
  RECOVERY_SMS_ENABLED,
  normalizeRecoveryDestination,
  recoveryDestinationIsValid,
  requestPasswordRecovery,
  verifyPasswordRecovery,
} from '../lib/accountRecovery'

beforeEach(() => invoke.mockReset())

describe('account recovery client', () => {
  it('normalizes email and international mobile destinations', () => {
    expect(normalizeRecoveryDestination('email', ' User@Example.COM ')).toBe('user@example.com')
    expect(normalizeRecoveryDestination('sms', '00966 50 123 4567')).toBe('+966501234567')
  })

  it('rejects ambiguous/local mobile numbers and malformed emails', () => {
    expect(recoveryDestinationIsValid('sms', '0501234567')).toBe(false)
    expect(recoveryDestinationIsValid('sms', '+966501234567')).toBe(true)
    expect(recoveryDestinationIsValid('email', 'not-an-email')).toBe(false)
    expect(recoveryDestinationIsValid('email', 'user@example.com')).toBe(true)
  })

  it('requests a code through the server-owned recovery function', async () => {
    invoke.mockResolvedValue({ data: { accepted: true, challengeId: 'challenge' }, error: null })
    await expect(requestPasswordRecovery({ channel: 'email', destination: ' User@Example.com ' }))
      .resolves.toEqual({ accepted: true, challengeId: 'challenge' })
    expect(invoke).toHaveBeenCalledWith('account-recovery', {
      body: { action: 'request_recovery', channel: 'email', destination: 'user@example.com' },
    })
    expect(RECOVERY_GENERIC_MESSAGE).toMatch(/If that verified recovery contact/i)
  })

  it('keeps SMS recovery fail-safe until production explicitly enables it', async () => {
    expect(RECOVERY_SMS_ENABLED).toBe(false)
    await expect(requestPasswordRecovery({ channel: 'sms', destination: '+966501234567' }))
      .rejects.toThrow(/not available yet/i)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns only the server-generated one-use recovery link after verification', async () => {
    invoke.mockResolvedValue({ data: { verified: true, actionLink: 'https://auth.example/recover' }, error: null })
    await expect(verifyPasswordRecovery({
      channel: 'sms', destination: '+966501234567', challengeId: 'id', code: '123456',
    })).resolves.toBe('https://auth.example/recover')
  })

  it('fails when the server does not produce a recovery session', async () => {
    invoke.mockResolvedValue({ data: { verified: true }, error: null })
    await expect(verifyPasswordRecovery({
      channel: 'email', destination: 'user@example.com', challengeId: 'id', code: '123456',
    })).rejects.toThrow(/session could not be created/i)
  })
})
