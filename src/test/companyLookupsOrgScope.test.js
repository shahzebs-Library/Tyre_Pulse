import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Single-row lookups by asset code or tyre serial. Both are unique per company
 * (not globally), and a super admin's read spans companies. Two companies here
 * both run TM514 in KSA and both scrapped serial SER-1.
 */
const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'

const h = vi.hoisted(() => {
  const state = { org: null, tables: {} }
  const match = (r, eqs) => eqs.every(([c, v, op]) => (op === 'ilike'
    ? String(r[c] || '').toLowerCase() === String(v).toLowerCase() : r[c] === v))
  function from(table) {
    const eqs = []
    let cap = 1000
    const result = () => {
      const rows = (state.tables[table] || []).filter((r) => match(r, eqs))
      return { data: rows, error: null }
    }
    const b = {
      select() { return b },
      eq(c, v) { eqs.push([c, v]); return b },
      ilike(c, v) { eqs.push([c, v, 'ilike']); return b },
      or() { return b },
      order() { return b },
      limit(n) { cap = n; return b },
      then(onF, onR) { return Promise.resolve({ data: result().data.slice(0, cap), error: null }).then(onF, onR) },
      maybeSingle() {
        const { data } = result()
        if (data.length > 1) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'multiple rows' } })
        return Promise.resolve({ data: data[0] || null, error: null })
      },
    }
    return b
  }
  const rpc = async (name) => (name === 'app_current_org' ? { data: state.org, error: null } : { data: null, error: null })
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const assets = await import('../lib/api/assets')
const exchange = await import('../lib/api/tyreExchange')
const inspections = await import('../lib/api/inspections')
const fitment = await import('../lib/api/fitmentValidation')

beforeEach(() => {
  h.state.org = A
  h.state.tables = {
    vehicle_fleet: [
      { id: '1', asset_no: 'TM514', country: 'KSA', organisation_id: B, make: 'Volvo' },
      { id: '2', asset_no: 'TM514', country: 'KSA', organisation_id: A, make: 'Sany' },
    ],
    tyre_status_marks: [
      { serial: 'SER-1', mark_type: 'scrap', reason: 'B reason', organisation_id: B },
      { serial: 'SER-1', mark_type: 'scrap', reason: 'A reason', organisation_id: A },
    ],
    tyre_records: [
      { serial_no: 'SER-1', asset_no: 'TM514', organisation_id: B, brand: 'B brand' },
      { serial_no: 'SER-1', asset_no: 'TM514', organisation_id: A, brand: 'A brand' },
    ],
  }
})

describe('asset lookup by code prefers the caller company', () => {
  it('returns the caller company machine when two companies share the code', async () => {
    expect((await assets.getAssetByNo('TM514', 'KSA')).make).toBe('Sany')
  })
  it('never picks between two OTHER companies', async () => {
    h.state.org = '00000000-0000-0000-0000-00000000000c'
    const m = await assets.getAssetMatches('TM514', 'KSA')
    expect(m.row).toBeNull()
    expect(m.ambiguous).toBe(true)
  })
  it('a code one company holds still resolves without asking for the company', async () => {
    h.state.tables.vehicle_fleet = h.state.tables.vehicle_fleet.filter((r) => r.organisation_id === B)
    expect((await assets.getAssetByNo('TM514', 'KSA')).make).toBe('Volvo')
  })
})

describe('vehicle lookups behind the inspection and fitment forms', () => {
  it('inspections.findVehicleByAsset uses the caller company machine', async () => {
    expect((await inspections.findVehicleByAsset('TM514', 'KSA')).organisation_id).toBe(A)
  })
  it('fitmentValidation.findVehicleByAsset uses the caller company machine', async () => {
    expect((await fitment.findVehicleByAsset('TM514', { country: 'KSA' })).make).toBe('Sany')
  })
})

describe('tyre serial lookups read the caller company only', () => {
  it('getScrapMark returns the caller company mark instead of failing on two rows', async () => {
    expect((await exchange.getScrapMark('SER-1')).reason).toBe('A reason')
  })
  it('findTyreBySerial shows the caller company tyre', async () => {
    expect((await exchange.findTyreBySerial('SER-1')).brand).toBe('A brand')
  })
})
