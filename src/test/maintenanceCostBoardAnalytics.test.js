import { describe, it, expect } from 'vitest'
import {
  buildDetailRows, detailSiteOptions, filterDetails, detailTypeCounts, boardInsights,
} from '../lib/maintenanceCostBoardAnalytics'

const snap = {
  kpis: { job_cards: 200, line_items: 1000, tyre_lines: 150, open_jobs: 20 },
  top_tasks: [{ label: 'Brake pads', n: 40 }, { label: '', n: 5 }],
  top_actions: [{ label: 'Replace', n: 12 }],
  by_work_type: [{ label: 'Repair', spend: 700 }, { label: 'Service', spend: 300 }],
  spend_by_site: [{ label: 'NHC', jobs: 50, spend: 600 }, { label: 'JED', jobs: 10, spend: 200 }],
  spend_by_asset: [{ label: 'TM1', spend: 90 }],
}

describe('maintenanceCostBoardAnalytics', () => {
  it('flattens every breakdown and keeps missing numbers null', () => {
    const rows = buildDetailRows(snap)
    expect(rows).toHaveLength(8)
    const counts = detailTypeCounts(rows)
    expect(counts).toEqual({ task: 2, action: 1, work_type: 2, site: 2, asset: 1 })
    const task = rows.find((r) => r.type === 'task' && r.name === 'Brake pads')
    expect(task.spend).toBeNull()
    expect(task.jobs).toBeNull()
    expect(rows.find((r) => r.type === 'task' && r.occurrences === 5).name).toBe('Not recorded')
  })

  it('computes share of spend within each type', () => {
    const rows = buildDetailRows(snap)
    expect(rows.find((r) => r.name === 'NHC').sharePct).toBe(75)
    expect(rows.find((r) => r.name === 'Repair').sharePct).toBe(70)
    expect(rows.find((r) => r.name === 'TM1').sharePct).toBe(100)
  })

  it('returns an empty register for a failed snapshot', () => {
    expect(buildDetailRows(null)).toEqual([])
    expect(buildDetailRows({ ok: false })).toEqual([])
  })

  it('filters by search, type and site', () => {
    const rows = buildDetailRows(snap)
    expect(detailSiteOptions(rows)).toEqual(['JED', 'NHC'])
    expect(filterDetails(rows, { q: 'brake' })).toHaveLength(1)
    expect(filterDetails(rows, { rowType: 'site' })).toHaveLength(2)
    expect(filterDetails(rows, { site: 'JED' })).toHaveLength(1)
    expect(filterDetails(rows, { q: 'corrective' }).map((r) => r.name)).toEqual(['Replace'])
  })

  it('derives honest insights', () => {
    const i = boardInsights(snap)
    expect(i.repairSharePct).toBe(70)
    expect(i.tyreLineSharePct).toBe(15)
    expect(i.topSite).toBe('NHC')
    expect(i.topSiteSharePct).toBe(75)
    expect(i.openJobSharePct).toBe(10)
    const none = boardInsights({ kpis: {}, by_work_type: [], spend_by_site: [] })
    expect(none).toEqual({ repairSharePct: null, tyreLineSharePct: null, topSite: null, topSiteSharePct: null, openJobSharePct: null })
  })
})
