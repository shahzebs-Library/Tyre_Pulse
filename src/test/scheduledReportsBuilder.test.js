import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the templates service (its own CRUD is covered by
// accidentReportTemplates.api.test.js) so we exercise only the scheduling seam.
const h = vi.hoisted(() => ({ templates: [] }))
vi.mock('../lib/api/accidentReportTemplates', () => ({
  listTemplates: vi.fn(async () => h.templates),
  getTemplate: vi.fn(async (id) => h.templates.find((t) => t.id === id)),
}))
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

const sched = await import('../lib/api/scheduledReports')

beforeEach(() => { h.templates = [] })

describe('scheduledReports — custom Report Builder layouts', () => {
  it('recognises builder:<id> report types and round-trips the template id', () => {
    expect(sched.isBuilderType('builder:abc-123')).toBe(true)
    expect(sched.isBuilderType('executive')).toBe(false)
    expect(sched.isBuilderType(null)).toBe(false)
    expect(sched.builderReportType('abc-123')).toBe('builder:abc-123')
    expect(sched.builderTemplateId('builder:abc-123')).toBe('abc-123')
    expect(sched.builderTemplateId('claims')).toBeNull()
  })

  it('datasetFor maps builder types to the full accident projection', () => {
    const ds = sched.datasetFor('builder:xyz')
    expect(ds.table).toBe('accidents')
    expect(ds.dateCol).toBe('incident_date')
    expect(ds.cols.length).toBe(ds.headers.length)
    // must carry everything a builder layout can reference
    for (const col of ['claim_amount', 'recovered_amount', 'repair_cost', 'parts_cost', 'gcc_liability_ratio', 'fault_status', 'release_date']) {
      expect(ds.cols, col).toContain(col)
    }
    // built-in types unaffected
    expect(sched.datasetFor('executive').table).toBe('tyre_records')
    expect(sched.datasetFor('unknown').table).toBe('tyre_records')
  })

  it('listSchedulableLayouts exposes saved layouts as schedulable options', async () => {
    h.templates = [
      { id: 'a1', name: 'Board pack', config: { blocks: [] }, updated_at: '2026-07-01' },
      { id: 'b2', name: 'Insurer pack', config: { blocks: [] }, updated_at: '2026-07-02' },
    ]
    const opts = await sched.listSchedulableLayouts()
    expect(opts).toHaveLength(2)
    expect(opts[0]).toMatchObject({ value: 'builder:a1', label: 'Board pack', templateId: 'a1' })
    expect(sched.isBuilderType(opts[1].value)).toBe(true)
  })

  it('listSchedulableLayouts is empty (not an error) with no saved layouts', async () => {
    await expect(sched.listSchedulableLayouts()).resolves.toEqual([])
  })
})
