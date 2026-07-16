import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted Supabase mock (mirrors dataReconciliation.test.js): a chainable
// from().select().eq().maybeSingle() reader and a from().upsert() writer that
// record the last call and resolve to configurable { data, error } payloads.
const h = vi.hoisted(() => {
  const state = {
    single: { data: null, error: null }, // resolved by maybeSingle()
    upsert: { error: null },             // resolved by upsert()
    lastSelect: null,                    // { table, cols, eq }
    lastUpsert: null,                    // { table, rows, opts }
  }
  const supabase = {
    from(table) {
      const ctx = { table, eq: null }
      const builder = {
        select(cols) {
          ctx.cols = cols
          return builder
        },
        eq(col, val) {
          ctx.eq = { col, val }
          return builder
        },
        maybeSingle() {
          state.lastSelect = { table: ctx.table, cols: ctx.cols, eq: ctx.eq }
          return Promise.resolve(state.single)
        },
        upsert(rows, opts) {
          state.lastUpsert = { table: ctx.table, rows, opts }
          return Promise.resolve(state.upsert)
        },
      }
      return builder
    },
  }
  return { state, supabase }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const brand = await import('./brandLogo')

beforeEach(() => {
  h.state.single = { data: null, error: null }
  h.state.upsert = { error: null }
  h.state.lastSelect = null
  h.state.lastUpsert = null
})

describe('service layer - company logo', () => {
  it('getCompanyLogo returns "" on error', async () => {
    h.state.single = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await brand.getCompanyLogo()).toBe('')
    expect(h.state.lastSelect.table).toBe('system_config')
    expect(h.state.lastSelect.eq).toEqual({ col: 'key', val: 'company_logo' })
  })

  it('getCompanyLogo returns the stored value on success (value_text preferred, value fallback)', async () => {
    h.state.single = { data: { value_text: 'https://cdn.example.com/logo.png', value: null }, error: null }
    expect(await brand.getCompanyLogo()).toBe('https://cdn.example.com/logo.png')

    h.state.single = { data: { value_text: null, value: 'https://cdn.example.com/alt.png' }, error: null }
    expect(await brand.getCompanyLogo()).toBe('https://cdn.example.com/alt.png')
  })

  it('setCompanyLogo upserts key "company_logo" with the url', async () => {
    const res = await brand.setCompanyLogo('https://cdn.example.com/logo.png')
    expect(res).toEqual({ ok: true })
    expect(h.state.lastUpsert.table).toBe('system_config')
    expect(h.state.lastUpsert.rows[0].key).toBe('company_logo')
    expect(h.state.lastUpsert.rows[0].value_text).toBe('https://cdn.example.com/logo.png')
    expect(h.state.lastUpsert.rows[0].value).toBe('https://cdn.example.com/logo.png')
    expect(h.state.lastUpsert.opts).toEqual({ onConflict: 'key', ignoreDuplicates: false })
  })

  it('setCompanyLogo accepts a data:image URI and can clear with an empty string', async () => {
    await expect(brand.setCompanyLogo('data:image/png;base64,AAAA')).resolves.toEqual({ ok: true })
    expect(h.state.lastUpsert.rows[0].value_text).toBe('data:image/png;base64,AAAA')

    h.state.lastUpsert = null
    await expect(brand.setCompanyLogo('')).resolves.toEqual({ ok: true })
    expect(h.state.lastUpsert.rows[0].value_text).toBe('')
  })

  it('setCompanyLogo rejects a non-http/non-data URL', async () => {
    await expect(brand.setCompanyLogo('javascript:alert(1)')).rejects.toThrow()
    await expect(brand.setCompanyLogo('data:text/html,<script>')).rejects.toThrow()
    await expect(brand.setCompanyLogo('/relative/logo.png')).rejects.toThrow()
    // a rejected URL must never reach the database
    expect(h.state.lastUpsert).toBeNull()
  })
})
