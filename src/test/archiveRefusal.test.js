import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: {} }))
import { archiveRefusal } from '../lib/api/consolePlatform'

describe('archiveRefusal', () => {
  it('names members, records and missing org in plain English', () => {
    expect(archiveRefusal({ ok: false, reason: 'has_members' })).toMatch(/members/)
    expect(archiveRefusal({ ok: false, reason: 'has_records', table: 'tyre_records' })).toMatch(/tyre records/)
    expect(archiveRefusal({ ok: false, reason: 'not_found' })).toMatch(/no longer exists/)
    expect(archiveRefusal(null)).toMatch(/could not be archived/)
  })
})
