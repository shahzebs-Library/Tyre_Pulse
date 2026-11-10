import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), result: null, calls: [] }))

// Thenable PostgREST builder: every chain method records itself and returns the
// builder; awaiting it resolves to h.result.
function builder() {
  const b = {}
  for (const m of ['select', 'or', 'eq', 'ilike', 'gte', 'lte', 'order', 'range']) {
    b[m] = (...a) => { h.calls.push([m, ...a]); return b }
  }
  b.then = (res, rej) => Promise.resolve(h.result).then(res, rej)
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: { from: (t) => { h.calls.push(['from', t]); return builder() }, rpc: (...a) => h.rpc(...a) },
}))

import {
  runCostAudit, listCostFindings, listAllCostFindings, decideFindings, applyFindings, undoBatch, auditNotInstalled,
} from '../lib/api/tyreCostAudit'

const missingFn = { code: 'PGRST202', message: 'Could not find the function public.tyre_cost_audit_scan' }

beforeEach(() => { h.rpc.mockReset(); h.result = { data: [], error: null, count: 0 }; h.calls = [] })

describe('tyreCostAudit service', () => {
  it('runs a dry run with null country for All and returns the summary', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, checked: 5 }, error: null })
    const r = await runCostAudit({ country: 'All', from: '2025-01-01', to: '2025-06-30' })
    expect(h.rpc).toHaveBeenCalledWith('tyre_cost_audit_scan', { p_country: null, p_from: '2025-01-01', p_to: '2025-06-30', p_dry_run: true })
    expect(r).toEqual({ installed: true, data: { ok: true, checked: 5 } })
  })

  it('reports not installed instead of throwing when the RPC is missing', async () => {
    h.rpc.mockResolvedValue({ data: null, error: missingFn })
    expect(await runCostAudit({})).toEqual({ installed: false })
  })

  it('a permission error is NOT read as not installed', async () => {
    const denied = { code: '42501', message: 'permission denied for relation tyre_cost_audit_findings' }
    expect(auditNotInstalled(denied)).toBe(false)
    h.rpc.mockResolvedValue({ data: null, error: denied })
    await expect(runCostAudit({})).rejects.toThrow()
  })

  it('pages findings with a stable id tiebreak and null-safe country', async () => {
    h.result = { data: [{ id: 'a' }], error: null, count: 250 }
    const r = await listCostFindings({ country: 'KSA', status: 'proposed', from: '2025-01-01', to: '2025-12-31', page: 2 })
    expect(r).toEqual({ installed: true, rows: [{ id: 'a' }], total: 250 })
    expect(h.calls).toContainEqual(['from', 'tyre_cost_audit_findings'])
    expect(h.calls).toContainEqual(['or', 'country.eq.KSA,country.is.null'])
    expect(h.calls).toContainEqual(['eq', 'status', 'proposed'])
    expect(h.calls).toContainEqual(['gte', 'month', '2025-01'])
    expect(h.calls).toContainEqual(['lte', 'month', '2025-12'])
    expect(h.calls).toContainEqual(['order', 'id'])
    expect(h.calls).toContainEqual(['range', 200, 299])
  })

  it('uses an inner join only when filtering by brand or size', async () => {
    await listCostFindings({ brand: 'Triangle' })
    const sel = h.calls.find((c) => c[0] === 'select')[1]
    expect(sel).toContain('tyre_records!inner(brand,size)')
    expect(h.calls).toContainEqual(['ilike', 'tyre.brand', '%Triangle%'])
    h.calls = []
    await listCostFindings({})
    expect(h.calls.find((c) => c[0] === 'select')[1]).not.toContain('!inner')
  })

  it('degrades a missing findings table to not installed', async () => {
    h.result = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    expect(await listCostFindings({})).toEqual({ installed: false, rows: [], total: 0 })
    expect((await listAllCostFindings({})).installed).toBe(false)
  })

  it('a rejection needs a reason and never reaches the RPC without one', async () => {
    await expect(decideFindings(['a'], 'rejected', '  ')).rejects.toThrow(/reason/)
    expect(h.rpc).not.toHaveBeenCalled()
    h.rpc.mockResolvedValue({ data: { ok: true, decided: 1, skipped: 0 }, error: null })
    await decideFindings(['a'], 'rejected', ' wrong item ')
    expect(h.rpc).toHaveBeenCalledWith('tyre_cost_audit_decide', { p_ids: ['a'], p_decision: 'rejected', p_note: 'wrong item' })
  })

  it('apply returns the undo batch; undo calls tyre_cost_correction_undo', async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, applied: 2, batch: 'b-1' }, error: null })
    expect((await applyFindings(['x', 'y'])).batch).toBe('b-1')
    expect(h.rpc).toHaveBeenLastCalledWith('tyre_cost_audit_apply', { p_ids: ['x', 'y'] })
    h.rpc.mockResolvedValueOnce({ data: { restored: 2 }, error: null })
    await undoBatch('b-1')
    expect(h.rpc).toHaveBeenLastCalledWith('tyre_cost_correction_undo', { p_batch: 'b-1' })
    await expect(applyFindings([])).rejects.toThrow()
  })

  it('never surfaces raw database text', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Kilometres changed during a price correction; nothing was applied' } })
    await expect(applyFindings(['x'])).rejects.toBeTruthy()
    h.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "tyre_cost_audit_findings_open_uq"' } })
    await expect(decideFindings(['a'], 'approved')).rejects.toSatisfy((e) => !/tyre_cost_audit_findings_open_uq/.test(e.message))
  })
})
