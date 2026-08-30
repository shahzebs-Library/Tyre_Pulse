import { describe, expect, it } from 'vitest'
import {
  classifyErpFailure, erpFreshness, erpIdempotencyKey, erpRetryDelay,
  shouldDeadLetter, validateErpConfig,
} from '../lib/erpReliability'

const valid = {
  system: 'custom', name: 'Production ERP', base_url: 'https://erp.example.com/api/',
  auth_type: 'oauth2', credential_ref: 'ERP_PROD_OAUTH', entities: ['fleet', 'fleet', 'stock'],
  frequency: 'hourly', enabled: true,
}

describe('ERP reliability contract', () => {
  it('normalises a credential-safe config', () => {
    expect(validateErpConfig(valid)).toMatchObject({
      base_url: 'https://erp.example.com/api', credential_ref: 'ERP_PROD_OAUTH',
      entities: ['fleet', 'stock'], enabled: true,
    })
  })

  it.each([
    'http://erp.example.com', 'https://user:pass@erp.example.com', 'https://localhost/api',
    'https://127.0.0.1', 'https://10.0.0.2', 'https://169.254.169.254/latest',
    'https://2130706433', 'https://[fd00::1]',
  ])('rejects unsafe endpoint %s', (base_url) => {
    expect(() => validateErpConfig({ ...valid, base_url })).toThrow()
  })

  it('rejects credential values and unknown vocabularies', () => {
    expect(() => validateErpConfig({ ...valid, credential_ref: 'secret-value!' })).toThrow()
    expect(() => validateErpConfig({ ...valid, system: 'invented' })).toThrow()
    expect(() => validateErpConfig({ ...valid, entities: ['payroll'] })).toThrow()
  })

  it('creates stable, collision-resistant source keys', () => {
    const args = { connectionId: 'c1', entity: 'fleet', sourceId: 'A/1', sourceVersion: '7' }
    expect(erpIdempotencyKey(args)).toBe(erpIdempotencyKey(args))
    expect(erpIdempotencyKey(args)).not.toBe(erpIdempotencyKey({ ...args, sourceVersion: '8' }))
  })

  it('retries only transient failures and dead-letters terminal/exhausted work', () => {
    expect(classifyErpFailure({ status: 429 }).retryable).toBe(true)
    expect(classifyErpFailure({ status: 401 }).retryable).toBe(false)
    expect(shouldDeadLetter({ status: 503 }, 4, { maxAttempts: 5 })).toBe(false)
    expect(shouldDeadLetter({ status: 503 }, 5, { maxAttempts: 5 })).toBe(true)
    expect(shouldDeadLetter({ status: 400 }, 1, { maxAttempts: 5 })).toBe(true)
  })

  it('uses bounded exponential jitter and reports freshness', () => {
    expect(erpRetryDelay(3, { baseDelayMs: 1000, maxDelayMs: 30000 }, () => 0)).toBe(2000)
    expect(erpRetryDelay(99, { baseDelayMs: 1000, maxDelayMs: 30000 }, () => 1)).toBe(30000)
    expect(erpFreshness(null).state).toBe('never')
    expect(erpFreshness('2026-08-30T00:00:00Z', Date.parse('2026-08-31T03:00:00Z')).state).toBe('stale')
  })
})
