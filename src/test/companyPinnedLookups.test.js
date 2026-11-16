import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Vehicle details, pick lists and search keyed by an asset code or serial stay
 * in ONE company. Two companies (A = the caller's, B) both run TM514 in KSA; a
 * super admin's reads span both. Every read the screens make by code must pin
 * the record's company, and every write must touch one machine only.
 */
const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const C = '00000000-0000-0000-0000-00000000000c'

const h = vi.hoisted(() => {
  const state = { org: null, tables: {}, calls: [] }
  const match = (r, f) => f.every(([op, c, v]) => {
    if (op === 'eq') return r[c] === v
    if (op === 'ilike') return String(r[c] || '').toLowerCase() === String(v).toLowerCase()
    if (op === 'is') return (r[c] ?? null) === v
    return true
  })
  function from(table) {
    const call = { table, filters: [], or: null, update: null }
    state.calls.push(call)
    let cap = 1000
    let range = null
    const rows = () => (state.tables[table] || []).filter((r) => match(r, call.filters))
    const run = () => {
      let data = rows()
      if (range) data = data.slice(range[0], range[1] + 1)
      return { data: data.slice(0, cap), error: null }
    }
    const b = {
      select() { return b },
      update(p) { call.update = p; return b },
      eq(c, v) { call.filters.push(['eq', c, v]); return b },
      ilike(c, v) { call.filters.push(['ilike', c, v]); return b },
      is(c, v) { call.filters.push(['is', c, v]); return b },
      in() { return b },
      or(s) { call.or = s; return b },
      order() { return b },
      limit(n) { cap = n; return b },
      range(a, z) { range = [a, z]; return b },
      maybeSingle() { const d = run().data; return Promise.resolve({ data: d[0] || null, error: null }) },
      then(onF, onR) { return Promise.resolve(run()).then(onF, onR) },
    }
    return b
  }
  const rpc = vi.fn(async (name) => (name === 'app_current_org' ? { data: state.org, error: null } : { data: null, error: null }))
  return { state, supabase: { from, rpc, storage: { from: () => ({}) } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const scope = await import('../lib/api/companyScope')
const v360 = await import('../lib/api/vehicle360')
const assetApi = await import('../lib/api/assetManagement')
const twin = await import('../lib/api/digitalTwin')
const insurance = await import('../lib/api/vehicleInsurance')
const pm = await import('../lib/api/pmPrograms')
const util = await import('../lib/api/assetUtilization')
const { searchAll } = await import('../components/GlobalSearch')

const orgFilter = (call) => call.filters.find(([op, c]) => op === 'eq' && c === 'organisation_id')?.[2]
const callsTo = (t) => h.state.calls.filter((c) => c.table === t)

beforeEach(() => {
  h.state.org = A
  h.state.calls = []
  h.supabase.rpc.mockClear()
  h.state.tables = {
    vehicle_fleet: [
      { id: '1', asset_no: 'TM514', country: 'KSA', organisation_id: B, make: 'Volvo' },
      { id: '2', asset_no: 'TM514', country: 'KSA', organisation_id: A, make: 'Sany' },
    ],
    tyre_records: [
      { id: 't1', asset_no: 'TM514', country: 'KSA', organisation_id: B, serial_no: 'B-1', removal_date: null },
      { id: 't2', asset_no: 'TM514', country: 'KSA', organisation_id: A, serial_no: 'A-1', removal_date: null },
    ],
    insurance_policy_assets: [
      { id: 'i1', asset_no: 'TM514', country: 'KSA', organisation_id: B },
      { id: 'i2', asset_no: 'TM514', country: 'KSA', organisation_id: A },
    ],
  }
})

describe('pinCompany', () => {
  it('adds the company filter only for a real company id', () => {
    const seen = []
    const q = { eq: (c, v) => { seen.push([c, v]); return q } }
    scope.pinCompany(q, A)
    scope.pinCompany(q, null)
    scope.pinCompany(q, 'not-a-uuid')
    expect(seen).toEqual([['organisation_id', A]])
  })
})

describe('companyRowsForCode', () => {
  it('one company: rows kept, that company pins, no round trip', async () => {
    const r = await scope.companyRowsForCode([{ organisation_id: B }])
    expect(r).toEqual({ rows: [{ organisation_id: B }], orgId: B, ambiguous: false })
    expect(h.supabase.rpc).not.toHaveBeenCalled()
  })
  it('two companies incl. the caller: the caller rows only', async () => {
    const r = await scope.companyRowsForCode(h.state.tables.vehicle_fleet)
    expect(r.rows.map((x) => x.id)).toEqual(['2'])
    expect(r.orgId).toBe(A)
  })
  it('two OTHER companies: nothing, ambiguous', async () => {
    h.state.org = C
    const r = await scope.companyRowsForCode(h.state.tables.vehicle_fleet)
    expect(r).toEqual({ rows: [], orgId: C, ambiguous: true })
  })
  it('no rows: the caller company pins the reads that follow', async () => {
    expect((await scope.companyRowsForCode([])).orgId).toBe(A)
  })
})

describe('Vehicle 360', () => {
  it('reads the base table (the view has no company) and opens the caller company machine', async () => {
    const v = await v360.getVehicle('TM514', { country: 'KSA' })
    expect(v.make).toBe('Sany')
    expect(callsTo('vehicles')).toHaveLength(0)
    expect(callsTo('vehicle_fleet')).toHaveLength(1)
  })
  it('opens nothing when only two OTHER companies hold the code', async () => {
    h.state.org = C
    expect(await v360.getVehicle('TM514', { country: 'KSA' })).toBeNull()
  })
  it('tyres are pinned to the vehicle company', async () => {
    const rows = await v360.getVehicleTyres('TM514', { country: 'KSA', orgId: A })
    expect(rows.map((r) => r.id)).toEqual(['t2'])
  })
  it('GPS save touches ONE machine: by id when known', async () => {
    await v360.saveVehicleGps('TM514', 24.7, 46.7, 'manual', { country: 'KSA', orgId: A, id: '2' })
    const c = callsTo('vehicle_fleet').at(-1)
    expect(c.update).toBeTruthy()
    expect(c.filters).toEqual([['eq', 'id', '2']])
  })
  it('GPS save without an id is pinned to the company, not every same-numbered machine', async () => {
    await v360.saveVehicleGps('TM514', 24.7, 46.7, 'manual', { country: 'KSA', orgId: A })
    expect(orgFilter(callsTo('vehicle_fleet').at(-1))).toBe(A)
  })
  it('insurance lines are pinned to the vehicle company', async () => {
    const rows = await insurance.listVehicleInsuranceLines('TM514', { country: 'KSA', orgId: A })
    expect(rows.map((r) => r.id)).toEqual(['i2'])
  })
})

describe('Asset Detail per-asset reads', () => {
  it('tyres / inspections / accidents / meters carry the company', async () => {
    await assetApi.listAssetTyres('TM514', 'KSA', A)
    await assetApi.listAssetInspections('TM514', 'KSA', A)
    await assetApi.listAssetAccidents('TM514', 'KSA', A)
    await assetApi.latestOdometer('TM514', 'KSA', A)
    await assetApi.latestEngineHours('TM514', 'KSA', A)
    await pm.listPmPrograms({ orgId: A })
    await pm.listPmServiceRecords({ asset_no: 'TM514', orgId: A })
    await util.getAssetUtilization('TM514', { orgId: A })
    for (const t of ['tyre_records', 'inspections', 'accidents', 'odometer_logs', 'engine_hours_logs',
      'pm_programs', 'pm_service_records', 'asset_utilization']) {
      expect(orgFilter(callsTo(t).at(-1)), t).toBe(A)
    }
  })
  it('without a company the reads are unchanged (RLS-only, never wider)', async () => {
    await assetApi.listAssetTyres('TM514', 'KSA')
    expect(orgFilter(callsTo('tyre_records').at(-1))).toBeUndefined()
  })
})

describe('Digital Twin', () => {
  it('twin tyres are pinned to the machine company', async () => {
    const res = await twin.getAssetTwinRecords('TM514', { country: 'KSA', orgId: A })
    expect((res.data ?? res).map((r) => r.id)).toEqual(['t2'])
  })
  it('the asset picker lists the caller company only', async () => {
    await twin.searchAssets('TM5', { country: 'KSA' })
    expect(orgFilter(callsTo('tyre_records').at(-1))).toBe(A)
  })
})

describe('legacy global search', () => {
  it('searches the real serial column, the base fleet table, in the caller company', async () => {
    await searchAll('TM514')
    const tyre = callsTo('tyre_records').at(-1)
    expect(tyre.or).toContain('serial_no.ilike')
    expect(tyre.or).not.toContain('serial_number')
    expect(callsTo('vehicles')).toHaveLength(0)
    for (const t of ['tyre_records', 'vehicle_fleet', 'inspections', 'work_orders', 'stock']) {
      expect(orgFilter(callsTo(t).at(-1)), t).toBe(A)
    }
  })
})
