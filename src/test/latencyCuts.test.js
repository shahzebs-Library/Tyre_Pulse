import { describe, it, expect, vi, beforeEach } from 'vitest'

// One scripted Supabase stand-in for the latency work: rpc() answers by name
// from `rpcAnswers` (a function or a value), and from() is a thenable builder
// that answers from `tableAnswer` and records every request.
const h = vi.hoisted(() => {
  const state = { rpcAnswers: {}, rpcCalls: [], tableAnswer: { data: [], error: null }, tableCalls: [] }
  function rpc(name, args) {
    state.rpcCalls.push({ name, args })
    const a = state.rpcAnswers[name]
    const v = typeof a === 'function' ? a(args) : (a ?? { data: null, error: null })
    return Promise.resolve(v)
  }
  function from(table) {
    const call = { table, ops: [] }
    state.tableCalls.push(call)
    const b = {}
    for (const op of ['select', 'order', 'eq', 'ilike', 'in', 'update', 'insert', 'delete', 'upsert']) {
      b[op] = (...args) => { call.ops.push([op, ...args]); return b }
    }
    b.maybeSingle = () => Promise.resolve(state.tableAnswer)
    b.single = () => Promise.resolve(state.tableAnswer)
    b.then = (f, r) => Promise.resolve(state.tableAnswer).then(f, r)
    return b
  }
  const supabase = { rpc, from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }) } }
  return { state, supabase }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { allInOrder } = await import('../lib/concurrency')
const { loadMyAccess, _resetAccessBundleProbe } = await import('../lib/api/accessBundle')
const { addPurchaseOrderLines, _resetPoLinesBulkProbe } = await import('../lib/api/procurementChain')
const addresses = await import('../lib/api/countryAddresses')
const { setConfigurationScope } = await import('../lib/configurationStore')
const sysConfig = await import('../lib/api/systemConfig')
const brand = await import('../lib/api/brandLogo')

const missingFn = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }

beforeEach(() => {
  h.state.rpcAnswers = {}
  h.state.rpcCalls = []
  h.state.tableAnswer = { data: [], error: null }
  h.state.tableCalls = []
  _resetAccessBundleProbe()
  _resetPoLinesBulkProbe()
  setConfigurationScope('')
})

describe('allInOrder', () => {
  it('runs tasks together and returns values in input order', async () => {
    const order = []
    const slow = () => new Promise((r) => setTimeout(() => { order.push('a'); r('A') }, 10))
    const fast = () => { order.push('b'); return 'B' }
    expect(await allInOrder([slow, fast])).toEqual(['A', 'B'])
    expect(order).toEqual(['b', 'a'])
  })

  it('rejects with the EARLIEST failing entry, not the first to fail in time', async () => {
    const late = () => new Promise((_, rej) => setTimeout(() => rej(new Error('first')), 10))
    const early = () => Promise.reject(new Error('second'))
    await expect(allInOrder([late, early])).rejects.toThrow('first')
  })
})

describe('loadMyAccess', () => {
  it('reads all three parts in one request when the bundle exists', async () => {
    h.state.rpcAnswers.get_my_access_bundle = {
      data: {
        module_permissions: { data: { dashboard: true }, error: false },
        access_grants: { data: { stock: 'grant' }, error: false },
        capabilities: { data: { stock: { edit: 'grant' } }, error: false },
      },
      error: null,
    }
    const out = await loadMyAccess(h.supabase)
    expect(h.state.rpcCalls.map((c) => c.name)).toEqual(['get_my_access_bundle'])
    expect(out.perms).toEqual({ data: { dashboard: true }, error: null })
    expect(out.grants).toEqual({ data: { stock: 'grant' }, error: null })
    expect(out.caps).toEqual({ data: { stock: { edit: 'grant' } }, error: null })
  })

  it('re-reads only the part the bundle could not compute', async () => {
    h.state.rpcAnswers.get_my_access_bundle = {
      data: {
        module_permissions: { data: { a: true }, error: false },
        access_grants: { data: null, error: true },
        capabilities: { data: {}, error: false },
      },
      error: null,
    }
    h.state.rpcAnswers.get_my_access_grants = { data: { x: 'revoke' }, error: null }
    const out = await loadMyAccess(h.supabase)
    expect(h.state.rpcCalls.map((c) => c.name)).toEqual(['get_my_access_bundle', 'get_my_access_grants'])
    expect(out.grants).toEqual({ data: { x: 'revoke' }, error: null })
  })

  it('falls back to the three separate reads when the bundle is missing, and remembers it', async () => {
    h.state.rpcAnswers.get_my_access_bundle = missingFn
    h.state.rpcAnswers.get_user_module_permissions = { data: { a: true }, error: null }
    h.state.rpcAnswers.get_my_access_grants = { data: {}, error: null }
    h.state.rpcAnswers.get_my_capabilities = { data: null, error: { message: 'denied' } }
    const out = await loadMyAccess(h.supabase)
    expect(out.perms.data).toEqual({ a: true })
    expect(out.caps.error).toBeTruthy()
    await loadMyAccess(h.supabase)
    expect(h.state.rpcCalls.filter((c) => c.name === 'get_my_access_bundle')).toHaveLength(1)
  })

  it('a failed bundle call (not a missing function) still answers through the separate reads', async () => {
    h.state.rpcAnswers.get_my_access_bundle = { data: null, error: { code: '08006', message: 'network' } }
    h.state.rpcAnswers.get_user_module_permissions = { data: { a: true }, error: null }
    const out = await loadMyAccess(h.supabase)
    expect(out.perms.data).toEqual({ a: true })
    await loadMyAccess(h.supabase)
    expect(h.state.rpcCalls.filter((c) => c.name === 'get_my_access_bundle')).toHaveLength(2)
  })
})

describe('addPurchaseOrderLines', () => {
  const lines = [
    { item_id: 'i1', qty_ordered: 2, idempotency_key: 'k1' },
    { item_id: 'i2', qty_ordered: 1 },
  ]

  it('sends every line in one call with the exact per-line payloads and keys', async () => {
    h.state.rpcAnswers.inv_po_add_lines = ({ p_payload }) => ({
      data: { results: p_payload.lines.map((_, i) => (i === 1
        ? { index: i, ok: false, code: '22023', message: 'Unknown item.' }
        : { index: i, ok: true, result: { id: 'L1' } })) },
      error: null,
    })
    const res = await addPurchaseOrderLines('po1', lines)
    expect(h.state.rpcCalls).toHaveLength(1)
    const sent = h.state.rpcCalls[0].args.p_payload
    expect(sent.po_id).toBe('po1')
    expect(sent.lines[0]).toEqual({ po_id: 'po1', idempotency_key: 'k1', item_id: 'i1', description: null, qty_ordered: 2, unit_price: null, currency: null })
    expect(sent.lines[1].idempotency_key).toBe('po:po1:line:1:i2')
    expect(res.lineIds).toEqual([{ id: 'L1' }])
    expect(res.failedLines).toHaveLength(1)
    expect(res.failedLines[0]).toMatchObject({ index: 1, key: null })
  })

  it('falls back to one call per line, in order, when the bulk function is missing', async () => {
    h.state.rpcAnswers.inv_po_add_lines = missingFn
    h.state.rpcAnswers.inv_po_add_line = ({ p_payload }) => ({ data: { id: p_payload.item_id }, error: null })
    const res = await addPurchaseOrderLines('po1', lines)
    expect(h.state.rpcCalls.map((c) => c.name)).toEqual(['inv_po_add_lines', 'inv_po_add_line', 'inv_po_add_line'])
    expect(h.state.rpcCalls[1].args.p_payload.idempotency_key).toBe('k1')
    expect(res.lineIds).toEqual([{ id: 'i1' }, { id: 'i2' }])
    await addPurchaseOrderLines('po1', lines)
    expect(h.state.rpcCalls.filter((c) => c.name === 'inv_po_add_lines')).toHaveLength(1)
  })

  it('a bulk call that fails outright is retried line by line (keys make it safe)', async () => {
    h.state.rpcAnswers.inv_po_add_lines = { data: null, error: { code: '08006', message: 'network' } }
    h.state.rpcAnswers.inv_po_add_line = { data: { ok: 1 }, error: null }
    const res = await addPurchaseOrderLines('po1', lines)
    expect(res.lineIds).toHaveLength(2)
    expect(res.failedLines).toEqual([])
  })

  it('does nothing for no lines', async () => {
    expect(await addPurchaseOrderLines('po1', [])).toEqual({ lineIds: [], failedLines: [] })
    expect(h.state.rpcCalls).toHaveLength(0)
  })
})

describe('country address cache', () => {
  it('reuses one read per signed-in identity and drops it on save and identity change', async () => {
    setConfigurationScope('u1|org1')
    h.state.tableAnswer = { data: [{ id: 'a', country: 'KSA' }], error: null }
    const first = await addresses.listCountryAddresses()
    first[0].country = 'edited'
    const second = await addresses.listCountryAddresses()
    expect(second[0].country).toBe('KSA') // callers get their own copies
    expect(h.state.tableCalls).toHaveLength(1)

    h.state.tableAnswer = { data: null, error: null }
    await addresses.deleteCountryAddress('KSA')
    h.state.tableAnswer = { data: [], error: null }
    expect(await addresses.listCountryAddresses()).toEqual([])

    const before = h.state.tableCalls.length
    setConfigurationScope('u2|org1')
    await addresses.listCountryAddresses()
    expect(h.state.tableCalls.length).toBe(before + 1)
  })

  it('never caches a failed read', async () => {
    setConfigurationScope('u1|org1')
    h.state.tableAnswer = { data: null, error: { message: 'boom', code: '500' } }
    await expect(addresses.listCountryAddresses()).rejects.toBeTruthy()
    h.state.tableAnswer = { data: [{ id: 'b', country: 'UAE' }], error: null }
    expect(await addresses.listCountryAddresses()).toEqual([{ id: 'b', country: 'UAE' }])
  })

  it('does not cache before a user is known', async () => {
    h.state.tableAnswer = { data: [], error: null }
    await addresses.listCountryAddresses()
    await addresses.listCountryAddresses()
    expect(h.state.tableCalls).toHaveLength(2)
  })
})

describe('diagram background from the system config cache', () => {
  it('answers from the primed cache without a request, and a save updates it', async () => {
    sysConfig.primeConfigCache({ report_diagram_bg: '#112233' }, { report_diagram_bg: '#112233' })
    expect(await brand.getDiagramBg()).toBe('#112233')
    expect(h.state.tableCalls).toHaveLength(0)
    h.state.tableAnswer = { data: null, error: null }
    await brand.setDiagramBg('#445566')
    expect(await brand.getDiagramBg()).toBe('#445566')
    expect(h.state.tableCalls.filter((c) => c.ops.some((o) => o[0] === 'select'))).toHaveLength(0)
  })
})
