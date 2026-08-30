import { describe, expect, it } from 'vitest'
import { isOverdueWorkOrder, isTerminalWorkOrderStatus, normaliseWorkOrderStatus } from '../lib/dailyOpsPriority'

describe('Daily Operations priority queue', () => {
  it('normalises status variants from imported systems', () => {
    expect(normaliseWorkOrderStatus(' In Progress ')).toBe('in_progress')
    expect(isTerminalWorkOrderStatus('Closed')).toBe(true)
    expect(isTerminalWorkOrderStatus('COMPLETED')).toBe(true)
    expect(isTerminalWorkOrderStatus('Canceled')).toBe(true)
    expect(isTerminalWorkOrderStatus('Open')).toBe(false)
  })

  it('only marks active, scheduled work as overdue', () => {
    expect(isOverdueWorkOrder({ scheduled_date: '2026-08-01', status: 'Open' }, '2026-08-30')).toBe(true)
    expect(isOverdueWorkOrder({ scheduled_date: '2026-08-01', status: 'Closed' }, '2026-08-30')).toBe(false)
    expect(isOverdueWorkOrder({ scheduled_date: '2026-09-01', status: 'Open' }, '2026-08-30')).toBe(false)
    expect(isOverdueWorkOrder({ status: 'Open' }, '2026-08-30')).toBe(false)
  })
})
