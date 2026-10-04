import { describe, it, expect } from 'vitest'
import { orgStorageMap, storageFor, signinSummary, defaultsDiff, defaultLabel } from '../lib/consoleDataGaps'
import { parseConfigValue } from '../lib/api/systemConfig'

describe('orgStorageMap / storageFor', () => {
  it('returns null for a missing payload, never zeros', () => {
    expect(orgStorageMap(null)).toBeNull()
    expect(storageFor(null, 'a')).toBeNull()
  })
  it('maps orgs and keeps unattributed separate', () => {
    const m = orgStorageMap({ orgs: [{ org_id: 'a', files: 3, bytes: 300, by_bucket: { x: 3 } }], unattributed_files: 2, unattributed_bytes: 50, total_files: 5, total_bytes: 350 })
    expect(storageFor(m, 'a')).toEqual({ files: 3, bytes: 300, byBucket: { x: 3 } })
    expect(storageFor(m, 'b')).toEqual({ files: 0, bytes: 0, byBucket: {} })
    expect(m.unattributed).toEqual({ files: 2, bytes: 50 })
  })
})

describe('signinSummary', () => {
  it('null input stays null', () => { expect(signinSummary(null)).toBeNull() })
  it('states that older failures are not kept', () => {
    const s = signinSummary({ logins_30d: 4, logins_all: 9, first_login_logged: 'D1', failed_burst: null })
    expect(s.logins).toBe('4 in 30 days, 9 since D1')
    expect(s.failed).toMatch(/not stored/)
  })
  it('describes a locked burst', () => {
    const s = signinSummary({ logins_30d: 0, failed_burst: { attempts: 5, started_at: 'D2', locked_now: true } })
    expect(s.failed).toBe('5 in the last burst (started D2), locked now. Older bursts are not kept.')
  })
})

describe('defaultsDiff', () => {
  it('counts only settings with a code default and ignores blanks', () => {
    const d = defaultsDiff([
      { key: 'a', value: 'true' }, { key: 'b', value: '10' }, { key: 'c', value: 'x' }, { key: 'd', value: null },
    ], { a: true, b: 5, d: 1 }, parseConfigValue)
    expect(d).toEqual({ withDefault: 3, changed: 1, changedKeys: ['b'] })
  })
  it('returns null for unread rows', () => { expect(defaultsDiff(null, {}, parseConfigValue)).toBeNull() })
  it('labels booleans plainly', () => { expect(defaultLabel(false)).toBe('Off'); expect(defaultLabel(8)).toBe('8') })
})
