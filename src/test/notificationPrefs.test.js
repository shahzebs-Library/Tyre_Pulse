import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PREFS,
  CHANNEL_KEYS,
  PRIORITY_ORDER,
  DIGEST_FREQUENCIES,
  toMinutes,
  isInQuietHours,
  channelsEnabled,
  meetsPriority,
  summarisePrefs,
} from '../lib/notificationPrefs'

describe('notificationPrefs — DEFAULT_PREFS', () => {
  it('matches the V204 column defaults', () => {
    expect(DEFAULT_PREFS.channel_in_app).toBe(true)
    expect(DEFAULT_PREFS.channel_email).toBe(true)
    expect(DEFAULT_PREFS.channel_push).toBe(false)
    expect(DEFAULT_PREFS.channel_whatsapp).toBe(false)
    expect(DEFAULT_PREFS.channel_sms).toBe(false)
    expect(DEFAULT_PREFS.channel_slack).toBe(false)
    expect(DEFAULT_PREFS.channel_teams).toBe(false)
    expect(DEFAULT_PREFS.digest_frequency).toBe('none')
    expect(DEFAULT_PREFS.min_priority).toBe('low')
    expect(DEFAULT_PREFS.quiet_start).toBeNull()
    expect(DEFAULT_PREFS.quiet_end).toBeNull()
  })

  it('is frozen (immutable) and enums are consistent', () => {
    expect(Object.isFrozen(DEFAULT_PREFS)).toBe(true)
    expect(PRIORITY_ORDER).toEqual(['low', 'normal', 'high', 'critical'])
    expect(DIGEST_FREQUENCIES).toEqual(['none', 'daily', 'weekly'])
    expect(CHANNEL_KEYS).toContain('in_app')
    expect(CHANNEL_KEYS).toContain('teams')
  })
})

describe('notificationPrefs — toMinutes', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('07:30')).toBe(450)
    expect(toMinutes('22:00:00')).toBe(1320)
    expect(toMinutes('23:59')).toBe(1439)
  })

  it('returns null for invalid / empty input', () => {
    expect(toMinutes(null)).toBeNull()
    expect(toMinutes('')).toBeNull()
    expect(toMinutes('nope')).toBeNull()
    expect(toMinutes('25:00')).toBeNull()
    expect(toMinutes('10:99')).toBeNull()
  })
})

describe('notificationPrefs — isInQuietHours (same-day window)', () => {
  const prefs = { quiet_start: '09:00', quiet_end: '17:00' }

  it('is quiet inside the window', () => {
    expect(isInQuietHours(prefs, '12:00')).toBe(true)
  })

  it('is quiet at the inclusive start boundary', () => {
    expect(isInQuietHours(prefs, '09:00')).toBe(true)
  })

  it('is NOT quiet at the exclusive end boundary', () => {
    expect(isInQuietHours(prefs, '17:00')).toBe(false)
  })

  it('is NOT quiet outside the window', () => {
    expect(isInQuietHours(prefs, '08:59')).toBe(false)
    expect(isInQuietHours(prefs, '18:00')).toBe(false)
  })
})

describe('notificationPrefs — isInQuietHours (wrap-around window)', () => {
  const prefs = { quiet_start: '22:00', quiet_end: '07:00' }

  it('is quiet late at night (after start)', () => {
    expect(isInQuietHours(prefs, '23:30')).toBe(true)
    expect(isInQuietHours(prefs, '22:00')).toBe(true)
  })

  it('is quiet early in the morning (before end)', () => {
    expect(isInQuietHours(prefs, '00:15')).toBe(true)
    expect(isInQuietHours(prefs, '06:59')).toBe(true)
  })

  it('is NOT quiet at the exclusive end and during the day', () => {
    expect(isInQuietHours(prefs, '07:00')).toBe(false)
    expect(isInQuietHours(prefs, '12:00')).toBe(false)
  })
})

describe('notificationPrefs — isInQuietHours (null / empty window)', () => {
  it('returns false when either bound is missing', () => {
    expect(isInQuietHours({ quiet_start: null, quiet_end: '07:00' }, '03:00')).toBe(false)
    expect(isInQuietHours({ quiet_start: '22:00', quiet_end: null }, '23:00')).toBe(false)
    expect(isInQuietHours({}, '12:00')).toBe(false)
    expect(isInQuietHours(null, '12:00')).toBe(false)
  })

  it('returns false for an empty window (start === end)', () => {
    expect(isInQuietHours({ quiet_start: '08:00', quiet_end: '08:00' }, '08:00')).toBe(false)
  })

  it('returns false when the now-time is invalid', () => {
    expect(isInQuietHours({ quiet_start: '22:00', quiet_end: '07:00' }, 'bad')).toBe(false)
  })
})

describe('notificationPrefs — channelsEnabled', () => {
  it('returns enabled channels in display order', () => {
    expect(channelsEnabled(DEFAULT_PREFS)).toEqual(['in_app', 'email'])
  })

  it('reflects a fully-enabled set', () => {
    const all = {}
    CHANNEL_KEYS.forEach((k) => { all[`channel_${k}`] = true })
    expect(channelsEnabled(all)).toEqual(CHANNEL_KEYS)
  })

  it('returns an empty array when nothing is enabled or prefs is null', () => {
    expect(channelsEnabled({})).toEqual([])
    expect(channelsEnabled(null)).toEqual([])
  })
})

describe('notificationPrefs — meetsPriority', () => {
  it('passes everything when the floor is low', () => {
    const p = { min_priority: 'low' }
    expect(meetsPriority(p, 'low')).toBe(true)
    expect(meetsPriority(p, 'critical')).toBe(true)
  })

  it('respects a high floor', () => {
    const p = { min_priority: 'high' }
    expect(meetsPriority(p, 'low')).toBe(false)
    expect(meetsPriority(p, 'normal')).toBe(false)
    expect(meetsPriority(p, 'high')).toBe(true)
    expect(meetsPriority(p, 'critical')).toBe(true)
  })

  it('respects a critical floor (only critical passes)', () => {
    const p = { min_priority: 'critical' }
    expect(meetsPriority(p, 'high')).toBe(false)
    expect(meetsPriority(p, 'critical')).toBe(true)
  })

  it('defaults unknown/missing values to the lowest rank', () => {
    expect(meetsPriority({ min_priority: 'bogus' }, 'low')).toBe(true)
    expect(meetsPriority({}, 'low')).toBe(true)
    expect(meetsPriority({ min_priority: 'high' }, 'unknown')).toBe(false)
  })
})

describe('notificationPrefs — summarisePrefs', () => {
  it('summarises the defaults', () => {
    const s = summarisePrefs(DEFAULT_PREFS)
    expect(s.channels).toEqual(['in_app', 'email'])
    expect(s.channelCount).toBe(2)
    expect(s.digest).toBe('none')
    expect(s.minPriority).toBe('low')
    expect(s.quietHours).toBeNull()
    expect(s.timezone).toBeNull()
  })

  it('renders a quiet-hours range and passes through fields', () => {
    const s = summarisePrefs({
      ...DEFAULT_PREFS,
      channel_sms: true,
      quiet_start: '22:00',
      quiet_end: '07:00',
      timezone: 'Asia/Riyadh',
      digest_frequency: 'daily',
      min_priority: 'high',
    })
    expect(s.channels).toContain('sms')
    expect(s.quietHours).toBe('22:00–07:00')
    expect(s.timezone).toBe('Asia/Riyadh')
    expect(s.digest).toBe('daily')
    expect(s.minPriority).toBe('high')
  })

  it('falls back to safe defaults for out-of-range enum values', () => {
    const s = summarisePrefs({ digest_frequency: 'hourly', min_priority: 'urgent' })
    expect(s.digest).toBe('none')
    expect(s.minPriority).toBe('low')
  })
})
