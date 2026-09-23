import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: [], calls: [], errorFrom: null }))
vi.mock('../lib/supabase', () => ({ supabase: { from(table) {
  const calls = { table, eq: [], order: [] }
  h.calls.push(calls)
  const q = {
    select: () => q,
    eq: (...args) => { calls.eq.push(args); return q },
    or: value => { calls.country = value; return q },
    order: (...args) => { calls.order.push(args); return q },
    range: (from, to) => {
      calls.range = [from, to]
      return Promise.resolve(from === h.errorFrom
        ? { data: null, error: { message: 'unavailable' } }
        : { data: h.rows.slice(from, to + 1), error: null })
    },
  }
  return q
} } }))
import { listMonthlySubmissions, listSubmissions } from '../lib/api/checklists'
const options = { templateId: 'template', country: 'KSA', fields: [{ id: 'date', type: 'date' }], year: 2026, month: 8 }
beforeEach(() => { h.rows = []; h.calls = []; h.errorFrom = null })

it('loads the submissions register beyond the former 200-sheet cap', async () => {
  h.rows = Array.from({ length: 501 }, (_, id) => ({ id }))
  expect(await listSubmissions({ country: 'KSA' })).toHaveLength(501)
})

it('finds August sheets received in September beyond the first server page', async () => {
  h.rows = Array.from({ length: 501 }, (_, id) => ({ id, created_at: '2026-09-12', answers: { date: id === 500 ? '2026-08-23' : '2026-09-12' } }))
  expect((await listMonthlySubmissions(options)).map(row => row.id)).toEqual([500])
  expect(h.calls.map(call => call.range)).toEqual([[0, 499], [500, 999]])
  for (const call of h.calls) {
    expect(call.eq).toContainEqual(['template_id', 'template'])
    expect(call.country).toContain('country.eq.KSA')
    expect(call.order).toContainEqual(['id'])
  }
})
it('uses the received date only for sheets without a recorded date', async () => {
  h.rows = [{ id: 1, submitted_at: '2026-08-19' }, { id: 2, submitted_at: '2026-08-19', answers: { date: '2026-09-01' } }]
  expect((await listMonthlySubmissions(options)).map(row => row.id)).toEqual([1])
})
it('rejects an incomplete read instead of reporting older days as missed', async () => {
  h.rows = Array.from({ length: 501 }, (_, id) => ({ id }))
  h.errorFrom = 500
  await expect(listMonthlySubmissions(options)).rejects.toThrow()
})
