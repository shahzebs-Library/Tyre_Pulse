import { describe, it, expect } from 'vitest'
import { buildMyQueue, queueKpis, filterQueue, sortQueue, queueExportRows, daysUntil, isClosedWorkOrder } from '../lib/myQueueAnalytics'

const NOW = new Date('2026-09-26T10:00:00').getTime()
const src = {
  workOrders: [
    { id: 'w1', work_order_no: 'WO-1', asset_no: 'TM1', status: 'In Progress', target_completion: '2026-09-20', opened_at: '2026-09-01' },
    { id: 'w1', work_order_no: 'WO-1 dup', status: 'In Progress' },
    { id: 'w2', work_order_no: 'WO-2', status: 'Completed', target_completion: '2026-09-27' },
    { id: 'w3', work_order_no: 'WO-3', status: 'New', target_completion: '2026-09-28' },
  ],
  approvalInspections: [{ id: 'i1', asset_no: 'TM9', created_at: '2026-09-24T00:00:00Z' }],
  approvalChecklists: [{ id: 'c1', template_name: 'Daily', approval_status: 'pending_area_manager', submitted_at: '2026-09-25T00:00:00Z' }],
  checklistAssignments: [{ id: 'a1', template_name: 'Weekly', status: 'pending', due_date: '2026-10-10' }, { id: 'a2', status: 'completed' }],
  myInspections: [{ id: 'm1', document_no: 'INS-1', created_at: '2026-09-25T00:00:00Z' }],
  myChecklists: [],
}

describe('myQueueAnalytics', () => {
  it('builds the queue without duplicates or closed items', () => {
    const items = buildMyQueue(src, NOW)
    expect(items.filter(i => i.kind === 'work_order').map(i => i.title)).toEqual(['WO-1', 'WO-3'])
    expect(items.find(i => i.id === 'wo:w1').dueState).toBe('overdue')
    expect(items.find(i => i.id === 'wo:w3').dueState).toBe('due_soon')
    expect(items.find(i => i.kind === 'approval_checklist').status).toBe('Waiting for final sign-off')
    expect(items.some(i => i.id === 'cd:a2')).toBe(false)
  })
  it('reports unavailable sources as null, not zero', () => {
    const k = queueKpis(buildMyQueue(src, NOW), { workOrders: true, approvals: true })
    expect(k.openWork).toBeNull()
    expect(k.approvals).toBeNull()
    expect(k.overdue).toBe(1)
    expect(k.checklistsDue).toBe(1)
  })
  it('filters, sorts urgent first and exports', () => {
    const items = buildMyQueue(src, NOW)
    expect(filterQueue(items, { group: 'approval' })).toHaveLength(2)
    expect(filterQueue(items, { search: 'tm9' })).toHaveLength(1)
    expect(sortQueue(items)[0].id).toBe('wo:w1')
    expect(queueExportRows(items)[0]).toHaveProperty('due_state')
  })
  it('helpers', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil('2026-09-27', NOW)).toBe(1)
    expect(isClosedWorkOrder(' closed ')).toBe(true)
  })
})
