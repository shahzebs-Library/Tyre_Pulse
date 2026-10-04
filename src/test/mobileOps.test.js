/**
 * The forced-update gate can lock every field phone out with one keystroke.
 * These pin the refusal logic, and pin that the console's version compare
 * matches the mobile app's numeric-segment rules (mobile/lib/appVersion.ts) -
 * two implementations disagreeing about "1.10.0 vs 1.9.0" is how a gate that
 * looks safe on the console strands phones in the field.
 */
import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersions, gateRisk, gateSummary } from '../lib/mobileOps'

describe('version parsing + compare (must match the mobile rules)', () => {
  it('compares segments as numbers, not text', () => {
    // A text compare puts 1.10.0 below 1.9.0 - the exact bug the mobile
    // implementation exists to avoid.
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.3.2', '1.3.1')).toBe(1)
    expect(compareVersions('1.3.2', '1.3.2')).toBe(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)   // missing segment = 0
  })

  it('treats junk as unparseable, never as a version', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('1.3.x')).toBeNull()
    expect(parseVersion('v1.3.2')).toEqual([1, 3, 2])  // leading v tolerated
  })
})

describe('gateRisk - the interlock', () => {
  it('BLOCKS a minimum above the newest release (the lockout mistake)', () => {
    const r = gateRisk('1.4.0', '1.3.2')
    expect(r.level).toBe('blocked')
    expect(r.reason).toMatch(/lock EVERY phone/i)
  })

  it('blocks junk instead of saving something the phones would ignore', () => {
    expect(gateRisk('newest', '1.3.2').level).toBe('blocked')
  })

  it('blocks when no released version is recorded - nothing to prove safety against', () => {
    expect(gateRisk('1.3.2', '').level).toBe('blocked')
  })

  it('clears a minimum at or below the newest release', () => {
    expect(gateRisk('1.3.2', '1.3.2').level).toBe('clear')
    expect(gateRisk('1.3.1', '1.3.2').level).toBe('clear')
  })

  it('blank means the gate is off, which is a valid state, not an error', () => {
    expect(gateRisk('', '1.3.2').level).toBe('off')
    expect(gateRisk(null, '1.3.2').level).toBe('off')
  })
})

describe('gateSummary - plain English for the owner', () => {
  it('says OFF when no minimum is set', () => {
    expect(gateSummary('', '1.3.2')).toMatch(/OFF/)
  })
  it('says everyone must be on the newest when min == latest', () => {
    expect(gateSummary('1.3.2', '1.3.2')).toMatch(/newest release/)
  })
})

describe('Flutter app helpers', () => {
  it('targets the Flutter package and keys, not the retired Expo ones', async () => {
    const { FLUTTER_APP, RETIRED_EXPO_APP } = await import('../lib/mobileOps')
    expect(FLUTTER_APP.packageId).toBe('com.shahzebrahman.tyrepulse')
    expect(FLUTTER_APP.minKey).toBe('flutter_min_version')
    expect(FLUTTER_APP.latestKey).toBe('flutter_latest_version')
    expect(FLUTTER_APP.workflow).toBe('flutter-release-play.yml')
    expect(RETIRED_EXPO_APP.minKey).toBe('mobile_min_version')
  })

  it('versionName drops the pubspec build number and refuses junk', async () => {
    const { versionName } = await import('../lib/mobileOps')
    expect(versionName('0.1.0+5')).toBe('0.1.0')
    expect(versionName('0.2.3')).toBe('0.2.3')
    expect(versionName('beta')).toBe('')
  })

  it('compares 0.x the way the Flutter app does (0.1.10 is above 0.1.9)', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(gateRisk('0.2.0', '0.1.0').level).toBe('blocked')
  })

  it('filterVersionRows searches and filters against the saved gate', async () => {
    const { filterVersionRows } = await import('../lib/mobileOps')
    const rows = [
      { app_version: '0.1.1', platform: 'android', devices: 3 },
      { app_version: '0.1.0', platform: 'android', devices: 2 },
      { app_version: null, platform: 'android', devices: 1 },
    ]
    const opts = { min: '0.1.1', latest: '0.1.1' }
    expect(filterVersionRows(rows, { ...opts, filter: 'latest' }).map((r) => r.app_version)).toEqual(['0.1.1'])
    expect(filterVersionRows(rows, { ...opts, filter: 'behind' }).map((r) => r.app_version)).toEqual(['0.1.0'])
    expect(filterVersionRows(rows, { ...opts, filter: 'blocked' }).map((r) => r.app_version)).toEqual(['0.1.0'])
    expect(filterVersionRows(rows, { ...opts, filter: 'unknown' })).toHaveLength(1)
    expect(filterVersionRows(rows, { ...opts, search: '0.1.0' })).toHaveLength(1)
    // No release recorded: "behind" cannot be judged, so it matches nothing.
    expect(filterVersionRows(rows, { filter: 'behind' })).toHaveLength(0)
  })
})
