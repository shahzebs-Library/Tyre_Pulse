import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted mock of the service _client: a chainable, thenable Supabase builder
// plus a real-behaviour unwrap. getAccidentEmailConfig awaits after .in();
// setAccidentEmailConfig unwraps after .upsert().select(). The builder is
// thenable so awaiting it at any terminal point resolves the configured result.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, lastUpsert: null, lastSelect: null }
  const supabase = {
    from(table) {
      const ctx = { table }
      const builder = {
        select(cols) { ctx.cols = cols; return builder },
        in(col, vals) { state.lastSelect = { table, cols: ctx.cols, col, vals }; return builder },
        eq() { return builder },
        upsert(rows, opts) { ctx.upsert = { rows, opts }; state.lastUpsert = { table, rows, opts }; return builder },
        then(resolve) { return Promise.resolve(state.result).then(resolve) },
      }
      return builder
    },
  }
  const unwrap = (r) => { if (r?.error) throw r.error; return r?.data }
  return { state, supabase, unwrap }
})

vi.mock('./_client', () => ({ supabase: h.supabase, unwrap: h.unwrap }))

const svc = await import('./accidentWorkflow')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.lastUpsert = null
  h.state.lastSelect = null
})

describe('accident email routing config', () => {
  it('getAccidentEmailConfig reads the three keys and always returns the fixed sender', async () => {
    h.state.result = {
      data: [
        { key: 'accident_email_to', value: 'ops@example.com, claims@example.com' },
        { key: 'accident_email_subject_prefix', value: '[Accident]' },
      ],
      error: null,
    }
    const cfg = await svc.getAccidentEmailConfig()
    expect(cfg).toEqual({
      to: 'ops@example.com, claims@example.com',
      cc: '',
      subjectPrefix: '[Accident]',
      sender: 'info@tyrepulse.app',
    })
    expect(h.state.lastSelect.table).toBe('system_config')
    expect(h.state.lastSelect.vals).toEqual([
      'accident_email_to', 'accident_email_cc', 'accident_email_subject_prefix',
    ])
  })

  it('getAccidentEmailConfig degrades to empty strings when nothing is stored', async () => {
    h.state.result = { data: null, error: null }
    const cfg = await svc.getAccidentEmailConfig()
    expect(cfg).toEqual({ to: '', cc: '', subjectPrefix: '', sender: 'info@tyrepulse.app' })
  })

  it('setAccidentEmailConfig upserts the three keys with trimmed raw values', async () => {
    await svc.setAccidentEmailConfig({ to: '  a@x.com , b@x.com ', cc: '', subjectPrefix: ' [P] ' })
    expect(h.state.lastUpsert.table).toBe('system_config')
    expect(h.state.lastUpsert.opts).toEqual({ onConflict: 'key' })
    expect(h.state.lastUpsert.rows).toEqual([
      { key: 'accident_email_to', value: 'a@x.com , b@x.com' },
      { key: 'accident_email_cc', value: '' },
      { key: 'accident_email_subject_prefix', value: '[P]' },
    ])
  })
})
