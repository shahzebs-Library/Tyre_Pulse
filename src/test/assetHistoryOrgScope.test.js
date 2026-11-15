import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Asset codes and job card numbers are unique per COMPANY, not globally, and a
 * super admin's read spans companies. Two companies here both run a TM514 in
 * KSA and both hold job card JC-1. The asset history page of company A must
 * show A's machine only, and A's job card must not collect B's expense lines.
 */
const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'

const h = vi.hoisted(() => {
  const state = { org: null, tables: {}, calls: [] }
  function from(table) {
    const eqs = []
    state.calls.push({ table, eqs })
    const b = {
      select() { return b },
      eq(c, v) { eqs.push([c, v]); return b },
      in() { return b },
      gte() { return b },
      lte() { return b },
      order() { return b },
      range(f) {
        const rows = (state.tables[table] || []).filter((r) => eqs.every(([c, v]) => r[c] === v))
        return Promise.resolve({ data: f === 0 ? rows : [], error: null })
      },
    }
    return b
  }
  const rpc = async (name) => (name === 'app_current_org' ? { data: state.org, error: null } : { data: null, error: null })
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { loadAssetHistory } = await import('../lib/api/assetHistory')
const { documentChain, chainForCard, assetCompany, jobCardWorkAndQc } = await import('../lib/assetHistory')

beforeEach(() => {
  h.state.org = A
  h.state.calls = []
  h.state.tables = {
    vehicle_fleet: [
      { id: 'fa', asset_no: 'TM514', country: 'KSA', organisation_id: A, make: 'Sany' },
      { id: 'fb', asset_no: 'TM514', country: 'KSA', organisation_id: B, make: 'Volvo' },
    ],
    work_orders: [
      { id: 'wa', asset_no: 'TM514', country: 'KSA', work_order_no: 'JC-1', organisation_id: A },
      { id: 'wb', asset_no: 'TM514', country: 'KSA', work_order_no: 'JC-1', organisation_id: B },
    ],
    parts_consumption: [
      { id: 'pa', asset_code: 'TM514', country: 'KSA', work_order_no: 'JC-1', line_cost: 10, organisation_id: A },
      { id: 'pb', asset_code: 'TM514', country: 'KSA', work_order_no: 'JC-1', line_cost: 999, organisation_id: B },
    ],
  }
})

describe('loadAssetHistory stays inside one company', () => {
  it('a super admin in company A sees only A rows for a code both companies use', async () => {
    const res = await loadAssetHistory('TM514', { country: 'KSA', sources: ['job_card', 'parts_line'] })
    expect(res.org).toBe(A)
    expect(res.fleet.make).toBe('Sany')
    expect(res.crossCountry).toBe(false)
    expect(res.sources.job_card.rows.map((r) => r.id)).toEqual(['wa'])
    expect(res.sources.parts_line.rows.map((r) => r.id)).toEqual(['pa'])
    for (const c of h.state.calls.filter((x) => x.table !== 'vehicle_fleet')) {
      expect(c.eqs).toContainEqual(['organisation_id', A])
    }
  })

  it('a code only another company holds opens that company machine', async () => {
    h.state.tables.vehicle_fleet = h.state.tables.vehicle_fleet.filter((r) => r.organisation_id === B)
    const res = await loadAssetHistory('TM514', { country: 'KSA', sources: ['job_card'] })
    expect(res.org).toBe(B)
    expect(res.sources.job_card.rows.map((r) => r.id)).toEqual(['wb'])
  })
})

describe('documentChain matches job card numbers inside one company', () => {
  const cards = [
    { id: 'wa', work_order_no: 'JC-1', organisation_id: A },
    { id: 'wb', work_order_no: 'JC-1', organisation_id: B },
  ]
  const lines = [
    { id: 'pa', work_order_no: 'JC-1', line_cost: 10, organisation_id: A },
    { id: 'pb', work_order_no: 'JC-1', line_cost: 999, organisation_id: B },
  ]

  it('each company card collects only its own lines', () => {
    const chain = documentChain(cards, lines, [])
    expect(chainForCard(chain, 'JC-1', A).lines.map((l) => l.id)).toEqual(['pa'])
    expect(chainForCard(chain, 'JC-1', A).lineTotal).toBe(10)
    expect(chainForCard(chain, 'JC-1', B).lineTotal).toBe(999)
  })

  it('without a company, a number two companies hold resolves to nothing', () => {
    expect(chainForCard(documentChain(cards, lines, []), 'JC-1')).toBeNull()
  })

  it('work done is read from the same company line items', () => {
    const byWo = new Map([[`${A}::JC-1`, [{ action: 'A WORK' }]], [`${B}::JC-1`, [{ action: 'B WORK' }]]])
    expect(jobCardWorkAndQc({ work_order_no: 'JC-1', organisation_id: A }, byWo).workDone).toBe('A WORK')
  })
})

describe('assetCompany', () => {
  const rows = [{ country: 'KSA', organisation_id: A }, { country: 'KSA', organisation_id: B }]
  it('prefers the caller company, else the single holder, else the caller', () => {
    expect(assetCompany(rows, 'KSA', B)).toBe(B)
    expect(assetCompany([rows[1]], 'KSA', A)).toBe(B)
    expect(assetCompany(rows, 'KSA', null)).toBeNull()
    expect(assetCompany([], 'KSA', A)).toBe(A)
  })
})
