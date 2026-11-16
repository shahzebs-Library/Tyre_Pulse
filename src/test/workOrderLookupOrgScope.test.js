import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Job card numbers are unique per company (TEN-1b). A super admin's read spans
 * companies, so opening a job card by NUMBER must pick the caller's company's
 * card, never an arbitrary one. Two companies share "GCKR/JC/0001/0126" here.
 */
const h = vi.hoisted(() => {
  const state = { org: null, rows: [], eqs: [] }
  function from() {
    const eqs = []
    state.eqs.push(eqs)
    const b = {
      select() { return b },
      eq(c, v) { eqs.push([c, v]); return b },
      order() { return b },
      limit() {
        const rows = state.rows.filter((r) => eqs.every(([c, v]) => r[c] === v))
        return Promise.resolve({ data: rows, error: null })
      },
    }
    return b
  }
  const rpc = async (name) => (name === 'app_current_org' ? { data: state.org, error: null } : { data: null, error: null })
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { loadWorkOrderByRef } = await import('../lib/api/workOrderLookup')
const { pickCompanyRow } = await import('../lib/api/companyScope')

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const C = '00000000-0000-0000-0000-00000000000c'
const NO = 'GCKR/JC/0001/0126'

beforeEach(() => {
  Object.assign(h.state, {
    org: A,
    eqs: [],
    rows: [
      { id: '11111111-1111-1111-1111-111111111111', work_order_no: NO, organisation_id: B, country: 'KSA' },
      { id: '22222222-2222-2222-2222-222222222222', work_order_no: NO, organisation_id: A, country: 'KSA' },
    ],
  })
})

describe('loadWorkOrderByRef', () => {
  it('a super admin opening a shared number gets their own company card', async () => {
    const { job, ambiguous } = await loadWorkOrderByRef(NO, { select: '*', country: 'KSA' })
    expect(ambiguous).toBe(false)
    expect(job.organisation_id).toBe(A)
  })

  it('a number held by one other company only still opens that card', async () => {
    h.state.rows = h.state.rows.filter((r) => r.organisation_id === B)
    const { job } = await loadWorkOrderByRef(NO, { select: '*' })
    expect(job.organisation_id).toBe(B)
  })

  it('a number held by several other companies is ambiguous, never an arbitrary card', async () => {
    h.state.org = C
    const { job, ambiguous } = await loadWorkOrderByRef(NO, { select: '*' })
    expect(job).toBeNull()
    expect(ambiguous).toBe(true)
  })

  it('an id lookup is exact and does not need the company', async () => {
    const { job } = await loadWorkOrderByRef('11111111-1111-1111-1111-111111111111', { select: '*' })
    expect(job.organisation_id).toBe(B)
  })
})

describe('pickCompanyRow', () => {
  it('prefers the given company, else the single row, else nothing', () => {
    expect(pickCompanyRow([{ organisation_id: A }, { organisation_id: B }], B).row.organisation_id).toBe(B)
    expect(pickCompanyRow([{ organisation_id: B }], A).row.organisation_id).toBe(B)
    expect(pickCompanyRow([{ organisation_id: A }, { organisation_id: B }], null)).toEqual({ row: null, ambiguous: true })
    expect(pickCompanyRow([], A)).toEqual({ row: null, ambiguous: false })
  })
})
