import { describe, it, expect, vi } from 'vitest'

const calls = []
function chain(result) {
  const q = { _ops: [] }
  const add = (name) => (...args) => { q._ops.push([name, ...args]); return q }
  for (const m of ['select', 'order', 'range', 'eq', 'gte', 'lt', 'or', 'in', 'limit']) q[m] = add(m)
  q.then = (res, rej) => Promise.resolve(result).then(res, rej)
  calls.push(q)
  return q
}
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => chain({ data: [], error: null, count: 0 })),
    rpc: vi.fn(async (name, args) => ({ data: [{ model_version: 'm' }], error: null, _name: name, _args: args })),
  },
}))

const { supabase } = await import('../lib/supabase')
const { listInspectionsForAiRegister } = await import('../lib/api/inspections')
const { getAiReviewFeedback } = await import('../lib/api/aiTyreInspection')
const {
  shapeFeedbackRows, summarizeFeedback, feedbackExportRows, FEEDBACK_EXPORT_COLUMNS, FEEDBACK_DISCLAIMER,
} = await import('../lib/aiTyreReviewFeedback')

const RAW = [
  { model_version: 'claude-haiku-5-5', prompt_version: 'tyre-photo-v1', jobs: 10, completed: 8, failed: 2, reviewed: 6, accepted: 3, rejected: 2, corrected: 1, unreviewed: 2, with_reviewer_note: 4, known_cost_usd: '0.0123', unpriced_jobs: 1 },
  { model_version: null, prompt_version: null, jobs: 3, completed: 3, failed: 0, reviewed: 0, accepted: 0, rejected: 0, corrected: 0, unreviewed: 3, with_reviewer_note: 0, known_cost_usd: 0, unpriced_jobs: 0 },
]

describe('reviewer feedback aggregate', () => {
  it('computes rates of reviewed findings and N/A (null) when nothing was reviewed', () => {
    const [a, b] = shapeFeedbackRows(RAW)
    expect(a).toMatchObject({ model: 'claude-haiku-5-5', prompt: 'tyre-photo-v1', acceptRate: 50, rejectRate: 33.3, correctedRate: 16.7, knownCostUsd: 0.0123, unpricedJobs: 1 })
    expect(b).toMatchObject({ model: 'unknown', prompt: 'unversioned', acceptRate: null, rejectRate: null })
  })
  it('totals across models', () => {
    const t = summarizeFeedback(shapeFeedbackRows(RAW))
    expect(t).toMatchObject({ jobs: 13, reviewed: 6, accepted: 3, rejected: 2, corrected: 1, unreviewed: 5, acceptRate: 50 })
  })
  it('empty input is safe', () => {
    expect(shapeFeedbackRows(null)).toEqual([])
    expect(summarizeFeedback([]).acceptRate).toBeNull()
  })
  it('export rows carry every column and N/A for missing rates', () => {
    const rows = feedbackExportRows(shapeFeedbackRows(RAW))
    expect(Object.keys(rows[0])).toEqual(FEEDBACK_EXPORT_COLUMNS.map(([k]) => k))
    expect(rows[1]['acceptRate']).toBe('N/A')
  })
  it('is labelled evaluation data and never claims automatic learning', () => {
    expect(FEEDBACK_DISCLAIMER).toMatch(/Evaluation data only/)
    expect(FEEDBACK_DISCLAIMER).toMatch(/No model is retrained or tuned automatically/)
  })
  it('calls the INVOKER rpc with validated dates only', async () => {
    await getAiReviewFeedback({ from: '2026-10-01', to: 'bad' })
    expect(supabase.rpc).toHaveBeenCalledWith('get_ai_tyre_review_feedback', { p_from: '2026-10-01', p_to: null })
  })
})

describe('server-side AI inspection register query', () => {
  const opsOf = (q) => Object.fromEntries(q._ops.map(([n, ...a]) => [n, a]))
  it('applies date, site, status and text filters in the database with an exact count and paging', () => {
    const q = listInspectionsForAiRegister({ page: 2, pageSize: 50, country: 'KSA', dateFrom: '2026-10-01', dateTo: '2026-10-31', site: 'NHC', status: 'Done', search: 'TM5,(x)*%' })
    const ops = q._ops
    expect(ops.find(o => o[0] === 'select')[2]).toEqual({ count: 'exact' })
    expect(ops.find(o => o[0] === 'range').slice(1)).toEqual([100, 149])
    const eqs = ops.filter(o => o[0] === 'eq').map(o => o.slice(1).join('='))
    expect(eqs).toEqual(expect.arrayContaining(['country=KSA', 'site=NHC', 'status=Done']))
    expect(opsOf(q).gte).toEqual(['inspection_date', '2026-10-01'])
    expect(opsOf(q).lt).toEqual(['inspection_date', '2026-11-01']) // inclusive end date => next-day exclusive bound
    // structural PostgREST characters and LIKE wildcards are stripped from the text term
    expect(opsOf(q).or).toEqual(['asset_no.ilike.%TM5x%,site.ilike.%TM5x%'])
  })
  it('does not filter on "all" / empty / malformed values and caps page size', () => {
    const q = listInspectionsForAiRegister({ page: -3, pageSize: 5000, country: 'All', dateFrom: '10/01/2026', dateTo: '', site: 'all', status: 'all', search: '  ' })
    expect(q._ops.some(o => ['eq', 'gte', 'lt', 'or'].includes(o[0]))).toBe(false)
    expect(q._ops.find(o => o[0] === 'range').slice(1)).toEqual([0, 199])
  })
  it('orders newest inspection first with a unique id tiebreak so pages never overlap', () => {
    const q = listInspectionsForAiRegister({})
    const orders = q._ops.filter(o => o[0] === 'order')
    expect(orders[0][1]).toBe('inspection_date')
    expect(orders[1][1]).toBe('id')
  })
})

describe('page wiring', () => {
  it('the AI Inspection page hides actions the backend refuses and no longer uses the fixed 200 window', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(process.cwd(), 'src/pages/AiTyreInspection.jsx'), 'utf8')
    expect(src).not.toMatch(/listInspectionsForPage/)
    expect(src).not.toMatch(/to:199/)
    expect(src).toMatch(/listAiRegisterFiltered/)
    expect(src).toMatch(/mayBackfill&&<details/)
    expect(src).toMatch(/mayViewFeedback&&<details/)
    expect(src).toMatch(/mayReview && job\.status==='completed'/)
    expect(src).toMatch(/disabled=\{!mayQueue\|\|analysisLoading/g)
    const nav = readFileSync(path.resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8')
    expect(nav).toMatch(/ai-tyre-inspection[^\n]*Tyre Data Collector/) // read access preserved
  })
})
