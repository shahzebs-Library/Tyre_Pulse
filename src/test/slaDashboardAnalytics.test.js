import { describe, expect, it } from 'vitest'
import {
  decorateSla, filterSla, slaKpis, complianceByType, breachesByOwner, attentionList,
  ownerOptions, activeSlaFilterCount, slaExportRows, fmtCountdown, EMPTY_SLA_FILTERS,
} from '../lib/slaDashboardAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, reference: 'WO-1', sla_type: 'work_order', priority: 'high', owner: 'RUH', started_at: '2026-09-20T00:00:00Z', due_at: '2026-09-21T00:00:00Z', resolved_at: '2026-09-20T10:00:00Z' },
  { id: 2, reference: 'WO-2', sla_type: 'work_order', priority: 'low', owner: 'RUH', due_at: '2026-09-26T00:00:00Z' },
  { id: 3, reference: 'BD-1', sla_type: 'breakdown', priority: 'critical', owner: '', target_hours: 24, due_at: '2026-09-27T14:00:00Z' },
  { id: 4, reference: 'DL-1', sla_type: 'delivery', priority: 'medium', owner: 'JED' },
]

describe('slaDashboardAnalytics', () => {
  it('decorates rows with derived status and openness', () => {
    const d = decorateSla(rows, NOW)
    expect(d.map((r) => r._status)).toEqual(['met', 'breached', 'at_risk', 'unknown'])
    expect(d.map((r) => r._open)).toEqual([false, true, true, false])
    expect(d[0]._resolution).toBe(10)
    expect(d[3]._statusLabel).toBe('No due date')
  })

  it('reports null compliance until something is decided', () => {
    const k = slaKpis(decorateSla(rows, NOW))
    expect(k).toMatchObject({ total: 4, met: 1, breached: 1, atRisk: 1, openBreached: 1, noDueDate: 1, decided: 2, complianceRate: 50 })
    expect(k.avgResolutionHours).toBe(10)
    const undecided = slaKpis(decorateSla([rows[2]], NOW))
    expect(undecided.complianceRate).toBeNull()
    expect(slaKpis([]).avgResolutionHours).toBeNull()
  })

  it('breaks down by type and owner with null rates for undecided groups', () => {
    const d = decorateSla(rows, NOW)
    const t = complianceByType(d)
    expect(t[0]).toMatchObject({ sla_type: 'work_order', breached: 1, complianceRate: 50 })
    expect(t.find((x) => x.sla_type === 'breakdown').complianceRate).toBeNull()
    expect(breachesByOwner(d)).toEqual([{ owner: 'RUH', met: 1, breached: 1, complianceRate: 50 }])
  })

  it('lists every breached and at-risk record, breached first', () => {
    expect(attentionList(decorateSla(rows, NOW)).map((r) => r.id)).toEqual([2, 3])
  })

  it('filters and exports', () => {
    const d = decorateSla(rows, NOW)
    expect(filterSla(d, { ...EMPTY_SLA_FILTERS, status: 'breached' }).map((r) => r.id)).toEqual([2])
    expect(filterSla(d, { ...EMPTY_SLA_FILTERS, owner: 'JED' }).map((r) => r.id)).toEqual([4])
    expect(filterSla(d, { ...EMPTY_SLA_FILTERS, search: 'breakdown' }).map((r) => r.id)).toEqual([3])
    expect(activeSlaFilterCount({ ...EMPTY_SLA_FILTERS, type: 'delivery', priority: 'low' })).toBe(2)
    expect(ownerOptions(rows)).toEqual(['JED', 'RUH'])
    const out = slaExportRows(d)
    expect(out[0]).toMatchObject({ status: 'Met', time_remaining: 'N/A', resolution_hours: 10, sla_type: 'Work Order' })
    expect(out[1].time_remaining).toBe('1d 12h overdue')
    expect(fmtCountdown(null)).toBe('N/A')
    expect(fmtCountdown(2)).toBe('2h left')
  })
})
