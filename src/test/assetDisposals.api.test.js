import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * assetDisposals - the disposal register service.
 *
 * The behaviours worth pinning are the ones that are silently wrong when they
 * break: the register degrading to a shaped empty envelope instead of throwing,
 * a re-upload REFRESHING on the natural key rather than duplicating, a decision
 * carrying a time, and the sanitiser refusing to post columns the table does not
 * own (organisation_id above all - that is a tenant boundary, not a typo).
 */

// A thenable builder: every step returns itself so the terminal step can be
// `.single()`, `.select()` or the builder itself, and awaiting any of them
// resolves. A bare promise from select() would break `.eq()` chained after it.
function makeBuilder(result, record) {
  const b = {
    select: (...a) => { record?.('select', a); return b },
    eq: (...a) => { record?.('eq', a); return b },
    order: () => b,
    limit: () => b,
    single: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return b
}

const { state } = vi.hoisted(() => ({
  state: { current: {} },
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const s = state.current
      s.table = table
      const b = makeBuilder(s.tableResult ?? { data: { id: 'row-1' }, error: null })
      b.upsert = (rows, opts) => { s.upsert = { rows, opts }; return makeBuilder(s.upsertResult ?? { data: rows.map((_, i) => ({ id: `u${i}` })), error: null }) }
      b.update = (patch) => { s.update = patch; return b }
      b.delete = () => b
      b.insert = (rows) => { s.insert = rows; return b }
      return b
    },
    rpc: (name, args) => {
      state.current.rpc = { name, args }
      return Promise.resolve(state.current.rpcResult ?? { data: null, error: { code: '42883', message: 'function does not exist' } })
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-9' } } }) },
  },
}))

const {
  getDisposalRegister, upsertDisposal, updateDisposal, setDisposalDecision,
  importDisposalRows, mapDisposalSheetRows,
} = await import('../lib/api/assetDisposals')

beforeEach(() => { state.current = {} })

describe('getDisposalRegister', () => {
  it('returns the register on the happy path', async () => {
    state.current.rpcResult = {
      data: {
        ok: true,
        country: 'KSA',
        rows: [{ asset_no: 'BP022', disposition: 'scrap', in_register: false }],
        totals: { assets: 1, spend: 100 },
      },
      error: null,
    }
    const res = await getDisposalRegister({ country: 'KSA' })
    expect(res.ok).toBe(true)
    expect(res.rows).toHaveLength(1)
    expect(res.totals.assets).toBe(1)
    expect(state.current.rpc).toEqual({ name: 'get_asset_disposal_register', args: { p_country: 'KSA' } })
  })

  it('sends a null country for the All scope', async () => {
    state.current.rpcResult = { data: { ok: true, rows: [], totals: null }, error: null }
    await getDisposalRegister({ country: 'All' })
    expect(state.current.rpc.args.p_country).toBeNull()
  })

  it('degrades to a shaped empty envelope when the RPC is not provisioned', async () => {
    const res = await getDisposalRegister({ country: 'KSA' })
    expect(res).toMatchObject({ ok: false, reason: 'not_provisioned', rows: [], totals: null })
  })

  it('passes the server reason through when the RPC refuses', async () => {
    state.current.rpcResult = { data: { ok: false, reason: 'forbidden' }, error: null }
    const res = await getDisposalRegister({})
    expect(res).toMatchObject({ ok: false, reason: 'forbidden', rows: [] })
  })
})

describe('writes', () => {
  it('upserts on the natural key and never sends organisation_id', async () => {
    await upsertDisposal({
      country: 'KSA', asset_no: ' tm192 ', disposition: 'sell',
      organisation_id: 'other-tenant', in_register: false, job_cards: 12,
    })
    expect(state.current.upsert.opts.onConflict).toBe('organisation_id,country,asset_no')
    const [row] = state.current.upsert.rows
    expect(row.asset_no).toBe('TM192')
    expect(row).not.toHaveProperty('organisation_id')
    // joined evidence is never written back
    expect(row).not.toHaveProperty('in_register')
    expect(row).not.toHaveProperty('job_cards')
  })

  it('patches only the fields supplied', async () => {
    await updateDisposal('row-1', { condition: 'Poor', bogus: 1 })
    expect(state.current.update).toEqual({ condition: 'Poor' })
  })

  it('stamps a decision with a time and an actor', async () => {
    await setDisposalDecision('row-1', { status: 'approved', decision_note: 'Committee 12 Aug' })
    expect(state.current.update.status).toBe('approved')
    expect(state.current.update.decided_by).toBe('user-9')
    expect(typeof state.current.update.decided_at).toBe('string')
    // not a disposal yet, so no reference or disposal date is invented
    expect(state.current.update.disposal_ref).toBeUndefined()
    expect(state.current.update.disposed_at).toBeUndefined()
  })

  it('records a disposal date and reference only when marked disposed', async () => {
    await setDisposalDecision('row-1', { status: 'disposed', disposal_ref: 'SCRAP-7' })
    expect(state.current.update.disposal_ref).toBe('SCRAP-7')
    expect(state.current.update.disposed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('importDisposalRows', () => {
  it('upserts on the natural key and reports rows it could not key', async () => {
    const rows = [
      { country: 'KSA', asset_no: 'BP022' },
      { country: 'KSA', asset_no: 'BP023' },
      { country: 'KSA' }, // no asset: cannot be keyed, must not be written
    ]
    const res = await importDisposalRows(rows)
    expect(state.current.upsert.opts.onConflict).toBe('organisation_id,country,asset_no')
    expect(state.current.upsert.rows).toHaveLength(2)
    expect(res.written).toBe(2)
    expect(res.skipped).toBe(1)
    expect(res.failed).toBe(0)
  })

  it('captures a failing batch instead of throwing', async () => {
    state.current.upsertResult = { data: null, error: { message: 'permission denied' } }
    const res = await importDisposalRows([{ country: 'KSA', asset_no: 'TM192' }])
    expect(res.written).toBe(0)
    expect(res.failed).toBe(1)
    expect(res.errors[0]).toContain('permission denied')
  })
})

describe('mapDisposalSheetRows', () => {
  it('maps committee headings, folds the disposition and keeps the source row', () => {
    const out = mapDisposalSheetRows(
      [
        { 'Asset No': 'tm192', 'Region': 'Central', 'Decision': 'To be scrapped', 'Remarks': 'Engine seized' },
        { 'Asset No': 'BP022', 'Decision': 'Sell as is' },
        { 'Remarks': 'no asset code here' },
      ],
      { country: 'KSA', sourceFile: 'committee.xlsx' },
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      asset_no: 'TM192', region: 'Central', disposition: 'scrap',
      remarks: 'Engine seized', country: 'KSA', source_file: 'committee.xlsx', source_row: 1,
    })
    // a non-breaking space in the header must still match
    expect(out[1].asset_no).toBe('BP022')
    expect(out[1].disposition).toBe('sell')
  })

  it('leaves an unreadable decision undecided rather than guessing', () => {
    const [row] = mapDisposalSheetRows([{ Asset: 'TM100', Decision: 'hold for review' }], { country: 'KSA' })
    expect(row.disposition).toBe('undecided')
  })
})
