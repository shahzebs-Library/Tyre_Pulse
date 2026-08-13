import { describe, it, expect, beforeEach, vi } from 'vitest'

// Cold-start config cache: proves the per-key readers (nav layout, company
// logo) stop issuing their own system_config request once the shared full read
// is cached or in flight, WITHOUT ever reporting a row as absent from a cache
// that was never primed.
//
// Chainable supabase mock that COUNTS reads, so we can prove the per-key
// readers stop issuing their own request once the shared cache is primed.
const h = vi.hoisted(() => {
  const state = { selectCalls: 0, tableRows: [], single: { data: null, error: null }, failValueText: false }
  const supabase = {
    from() {
      const ctx = {}
      const builder = {
        select(cols) {
          ctx.cols = cols
          state.selectCalls++
          if (state.failValueText && String(cols).includes('value_text') && !ctx.eq) {
            return Promise.resolve({ data: null, error: { message: 'column does not exist', code: '42703' } })
          }
          if (!String(cols).includes('key')) return builder
          return Promise.resolve({ data: state.tableRows, error: null })
        },
        eq(col, val) { ctx.eq = { col, val }; return builder },
        maybeSingle() { return Promise.resolve(state.single) },
      }
      return builder
    },
  }
  return { state, supabase }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const cfg = await import('../lib/api/systemConfig')
const nav = await import('../lib/api/navLayout')
const brand = await import('../lib/api/brandLogo')

beforeEach(() => {
  h.state.selectCalls = 0
  h.state.tableRows = []
  h.state.single = { data: null, error: null }
  h.state.failValueText = false
})

describe('cold-start config cache', () => {
  it('configEntry returns null while the cache is cold (unknown, not "no row")', () => {
    expect(cfg.configEntry('company_logo')).toBe(null)
    expect(cfg.isSystemConfigLoaded()).toBe(false)
  })

  it('a cold cache lets getCompanyLogo fall back to its own single-row read', async () => {
    h.state.single = { data: { value_text: 'https://x/logo.png', value: null }, error: null }
    expect(await brand.getCompanyLogo()).toBe('https://x/logo.png')
    expect(h.state.selectCalls).toBe(1)
  })

  it('loadSystemConfig reads value_text and primes both columns', async () => {
    h.state.tableRows = [
      { key: 'company_logo', value: null, value_text: 'https://x/a.png' },
      { key: 'nav_layout', value: '{"groups":[]}', value_text: '{"groups":[]}' },
      { key: 'export_enabled', value: 'false', value_text: null },
    ]
    await cfg.loadSystemConfig({ force: true })
    expect(cfg.isSystemConfigLoaded()).toBe(true)
    expect(cfg.configEntry('company_logo')).toEqual({ value: null, value_text: 'https://x/a.png' })
    expect(cfg.configBool('export_enabled', true)).toBe(false)
  })

  it('a primed cache serves the per-key readers with ZERO extra requests', async () => {
    h.state.tableRows = [
      { key: 'company_logo', value: null, value_text: 'https://x/a.png' },
      { key: 'nav_layout', value: '{"hidden":{}}', value_text: null },
    ]
    await cfg.loadSystemConfig({ force: true })
    h.state.selectCalls = 0
    nav.invalidateNavLayout()
    expect(await brand.getCompanyLogo()).toBe('https://x/a.png')
    expect(await nav.getNavLayout()).toBeTypeOf('object')
    expect(h.state.selectCalls).toBe(0)
  })

  it('a failed value_text select falls back to key,value instead of losing every switch', async () => {
    h.state.failValueText = true
    h.state.tableRows = [{ key: 'export_enabled', value: 'false' }]
    await cfg.loadSystemConfig({ force: true })
    expect(cfg.configBool('export_enabled', true)).toBe(false)
    expect(h.state.selectCalls).toBe(2) // first attempt + fallback
  })

  it('a reader called DURING an in-flight load joins it instead of duplicating', async () => {
    // Fresh module instance so the cache is genuinely cold, as on a real boot.
    vi.resetModules()
    const cfg2 = await import('../lib/api/systemConfig')
    const brand2 = await import('../lib/api/brandLogo')
    h.state.tableRows = [{ key: 'company_logo', value: null, value_text: 'https://x/b.png' }]
    h.state.selectCalls = 0
    // The real cold-start race: the settings context starts the full read, and
    // Layout asks for the logo before it lands.
    const loading = cfg2.loadSystemConfig()
    const logo = await brand2.getCompanyLogo()
    await loading
    expect(logo).toBe('https://x/b.png')
    expect(h.state.selectCalls).toBe(1) // the shared full read only
  })

  it('once a FULL read is cached, an absent key means absent (no extra read)', async () => {
    h.state.tableRows = [{ key: 'export_enabled', value: 'false', value_text: null }]
    await cfg.loadSystemConfig({ force: true })
    h.state.selectCalls = 0
    expect(await brand.getCompanyLogo()).toBe('')
    expect(h.state.selectCalls).toBe(0)
  })

  it('a FAILED load does not mark the cache authoritative, so readers still read', async () => {
    vi.resetModules()
    const cfg3 = await import('../lib/api/systemConfig')
    const brand3 = await import('../lib/api/brandLogo')
    const orig = h.supabase.from
    h.supabase.from = () => { throw new Error('network') }
    await cfg3.loadSystemConfig()
    h.supabase.from = orig
    // Marking the cache authoritative off a failed read would make every key
    // answer "no row" from nothing - the logo would silently vanish.
    expect(cfg3.isSystemConfigLoaded()).toBe(false)
    h.state.single = { data: { value_text: 'https://x/c.png', value: null }, error: null }
    h.state.selectCalls = 0
    expect(await brand3.getCompanyLogo()).toBe('https://x/c.png')
    expect(h.state.selectCalls).toBe(1)
  })
})
