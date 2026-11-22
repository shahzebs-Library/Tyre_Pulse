import { describe, it, expect } from 'vitest'
import { buildBoardKpis } from '../lib/boardOverview'

describe('Board Overview open job cards', () => {
  it('reads zero open as 0 when the open-only read succeeded', () => {
    expect(buildBoardKpis({ workOrders: [], workOrdersKnown: true }).workOrdersOpen).toBe(0)
  })
  it('stays N/A when nothing was read', () => {
    expect(buildBoardKpis({ workOrders: [] }).workOrdersOpen).toBe(null)
  })
  it('still re-checks status, so a closed row that slipped through is not counted', () => {
    const k = buildBoardKpis({ workOrders: [{ status: 'In Progress' }, { status: 'CLOSED ' }], workOrdersKnown: true })
    expect(k.workOrdersOpen).toBe(1)
  })
})
