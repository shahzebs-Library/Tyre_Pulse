// Regression: saving the job card form rewrote stored values nobody touched.
// Parts Cost became 0 on every imported job card (a stored cost with no parts
// lines typed in the app), a stored labour cost was re-derived, and the status
// "Open" was rewritten to "New". An edit now sends only what the user changed.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { jobCardEditPatch, jobCardFormValues, partsLinesTotal } from '../lib/jobCard'

const src = readFileSync(resolve(__dirname, '../pages/WorkOrders.jsx'), 'utf8').replace(/\r\n/g, '\n')

// An imported job card: a cost with no parts lines typed in the app.
const imported = {
  id: 'wo-1', work_order_no: 'GCKR/JC/0001/0826', asset_no: 'TM514', status: 'Open',
  priority: 'Medium', work_type: 'Repair', scope: 'Internal', site: 'NHC', country: 'KSA',
  opened_at: '2026-08-06T05:42:00+00:00', completed_at: '2026-08-07T09:10:33+00:00',
  labour_hours: 4, labour_rate: 50, labour_cost: 350.5, parts_cost: 1775.82, parts_used: [],
  tyre_cost: null, created_by: 'someone-else',
  custom_data: { mr_no: 'MR-77', erp_reported_cost: { spare_parts: 1775.82 } },
}
const edit = (row, changes) => jobCardEditPatch(row, { ...jobCardFormValues(row), ...changes })

describe('job card edit sends only what the user changed', () => {
  it('nothing changed: empty patch', () => {
    expect(edit(imported, {})).toEqual({})
  })

  it('imported card (cost, no lines) edited on Scope only: cost is not sent', () => {
    expect(edit(imported, { scope: 'External' })).toEqual({ scope: 'External' })
  })

  it('numeric columns that arrive as strings are still unchanged', () => {
    const row = { ...imported, parts_cost: '1775.82', labour_cost: '350.50', labour_hours: '4', labour_rate: '50.00' }
    expect(edit(row, { scope: 'External' })).toEqual({ scope: 'External' })
  })

  it('lines unchanged but stored cost differs from the lines total: cost is not sent', () => {
    const row = { ...imported, parts_cost: 1154.34, parts_used: [{ part_name: 'Filter', quantity: 2, unit_cost: 50 }] }
    expect(partsLinesTotal(row.parts_used)).toBe(100)
    expect(edit(row, { notes: 'Checked' })).toEqual({ notes: 'Checked' })
  })

  it('approved-cost card edited on Scope or Tyre Cost: no parts or labour column in the patch', () => {
    const approved = { ...imported, status: 'Completed', parts_cost: 100, custom_data: { cost_approved: true } }
    expect(edit(approved, { scope: 'Warranty' })).toEqual({ scope: 'Warranty' })
    expect(edit(approved, { tyre_cost: '250' })).toEqual({ tyre_cost: 250 })
  })

  it('status is not rewritten: stored "Open" stays when untouched, and "New" is the same status', () => {
    expect(edit(imported, { scope: 'External' })).not.toHaveProperty('status')
    expect(edit(imported, { status: 'New' })).toEqual({})
    expect(edit(imported, { status: 'In Progress' })).toEqual({ status: 'In Progress' })
  })

  it('never sends opened_at, created_by or total_cost on an untouched edit, and never blanks opened_at', () => {
    const p = edit(imported, { scope: 'External', opened_at: '' })
    expect(p).toEqual({ scope: 'External' })
  })

  it('a custom_data-only value is not promoted or rewritten', () => {
    expect(edit(imported, { priority: 'High' })).toEqual({ priority: 'High' })
  })

  it('user adds a part line to an imported card: cost rises by the line, the imported cost is kept', () => {
    const line = { part_name: 'Hose', quantity: 2, unit_cost: 10 }
    expect(edit(imported, { parts_used: [line] })).toEqual({ parts_used: [line], parts_cost: 1795.82 })
  })

  it('user adds and removes lines on a card whose cost equals its lines: cost is the new lines total', () => {
    const a = { part_name: 'Filter', quantity: 2, unit_cost: 50 }
    const b = { part_name: 'Belt', quantity: 1, unit_cost: 30 }
    const row = { ...imported, parts_cost: 100, parts_used: [a] }
    expect(edit(row, { parts_used: [a, b] })).toEqual({ parts_used: [a, b], parts_cost: 130 })
    expect(edit(row, { parts_used: [] })).toEqual({ parts_used: [], parts_cost: 0 })
  })

  it('removing lines never drives the cost below zero', () => {
    const a = { part_name: 'Filter', quantity: 2, unit_cost: 50 }
    expect(edit({ ...imported, parts_cost: 40, parts_used: [a] }, { parts_used: [] }).parts_cost).toBe(0)
  })

  it('labour hours changed: labour cost follows hours x rate', () => {
    expect(edit(imported, { labour_hours: '6' })).toEqual({ labour_hours: 6, labour_cost: 300 })
  })

  it('labour hours changed with no rate: the stored labour cost is left alone', () => {
    const row = { ...imported, labour_rate: null }
    expect(edit(row, { labour_hours: '6' })).toEqual({ labour_hours: 6 })
  })

  it('user types a labour cost override: only that is sent', () => {
    expect(edit(imported, { labour_cost: '400' })).toEqual({ labour_cost: 400 })
  })
})

describe('WorkOrders page uses the edit patch', () => {
  it('the update call sends the patch, never the full form payload', () => {
    expect(src).toMatch(/updateWorkOrderById\(editOrder\.id, patch\)/)
    expect(src).not.toMatch(/updateWorkOrderById\(editOrder\.id, payload\)/)
  })
  it('skips the write when nothing changed', () => {
    expect(src).toMatch(/if \(Object\.keys\(patch\)\.length > 0\)/)
  })
})
