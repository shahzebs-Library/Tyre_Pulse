import { describe, expect, it } from 'vitest'
import { actionFromStock, operationalSourceKey, buildOperationalAction } from '../lib/operationalActions'

describe('cross-module operational actions', () => {
  it('builds a stable idempotency source', () => {
    expect(operationalSourceKey('work_order', 'wo 42', 'parts_shortage')).toBe('auto:work_order:wo_42:parts_shortage')
  })
  it('rejects unknown producers and events', () => {
    expect(() => operationalSourceKey('invoice', '1', 'late')).toThrow()
    expect(() => operationalSourceKey('stock', '1', 'deleted')).toThrow()
  })
  it('maps an out-of-stock event to an urgent replenishment action', () => {
    const action = actionFromStock({ id: 's1', description: '315/80R22.5', site: 'Riyadh' }, 'out_of_stock')
    expect(action).toMatchObject({ source: 'auto:stock:s1:out_of_stock', severity: 'critical', category: 'cost' })
  })
  it('requires a human-readable title', () => {
    expect(() => buildOperationalAction({ type: 'stock', sourceId: '1', event: 'low_stock' })).toThrow('title')
  })
})
