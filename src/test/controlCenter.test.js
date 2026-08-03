import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted supabase.rpc mock. controlCenter.js imports { supabase } from './_client',
// which re-exports the singleton from '../supabase'. An Error value rejects
// (simulates a thrown call); anything else resolves as-is.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    const v = state.rpc
    if (v instanceof Error) return Promise.reject(v)
    return Promise.resolve(v)
  }
  return { state, supabase: { rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

import {
  rankIssues, openIssueCount, ISSUE_SEVERITY_TONE, DOMAIN_LABELS, LINEAGE_DOMAINS,
  getFigureLineage, getControlCenterSummary, getDiagnosticsFeed,
} from '../lib/api/controlCenter'

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('controlCenter pure helpers', () => {
  const issues = [
    { key: 'a', severity: 'info', count: 100 },
    { key: 'b', severity: 'critical', count: 2 },
    { key: 'c', severity: 'warning', count: 50 },
    { key: 'd', severity: 'critical', count: 9 },
    { key: 'e', severity: 'info', count: 0 },
  ]

  it('rankIssues orders critical > warning > info, then by count desc', () => {
    const r = rankIssues(issues).map((i) => i.key)
    expect(r).toEqual(['d', 'b', 'c', 'a', 'e'])
  })

  it('rankIssues is pure (does not mutate input)', () => {
    const copy = JSON.parse(JSON.stringify(issues))
    rankIssues(issues)
    expect(issues).toEqual(copy)
  })

  it('openIssueCount counts only non-zero issues', () => {
    expect(openIssueCount(issues)).toBe(4)
    expect(openIssueCount([])).toBe(0)
    expect(openIssueCount(undefined)).toBe(0)
  })

  it('every lineage domain has a label', () => {
    for (const d of LINEAGE_DOMAINS) expect(DOMAIN_LABELS[d]).toBeTruthy()
  })

  it('severity tones map to console kit vocabulary', () => {
    expect(ISSUE_SEVERITY_TONE.critical).toBe('danger')
    expect(ISSUE_SEVERITY_TONE.warning).toBe('warning')
    expect(ISSUE_SEVERITY_TONE.info).toBe('info')
  })
})

describe('controlCenter service - getFigureLineage', () => {
  it('returns the RPC payload on success and passes normalized args', async () => {
    h.state.rpc = { data: { ok: true, sources: [] }, error: null }
    const out = await getFigureLineage({ domain: 'cost_per_km', country: 'KSA', from: '2026-01-01', to: '2026-12-31' })
    expect(out).toEqual({ ok: true, sources: [] })
    expect(h.state.lastRpc.name).toBe('get_figure_lineage')
    expect(h.state.lastRpc.args).toEqual({
      p_domain: 'cost_per_km', p_country: 'KSA', p_from: '2026-01-01', p_to: '2026-12-31',
    })
  })

  it("falls back to a safe domain and treats 'All' country as null", async () => {
    h.state.rpc = { data: { ok: true }, error: null }
    await getFigureLineage({ domain: 'not_a_domain', country: 'All' })
    expect(h.state.lastRpc.args.p_domain).toBe('tyre_cost')
    expect(h.state.lastRpc.args.p_country).toBeNull()
    expect(h.state.lastRpc.args.p_from).toBeNull()
    expect(h.state.lastRpc.args.p_to).toBeNull()
  })

  it('degrades to { ok:false } when the RPC returns an error', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await getFigureLineage({ domain: 'tyre_cost' })).toEqual({ ok: false, reason: 'error' })
  })

  it('degrades to { ok:false } when the RPC throws (function absent)', async () => {
    h.state.rpc = new Error('function get_figure_lineage does not exist')
    expect(await getFigureLineage()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('returns { ok:false, reason:empty } when the RPC resolves null data', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await getFigureLineage()).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('controlCenter service - getControlCenterSummary', () => {
  it('returns the RPC payload on success and passes the country', async () => {
    h.state.rpc = { data: { ok: true, issues: [] }, error: null }
    const out = await getControlCenterSummary({ country: 'UAE' })
    expect(out).toEqual({ ok: true, issues: [] })
    expect(h.state.lastRpc.name).toBe('get_control_center_summary')
    expect(h.state.lastRpc.args).toEqual({ p_country: 'UAE' })
  })

  it("treats 'All' country as null", async () => {
    h.state.rpc = { data: { ok: true }, error: null }
    await getControlCenterSummary({ country: 'All' })
    expect(h.state.lastRpc.args.p_country).toBeNull()
  })

  it('degrades to { ok:false } when the RPC returns an error', async () => {
    h.state.rpc = { data: null, error: { message: 'denied', code: '42501' } }
    expect(await getControlCenterSummary({})).toEqual({ ok: false, reason: 'error' })
  })

  it('degrades to { ok:false } when the RPC throws (function absent)', async () => {
    h.state.rpc = new Error('function get_control_center_summary does not exist')
    expect(await getControlCenterSummary()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('returns { ok:false, reason:empty } when the RPC resolves null data', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await getControlCenterSummary()).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('controlCenter service - getDiagnosticsFeed', () => {
  it('returns the composed feed and passes the country ("All" -> null)', async () => {
    h.state.rpc = { data: { ok: true, summary: { ok: true }, lineage: { ok: true } }, error: null }
    const out = await getDiagnosticsFeed({ country: 'All' })
    expect(out.ok).toBe(true)
    expect(h.state.lastRpc.name).toBe('get_diagnostics_feed')
    expect(h.state.lastRpc.args.p_country).toBeNull()
  })

  it('degrades to { ok:false } on error / throw / null data', async () => {
    h.state.rpc = { data: null, error: { message: 'x' } }
    expect(await getDiagnosticsFeed({ country: 'KSA' })).toEqual({ ok: false, reason: 'error' })
    h.state.rpc = new Error('function get_diagnostics_feed does not exist')
    expect(await getDiagnosticsFeed()).toEqual({ ok: false, reason: 'unavailable' })
    h.state.rpc = { data: null, error: null }
    expect(await getDiagnosticsFeed()).toEqual({ ok: false, reason: 'empty' })
  })
})
