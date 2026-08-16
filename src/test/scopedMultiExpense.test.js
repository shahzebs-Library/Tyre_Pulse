/**
 * The client seam for the V544 multi-country expense aggregates.
 *
 * These functions are the only place the page learns what a scope may read, so
 * three properties matter and are pinned here:
 *
 *   1. AN EMPTY SCOPE ASKS FOR NOTHING. Sending no countries to an aggregate
 *      whose country argument is optional is how a page ends up reporting on
 *      every country the reader did not select.
 *   2. A BACKEND WITHOUT V544 DEGRADES, it does not throw. The page should fall
 *      back to its per-country comparison rather than showing an error.
 *   3. `refused` SURVIVES. A country the caller may not see must reach the UI as
 *      a named omission; swallowing it lets a reader believe a three-country
 *      report covered three countries when it covered two.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [], reply: null }))

vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (fn, args) => { h.calls.push({ fn, args }); return Promise.resolve(h.reply) } },
  isMissingRelation: (e) => ['42883', 'PGRST202'].includes(String(e?.code || '')),
}))

const { callScopedMulti, getPartsExpenseSnapshotMulti, getCostCpkOverviewMulti } = await import('../lib/api/partsConsumption')
const { getCostVarianceMulti } = await import('../lib/api/costVariance')
const { getSiteOperatingCostMulti } = await import('../lib/api/siteOperatingCost')
const { getExpensePeriodTrendMulti } = await import('../lib/api/expenseTrends')

const ok = (blocks, refused = []) => ({
  data: { ok: true, multi: true, blended: false, countries: blocks, refused }, error: null,
})

beforeEach(() => { h.calls = []; h.reply = ok([]) })

describe('callScopedMulti', () => {
  it('asks for nothing when the scope is empty', async () => {
    for (const countries of [[], null, undefined]) {
      const res = await callScopedMulti('get_parts_expense_snapshot_multi', countries)
      expect(res).toEqual({ ok: false, blocks: [], refused: [] })
    }
    expect(h.calls).toHaveLength(0)
  })

  it('passes the countries as an array under p_countries', async () => {
    await callScopedMulti('get_parts_expense_snapshot_multi', ['KSA', 'UAE'], { p_from: '2026-01-01' })
    expect(h.calls[0].args).toEqual({ p_countries: ['KSA', 'UAE'], p_from: '2026-01-01' })
  })

  it('returns the per-country blocks and the refusals', async () => {
    h.reply = ok([{ country: 'KSA', currency: 'SAR', result: { ok: true } }], ['UAE'])
    const res = await callScopedMulti('get_parts_expense_snapshot_multi', ['KSA', 'UAE'])
    expect(res.ok).toBe(true)
    expect(res.blocks).toHaveLength(1)
    expect(res.blocks[0].currency).toBe('SAR')
    expect(res.refused).toEqual(['UAE'])
  })

  it('degrades on a backend that predates the migration', async () => {
    h.reply = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    const res = await callScopedMulti('get_parts_expense_snapshot_multi', ['KSA'])
    expect(res).toEqual({ ok: false, blocks: [], refused: [] })
  })

  it('rethrows a real failure rather than reporting an empty scope as healthy', async () => {
    // A permission or network failure must not look like "this scope has no
    // data" - that would render an empty report as a finished one.
    h.reply = { data: null, error: { code: '42501', message: 'permission denied' } }
    await expect(callScopedMulti('get_parts_expense_snapshot_multi', ['KSA'])).rejects.toBeTruthy()
  })

  it('treats an ok:false payload as nothing to report', async () => {
    h.reply = { data: { ok: false, reason: 'unauthorized' }, error: null }
    expect(await callScopedMulti('get_parts_expense_snapshot_multi', ['KSA']))
      .toEqual({ ok: false, blocks: [], refused: [] })
  })
})

describe('the five scoped aggregates', () => {
  it('each call its own _multi function with the scope', async () => {
    await getPartsExpenseSnapshotMulti({ countries: ['KSA'], from: '2026-01-01', to: '2026-06-30' })
    await getCostCpkOverviewMulti({ countries: ['KSA'] })
    await getCostVarianceMulti({ countries: ['KSA'], limit: 10 })
    await getSiteOperatingCostMulti({ countries: ['KSA'] })
    await getExpensePeriodTrendMulti({ countries: ['KSA'], grain: 'month' })
    expect(h.calls.map((c) => c.fn)).toEqual([
      'get_parts_expense_snapshot_multi',
      'get_cost_cpk_overview_multi',
      'get_cost_variance_multi',
      'get_site_operating_cost_multi',
      'get_expense_period_trend_multi',
    ])
    h.calls.forEach((c) => expect(c.args.p_countries).toEqual(['KSA']))
  })

  it('site operating cost unpacks each country block, keeping coverage per country', async () => {
    // Coverage is a data-quality reading, and three countries load their job
    // cards differently - one averaged figure would describe none of them.
    h.reply = ok([
      { country: 'KSA', currency: 'SAR', result: { ok: true, coverage: { pct: 99.4 }, by_site: [{ site: 'NHC' }], by_store: [] } },
      { country: 'UAE', currency: 'AED', result: { ok: true, coverage: { pct: 41.0 }, by_site: [], by_store: [] } },
    ])
    const res = await getSiteOperatingCostMulti({ countries: ['KSA', 'UAE'] })
    expect(res.blocks.map((b) => b.coverage.pct)).toEqual([99.4, 41.0])
    expect(res.blocks[0].bySite).toEqual([{ site: 'NHC' }])
  })

  it('the period trend flattens to country-tagged rows the engine already reads', async () => {
    h.reply = ok([
      { country: 'KSA', currency: 'SAR', result: [{ country: 'KSA', period: '2026', total: 1 }] },
      { country: 'UAE', currency: 'AED', result: [{ country: 'UAE', period: '2026', total: 2 }] },
    ])
    const res = await getExpensePeriodTrendMulti({ countries: ['KSA', 'UAE'] })
    // Every row still carries its own country, so the pure engine splits them
    // itself - the rows are never added into one series here.
    expect(res.rows.map((r) => r.country)).toEqual(['KSA', 'UAE'])
    expect(res.rows.every((r) => r.country && r.total != null)).toBe(true)
  })

  it('the money-bearing ones never expose a scope-level total', async () => {
    h.reply = ok([
      { country: 'KSA', currency: 'SAR', result: { kpis: { total_expense: 1000 } } },
      { country: 'UAE', currency: 'AED', result: { kpis: { total_expense: 2000 } } },
    ])
    const res = await getPartsExpenseSnapshotMulti({ countries: ['KSA', 'UAE'] })
    expect(Object.keys(res).sort()).toEqual(['blocks', 'ok', 'refused'])
    expect(res.blocks.map((b) => b.result.kpis.total_expense)).toEqual([1000, 2000])
  })
})
