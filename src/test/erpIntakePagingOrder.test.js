import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The existing-key lookups page a table with .range() to build a dedupe Set.
 * PostgREST does NOT guarantee row order across .range() pages without an
 * ORDER BY, so a row can be dropped or repeated at a page boundary. A dropped
 * existing key is not recognised as a duplicate -> it gets re-inserted -> hits
 * the unique constraint -> 23505 -> the whole import batch aborts.
 *
 * These tests pin that every paged read requests a stable .order('id') BEFORE
 * .range(). The defect is invisible to code review (the correct and defective
 * lines look identical), so it has to be pinned by a test.
 */
const h = vi.hoisted(() => {
  const state = { orderCalls: [], rangedWithoutOrder: [] }
  function from(table) {
    let ordered = false
    const b = {
      _table: table,
      select() { return b },
      eq() { return b },
      not() { return b },
      order(col, opts) {
        ordered = true
        state.orderCalls.push({ table, col, opts })
        return b
      },
      range(f) {
        if (!ordered) state.rangedWithoutOrder.push(table)
        // Serve one empty page so paging terminates immediately.
        return Promise.resolve({ data: [], error: null })
      },
      insert() { return Promise.resolve({ error: null, data: null }) },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR) },
    }
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const intake = await import('../lib/api/erpIntake')

beforeEach(() => {
  h.state.orderCalls = []
  h.state.rangedWithoutOrder = []
})

describe('ERP intake paged existing-key reads order before ranging', () => {
  it('countExistingRows (work_orders) orders on id before .range()', async () => {
    await intake.countExistingRows('work_orders', [{ work_order_no: 'RM-1' }], { country: 'UAE' })

    expect(h.state.rangedWithoutOrder).toEqual([])
    const wo = h.state.orderCalls.find((c) => c.table === 'work_orders')
    expect(wo).toBeTruthy()
    expect(wo.col).toBe('id')
    expect(wo.opts).toEqual({ ascending: true })
  })

  it('countExistingRows (vehicle_fleet) orders on id before .range()', async () => {
    await intake.countExistingRows('vehicle_fleet', [{ asset_no: 'TM1' }], { country: 'KSA' })

    expect(h.state.rangedWithoutOrder).toEqual([])
    expect(h.state.orderCalls[0]).toMatchObject({ table: 'vehicle_fleet', col: 'id', opts: { ascending: true } })
  })

  it('insertWorkOrders paged read orders on id before .range()', async () => {
    await intake.insertWorkOrders([{ work_order_no: 'RM-2' }], { country: 'UAE' })

    // No .range() ever ran without a preceding .order()
    expect(h.state.rangedWithoutOrder).toEqual([])
    expect(h.state.orderCalls.some((c) => c.table === 'work_orders' && c.col === 'id')).toBe(true)
  })

  it('insertTyreRecords paged read orders on id before .range()', async () => {
    await intake.insertTyreRecords([{ serial_no: 'S1', asset_no: 'TM1', position: 'RHF1', issue_date: '2026-01-01' }], { country: 'KSA' })

    expect(h.state.rangedWithoutOrder).toEqual([])
    expect(h.state.orderCalls.some((c) => c.table === 'tyre_records' && c.col === 'id')).toBe(true)
  })

  it('insertVehicleFleet paged read orders on id before .range()', async () => {
    await intake.insertVehicleFleet([{ asset_no: 'TM2' }], { country: 'KSA' })

    expect(h.state.rangedWithoutOrder).toEqual([])
    expect(h.state.orderCalls.some((c) => c.table === 'vehicle_fleet' && c.col === 'id')).toBe(true)
  })
})
