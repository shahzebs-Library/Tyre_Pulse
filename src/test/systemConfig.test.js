import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseConfigValue, primeConfigCache, getConfigCache,
  configBool, configNum, configStr, assertFeatureEnabled, clampToMax,
  ENFORCEMENT_STATUS, CONFIG_DEFAULTS, PUBLIC_CONFIG_KEYS,
} from '../lib/api/systemConfig'

beforeEach(() => { primeConfigCache({}) })

describe('systemConfig — parseConfigValue', () => {
  it('parses booleans, numbers, JSON-quoted strings and plain text', () => {
    expect(parseConfigValue('true')).toBe(true)
    expect(parseConfigValue('false')).toBe(false)
    expect(parseConfigValue('24')).toBe(24)
    expect(parseConfigValue('12.5')).toBe(12.5)
    expect(parseConfigValue('"SAR"')).toBe('SAR')
    expect(parseConfigValue('weekly')).toBe('weekly')
    expect(parseConfigValue('')).toBe('')
    expect(parseConfigValue(null)).toBe(null)
    expect(parseConfigValue(undefined)).toBe(null)
    expect(parseConfigValue(true)).toBe(true)
    expect(parseConfigValue(7)).toBe(7)
  })
})

describe('systemConfig — typed getters read the primed cache', () => {
  it('configBool coerces true/false variants and falls back to the default', () => {
    primeConfigCache({ export_enabled: 'false', maintenance_mode: 'true', odd: 'maybe' })
    expect(configBool('export_enabled', true)).toBe(false)
    expect(configBool('maintenance_mode', false)).toBe(true)
    expect(configBool('odd', true)).toBe(true)          // unrecognised -> default
    expect(configBool('missing', true)).toBe(true)       // unset -> default
    expect(configBool('missing', false)).toBe(false)
  })

  it('configNum coerces numbers and falls back', () => {
    primeConfigCache({ max_export_rows: '5000', bad: 'x' })
    expect(configNum('max_export_rows', 0)).toBe(5000)
    expect(configNum('bad', 42)).toBe(42)
    expect(configNum('missing', 10)).toBe(10)
  })

  it('configStr unwraps JSON-quoted values', () => {
    primeConfigCache({ default_currency: '"SAR"', digest_frequency: 'weekly' })
    expect(configStr('default_currency', 'USD')).toBe('SAR')
    expect(configStr('digest_frequency', 'daily')).toBe('weekly')
    expect(configStr('missing', 'x')).toBe('x')
  })

  it('uses CONFIG_DEFAULTS when no explicit default is given', () => {
    primeConfigCache({})
    expect(configBool('export_enabled')).toBe(CONFIG_DEFAULTS.export_enabled)
    expect(configNum('max_export_rows')).toBe(CONFIG_DEFAULTS.max_export_rows)
  })
})

describe('systemConfig — enforcement helpers', () => {
  it('assertFeatureEnabled throws only when export is explicitly off', () => {
    primeConfigCache({ export_enabled: 'true' })
    expect(() => assertFeatureEnabled('export')).not.toThrow()
    primeConfigCache({})
    expect(() => assertFeatureEnabled('export')).not.toThrow()   // fail-safe = enabled
    primeConfigCache({ export_enabled: 'false' })
    expect(() => assertFeatureEnabled('export')).toThrow(/disabled by your administrator/i)
  })

  it('clampToMax caps a count only when a positive max is set', () => {
    primeConfigCache({ max_export_rows: '100' })
    expect(clampToMax('max_export_rows', 250)).toBe(100)
    expect(clampToMax('max_export_rows', 50)).toBe(50)
    primeConfigCache({ max_export_rows: '0' })
    expect(clampToMax('max_export_rows', 999)).toBe(999)         // 0 = no cap
    primeConfigCache({})
    expect(clampToMax('max_export_rows', 999)).toBe(999)
  })

  it('primeConfigCache is the source the getters read', () => {
    primeConfigCache({ a: '1' })
    expect(getConfigCache()).toEqual({ a: '1' })
  })
})

describe('systemConfig — enforcement registry honesty', () => {
  it('every status is either active or saved', () => {
    for (const [key, v] of Object.entries(ENFORCEMENT_STATUS)) {
      expect(['active', 'saved'], `${key}`).toContain(v.status)
      expect(typeof v.where).toBe('string')
    }
  })

  it('claims active ONLY for controls actually enforced this pass', () => {
    const active = Object.entries(ENFORCEMENT_STATUS).filter(([, v]) => v.status === 'active').map(([k]) => k)
    // These are wired end to end and MUST stay active.
    for (const k of ['maintenance_mode', 'registration_open', 'export_enabled', 'max_export_rows',
      'max_upload_rows', 'session_timeout_hours', 'two_factor_required', 'backup_enabled',
      'ai_enabled', 'ai_monthly_budget_usd', 'ai_rate_limit_per_min', 'ai_cache_ttl_hours',
      'password_min_length', 'app_version', 'email_notifications', 'push_notifications',
      'max_login_attempts', 'audit_retention_days']) {
      expect(active, k).toContain(k)
    }
    // These are deliberately NOT claimed active (honest saved-only). data_retention_months
    // stays OFF on purpose: business records are never auto-deleted (data safety).
    for (const k of ['ai_model', 'data_retention_months']) {
      expect(active, k).not.toContain(k)
    }
  })

  it('public config keys never include AI budgets or emails', () => {
    for (const k of ['ai_monthly_budget_usd', 'alert_email', 'ai_enabled', 'max_export_rows']) {
      expect(PUBLIC_CONFIG_KEYS).not.toContain(k)
    }
    expect(PUBLIC_CONFIG_KEYS).toContain('maintenance_mode')
    expect(PUBLIC_CONFIG_KEYS).toContain('registration_open')
  })
})
