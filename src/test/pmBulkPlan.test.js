import { describe, it, expect } from 'vitest'
import { planPmFromTemplate, BULK_NOTE } from '../lib/pmBulkPlan'
import { PM_TEMPLATES } from '../lib/pmTemplates'

const gen = PM_TEMPLATES.find((t) => t.asset_category === 'generator')
const v = (o) => ({ asset_no: 'GN1', vehicle_type: 'GENERATOR', site: 'NHC', country: 'KSA', status: 'Active', ...o })

describe('planPmFromTemplate', () => {
  it('plans only active vehicles the template fits', () => {
    const out = planPmFromTemplate(gen, [v({}), v({ asset_no: 'TM1', vehicle_type: 'TR-MIXER' }), v({ asset_no: 'GN2', status: 'Inactive' })], { today: '2026-10-25' })
    expect(out.rows.map((r) => r.asset_no)).toEqual(['GN1'])
    expect(out.skippedNoFit).toBe(2)
  })
  it('first due date is one interval from today and says so', () => {
    const { rows } = planPmFromTemplate(gen, [v({})], { today: '2026-10-25' })
    expect(rows[0].next_due).toBe('2027-04-25')
    expect(rows[0].last_done).toBeNull()
    expect(rows[0].notes).toContain(BULK_NOTE)
  })
  it('never invents a meter due value', () => {
    const { rows } = planPmFromTemplate(gen, [v({})], { today: '2026-10-25' })
    expect(rows[0].next_due_meter).toBeUndefined()
  })
  it('skips an asset that already has the same active plan', () => {
    const existing = [{ asset_no: 'gn1', country: 'KSA', name: gen.label, status: 'active' }]
    const out = planPmFromTemplate(gen, [v({})], { today: '2026-10-25', existing })
    expect(out.rows).toHaveLength(0)
    expect(out.skippedExisting).toBe(1)
  })
  it('a paused or closed plan does not block a new one', () => {
    const existing = [{ asset_no: 'GN1', country: 'KSA', name: gen.label, status: 'paused' }]
    expect(planPmFromTemplate(gen, [v({})], { today: '2026-10-25', existing }).rows).toHaveLength(1)
  })
  it('the same asset code in another country is a different machine', () => {
    const existing = [{ asset_no: 'GN1', country: 'UAE', name: gen.label, status: 'active' }]
    expect(planPmFromTemplate(gen, [v({})], { today: '2026-10-25', existing }).rows).toHaveLength(1)
  })
})
