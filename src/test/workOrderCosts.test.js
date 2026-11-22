// Work order cost ledger (owner decision 2026-11-15, round 4).
// - the imported cost is never replaced; only APPROVED entries change the calculated total
// - unapproved entries are shown apart and are in no total
// - before the ledger is on the database every client path degrades: no crash, no write to
//   work_orders, no fabricated figure
// - an added cost cannot enter a governed total (expense grid) at all, so never twice
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  summarizeWorkOrderCosts, costEntryFromPartLine, isApprovedCost, COST_STATUSES, COST_UNAPPROVED, COST_SOURCES,
  COST_LEDGER_UNAVAILABLE,
} from '../lib/workOrderCosts'
import { workOrderMaintenanceAmount } from '../lib/governedCost'

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/api/_client', async () => {
  const actual = await vi.importActual('../lib/api/_client')
  return { ...actual, supabase: { from: db.from, rpc: db.rpc } }
})
import { listCostEntries, addCostEntry, decideCostEntry, submitCostEntry } from '../lib/api/workOrderCosts'

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const order = { id: 'w1', parts_cost: 1775.82, labour_cost: 0, total_cost: 1775.82 }
const entry = (o) => ({ entry_kind: 'additional', status: 'approved', amount: 20, ...o })

describe('the four figures', () => {
  it('imported 1,775.82 plus a verified 20.00 is 1,795.82, and the imported figure is kept', () => {
    const s = summarizeWorkOrderCosts(order, [entry({})])
    expect(s).toMatchObject({ imported: 1775.82, importedParts: 1775.82, additionalApproved: 20, calculatedTotal: 1795.82, unapprovedCount: 0, known: true })
  })

  it('unapproved, rejected and reversed entries are in no total', () => {
    const s = summarizeWorkOrderCosts(order, [
      entry({ status: 'draft', amount: 500 }), entry({ status: 'pending_reconciliation', amount: 900 }),
      entry({ status: 'pending_approval', amount: 10 }), entry({ status: 'rejected', amount: 700 }),
      entry({ status: 'reversed', amount: 400 }),
    ])
    expect(s.calculatedTotal).toBe(1775.82)
    expect(s.additionalApproved).toBe(0)
    expect(s.unapprovedAmount).toBe(1410)
    expect(s.unapprovedCount).toBe(3)
  })

  it('approved adjustments and refunds: total = imported + additional + adjustments - refunds', () => {
    const s = summarizeWorkOrderCosts(order, [
      entry({ amount: 20 }), entry({ entry_kind: 'adjustment', amount: -3 }), entry({ entry_kind: 'refund', amount: 5 }),
    ])
    expect(s).toMatchObject({ additionalApproved: 20, adjustmentsApproved: -3, refundsApproved: 5, calculatedTotal: 1787.82 })
  })

  it('the same line entered twice counts once per APPROVED entry only', () => {
    const s = summarizeWorkOrderCosts(order, [entry({}), entry({ status: 'pending_reconciliation' })])
    expect(s.calculatedTotal).toBe(1795.82)
    expect(s.unapprovedAmount).toBe(20)
  })

  it('an unreadable ledger gives the imported total alone and null (never zero) ledger figures', () => {
    const s = summarizeWorkOrderCosts(order, null)
    expect(s).toMatchObject({ known: false, calculatedTotal: 1775.82, additionalApproved: null, unapprovedAmount: null, unapprovedCount: null })
    expect(summarizeWorkOrderCosts({ id: 'x' }, []).calculatedTotal).toBe(null)
  })

  it('vocabulary matches the draft', () => {
    const sql = read('supabase/pending_migrations/20261115142000_wo_cost_entries_ledger.sql')
    const list = (name) => [...sql.match(new RegExp(`constraint ${name} check \\(\\w+ in \\(([^)]*)\\)\\)`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(list('wo_cost_status_chk').sort()).toEqual([...COST_STATUSES].sort())
    expect(list('wo_cost_source_chk')).toEqual([...COST_SOURCES])
    for (const s of COST_UNAPPROVED) expect(sql).toContain(`'${s}'`)
    expect(isApprovedCost({ status: 'approved' })).toBe(true)
    expect(isApprovedCost({ status: 'pending_approval' })).toBe(false)
    expect(sql).not.toMatch(/40001/)
    expect(sql).toContain('select anum_integration.apply_reader_policies();')
    // The view counts approved entries only.
    expect(sql).toContain("filter (where c.status = 'approved' and c.entry_kind = 'additional')")
  })

  it('a form line becomes a draft entry, never a parts_cost write', () => {
    expect(costEntryFromPartLine({ part_name: ' Hose ', quantity: 2, unit_cost: 10 }))
      .toMatchObject({ kind: 'additional', category: 'parts', description: 'Hose', quantity: 2, unitCost: 10, amount: 20, source: 'manual' })
  })
})

describe('degrades safely before the draft is applied', () => {
  beforeEach(() => { db.from.mockReset(); db.rpc.mockReset() })
  const chain = (result) => {
    const b = { select: () => b, eq: () => b, order: () => b, limit: () => Promise.resolve(result) }
    return b
  }

  it('reading: a missing table is "not available", entries null, no throw', async () => {
    db.from.mockReturnValue(chain({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }))
    await expect(listCostEntries('w1')).resolves.toEqual({ available: false, entries: null })
    db.from.mockReturnValue(chain({ data: null, error: { code: '42P01', message: 'relation does not exist' } }))
    await expect(listCostEntries('w1')).resolves.toEqual({ available: false, entries: null })
    db.from.mockImplementation(() => { throw new Error('network') })
    await expect(listCostEntries('w1')).resolves.toEqual({ available: false, entries: null })
  })

  it('reading: a failed read of an installed ledger is null entries, not an empty list', async () => {
    db.from.mockReturnValue(chain({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(listCostEntries('w1')).resolves.toEqual({ available: true, entries: null })
  })

  it('writing: a missing function raises the plain "not available" sentence and nothing else is called', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    for (const run of [() => addCostEntry('w1', { description: 'x', reason: 'y', amount: 1 }), () => submitCostEntry('e1'), () => decideCostEntry('e1', 'approved', 'n')]) {
      await expect(run()).rejects.toMatchObject({ unavailable: true, message: COST_LEDGER_UNAVAILABLE })
    }
    expect(db.from).not.toHaveBeenCalled()   // never falls back to writing work_orders
  })

  it('the ledger service never touches work_orders', () => {
    expect(read('src/lib/api/workOrderCosts.js')).not.toMatch(/from\('work_orders'\)/)
  })
})

describe('governed totals cannot count an added work order cost twice', () => {
  it('no governed cost source reads the ledger', () => {
    for (const f of ['src/lib/api/costSummary.js', 'src/lib/governedCost.js', 'src/lib/api/partsConsumption.js']) {
      if (!existsSync(resolve(process.cwd(), f))) continue
      expect(read(f)).not.toMatch(/work_order_cost_entries|v_work_order_cost_totals/)
    }
  })

  it('the work order maintenance amount is built from stored columns only, so a ledger entry cannot change it', () => {
    const base = workOrderMaintenanceAmount(order)
    expect(workOrderMaintenanceAmount({ ...order, cost_entries: [entry({ amount: 999 })], calculated_total: 9999, additional_approved: 999 })).toBe(base)
  })

  it('no form path writes parts_cost on an edit', () => {
    const page = read('src/pages/WorkOrders.jsx')
    const editBranch = page.slice(page.indexOf('const patch = jobCardEditPatch(editOrder, formData)'), page.indexOf('const payload = toPayload(formData)'))
    expect(editBranch).not.toMatch(/parts_cost/)
    expect(read('src/lib/jobCard.js')).toContain('delete patch.parts_cost')
  })
})
