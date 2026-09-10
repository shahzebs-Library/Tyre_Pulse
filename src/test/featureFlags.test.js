import { setConfigurationScope } from '../lib/configurationStore'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: chainable, thenable query builder that records
// the table queried and the modifiers applied, and resolves to a configurable
// { data, error }. Mirrors src/test/notifications.test.js, plus eq()/
// maybeSingle()/upsert() used by the app_settings persistence pattern.
const h = vi.hoisted(() => {
  const state = { result: { data: null, error: null }, upsertResult: { error: null }, last: null, upserts: [] }
  function from(table) {
    const calls = { eq: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(col, val) { calls.eq.push([col, val]); return b },
      limit(n) { calls.limit = n; return Promise.resolve(state.result) },
      maybeSingle() { calls.maybeSingle = true; return Promise.resolve(state.result) },
      upsert(row, opts) {
        state.upserts.push({ table, row, opts })
        return Promise.resolve(state.upsertResult)
      },
    }
    state.last = b
    return b
  }
  function rpc(name,args) {
    state.last = {name,args}
    if (name.startsWith('save_')) {
      state.upserts.push({namespace:args.p_namespace,row:args.p_values[0]})
      return Promise.resolve({data:{saved:args.p_values.length},error:state.upsertResult?.error??null})
    }
    const data=state.result.data
    return Promise.resolve({...state.result,data:data==null?[]:Array.isArray(data)?data:[data]})
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  FLAG_DEFS,
  DEFAULT_FLAGS,
  FEATURE_FLAGS_SETTINGS_KEY,
  isEnabled,
  mergeFlags,
  flagsByCategory,
  fetchFlags,
  saveFlags,
  subscribe,
  clearFlagsCache,
} = await import('../lib/featureFlags')

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.upsertResult = { error: null }
  h.state.last = null
  h.state.upserts = []
  clearFlagsCache()
})

// ─────────────────────────────────────────────────────────────────────────────
// Registry sanity — defaults must be all ON (no behaviour change on rollout)
// ─────────────────────────────────────────────────────────────────────────────
describe('FLAG_DEFS registry', () => {
  it('defines every roadmap flag, default ON except the automation platform', () => {
    const keys = FLAG_DEFS.map((d) => d.key)
    for (const k of [
      'ai_tools', 'accidents_module', 'data_intake', 'erp_sync', 'tv_display',
      'command_palette', 'notifications_center', 'report_scheduling', 'vehicle_360',
      'automation_platform',
    ]) {
      expect(keys).toContain(k)
    }
    // Every capability flag defaults ON. automation_platform's backing DB layer
    // (V96–V103 + edge functions) is applied live, so it too defaults ON to
    // match the deployed feature_flags row.
    for (const d of FLAG_DEFS) {
      expect(d.default).toBe(true)
    }
  })

  it('has unique keys and complete metadata', () => {
    const keys = FLAG_DEFS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const d of FLAG_DEFS) {
      expect(d.label).toBeTruthy()
      expect(d.description).toBeTruthy()
      expect(d.category).toBeTruthy()
    }
  })

  it('flagsByCategory covers every flag exactly once, in registry order', () => {
    const grouped = flagsByCategory().flatMap((g) => g.flags.map((f) => f.key))
    expect(grouped).toEqual(FLAG_DEFS.map((d) => d.key))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isEnabled — missing key falls back to the FLAG_DEFS default
// ─────────────────────────────────────────────────────────────────────────────
describe('isEnabled', () => {
  it('honours explicit booleans', () => {
    expect(isEnabled({ ai_tools: false }, 'ai_tools')).toBe(false)
    expect(isEnabled({ ai_tools: true }, 'ai_tools')).toBe(true)
  })

  it('falls back to the registry default when the key is missing', () => {
    expect(isEnabled({}, 'accidents_module')).toBe(true)
    expect(isEnabled(null, 'command_palette')).toBe(true)
    expect(isEnabled(undefined, 'tv_display')).toBe(true)
  })

  it('ignores non-boolean garbage values', () => {
    expect(isEnabled({ erp_sync: 'no' }, 'erp_sync')).toBe(true)
    expect(isEnabled({ erp_sync: 0 }, 'erp_sync')).toBe(true)
  })

  it('fails open for unknown flag keys', () => {
    expect(isEnabled({}, 'flag_that_never_existed')).toBe(true)
    expect(isEnabled({ flag_that_never_existed: false }, 'flag_that_never_existed')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// mergeFlags — sanitize stored blobs onto the defaults
// ─────────────────────────────────────────────────────────────────────────────
describe('mergeFlags', () => {
  it('overlays stored booleans onto the defaults', () => {
    const merged = mergeFlags({ ai_tools: false, data_intake: false })
    expect(merged.ai_tools).toBe(false)
    expect(merged.data_intake).toBe(false)
    expect(merged.command_palette).toBe(true)
  })

  it('parses JSON strings (app_settings stores stringified values)', () => {
    const merged = mergeFlags(JSON.stringify({ tv_display: false, updated_at: '2026-01-01' }))
    expect(merged.tv_display).toBe(false)
    expect(merged).not.toHaveProperty('updated_at')
  })

  it('drops unknown keys and non-boolean values', () => {
    const merged = mergeFlags({ bogus: false, ai_tools: 'nope' })
    expect(merged).not.toHaveProperty('bogus')
    expect(merged.ai_tools).toBe(true)
  })

  it('returns pure defaults for malformed input', () => {
    expect(mergeFlags('not json {')).toEqual({ ...DEFAULT_FLAGS })
    expect(mergeFlags(null)).toEqual({ ...DEFAULT_FLAGS })
    expect(mergeFlags([true, false])).toEqual({ ...DEFAULT_FLAGS })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchFlags / saveFlags — app_settings persistence + cache + subscribers
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchFlags', () => {
  it('reads app_settings by the feature_flags key and merges the value', async () => {
    h.state.result = { data: [{ value: JSON.stringify({ erp_sync: false }) }], error: null }
    const flags = await fetchFlags()
    expect(h.state.last).toEqual({name:'get_organisation_configuration',args:{p_namespace:'app_settings',p_key:FEATURE_FLAGS_SETTINGS_KEY}})
    expect(flags.erp_sync).toBe(false)
    expect(flags.ai_tools).toBe(true)
  })

  it('returns defaults when no row exists or the read fails', async () => {
    h.state.result = { data: null, error: null }
    expect(await fetchFlags()).toEqual({ ...DEFAULT_FLAGS })
    clearFlagsCache()
    h.state.result = { data: null, error: { message: 'boom' } }
    expect(await fetchFlags()).toEqual({ ...DEFAULT_FLAGS })
  })

  it('serves from cache within the TTL and refetches on force', async () => {
    h.state.result = { data: [{ value: { ai_tools: false } }], error: null }
    await fetchFlags()
    h.state.last = null
    const cached = await fetchFlags()
    expect(cached.ai_tools).toBe(false)
    expect(h.state.last).toBeNull() // no second query
    h.state.result = { data: [{ value: { ai_tools: true } }], error: null }
    const fresh = await fetchFlags({ force: true })
    expect(fresh.ai_tools).toBe(true)
  })
})

describe('saveFlags', () => {
  it('upserts sanitized flags under the feature_flags key and notifies subscribers', async () => {
    const seen = []
    const unsubscribe = subscribe((f) => seen.push(f))
    const saved = await saveFlags({ accidents_module: false, bogus: false })
    unsubscribe()

    expect(h.state.upserts).toHaveLength(1)
    const { namespace, row } = h.state.upserts[0]
    expect(namespace).toBe('app_settings')
    expect(row.key).toBe(FEATURE_FLAGS_SETTINGS_KEY)

    const stored = JSON.parse(row.value)
    expect(stored.accidents_module).toBe(false)
    expect(stored).not.toHaveProperty('bogus')
    expect(stored.updated_at).toBeTruthy()

    expect(saved.accidents_module).toBe(false)
    expect(seen).toHaveLength(1)
    expect(seen[0].accidents_module).toBe(false)

    // save also primes the cache
    h.state.last = null
    const after = await fetchFlags()
    expect(after.accidents_module).toBe(false)
    expect(h.state.last).toBeNull()
  })

  it('throws (and does not notify) when the upsert fails', async () => {
    h.state.upsertResult = { error: { message: 'permission denied' } }
    const seen = []
    const unsubscribe = subscribe((f) => seen.push(f))
    // Raw DB text is intentionally suppressed; a generic message is thrown instead.
    await expect(saveFlags({ ai_tools: false })).rejects.toThrow(/could not save feature flags/i)
    unsubscribe()
    expect(seen).toHaveLength(0)
  })
})


describe('tenant cache isolation', () => {
  it('discards cached flags when organisation changes', async () => {
    setConfigurationScope('user-a|org-a')
    h.state.result = { data: { value: JSON.stringify({ automation_platform: !DEFAULT_FLAGS.automation_platform }) }, error: null }
    expect((await fetchFlags()).automation_platform).toBe(!DEFAULT_FLAGS.automation_platform)
    setConfigurationScope('user-a|org-b')
    h.state.result = { data: null, error: { message: 'denied' } }
    expect((await fetchFlags()).automation_platform).toBe(DEFAULT_FLAGS.automation_platform)
  })
  it('cannot repopulate the cache with an old tenant response', async () => {
    setConfigurationScope('pending|org-a')
    let resolve
    const spy = vi.spyOn(h.supabase, 'rpc').mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = fetchFlags({ force: true })
    setConfigurationScope('pending|org-b')
    h.state.result = { data: null, error: null }
    await fetchFlags()
    resolve({ data: [{ value: JSON.stringify({ automation_platform: !DEFAULT_FLAGS.automation_platform }) }], error: null })
    expect((await pending).automation_platform).toBe(DEFAULT_FLAGS.automation_platform)
    expect((await fetchFlags()).automation_platform).toBe(DEFAULT_FLAGS.automation_platform)
    spy.mockRestore()
  })
})
