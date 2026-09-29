import { describe, it, expect } from 'vitest'
import { tagEventRows, filterTagEvents, tagEventExportRows, eventTarget } from '../lib/rfidRegistryView'

const events = [
  { id: 'a', tag_row_id: 't1', tag_id: 'E200', action: 'registered', to_status: 'unassigned', to_site: 'NHC', created_at: '2026-09-01T08:00:00Z' },
  { id: 'b', tag_row_id: 't1', tag_id: 'E200', action: 'assigned', from_asset_no: null, to_asset_no: 'TM514', actor_name: 'Ops', created_at: '2026-09-02T08:00:00Z' },
  { id: 'c', tag_row_id: 't1', tag_id: 'E200', action: 'reassigned', from_asset_no: 'TM514', to_tyre_serial: 'SN1', created_at: '2026-09-03T08:00:00Z' },
  { id: 'd', tag_row_id: 't2', tag_id: 'E300', action: 'retired', created_at: null },
]

describe('rfid tag history', () => {
  it('targets prefer asset, then tyre, and treat blanks as none', () => {
    expect(eventTarget(' TM1 ', 'S')).toEqual({ kind: 'asset', value: 'TM1' })
    expect(eventTarget('  ', 'S9')).toEqual({ kind: 'tyre', value: 'S9' })
    expect(eventTarget(null, '')).toBeNull()
  })
  it('shapes rows newest first with labels and honest nulls', () => {
    const rows = tagEventRows(events)
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd'])
    expect(rows[0]).toMatchObject({ actionLabel: 'Reassigned', from: 'TM514', to: 'SN1', by: null })
    expect(rows[1].by).toBe('Ops')
    expect(rows[3].ms).toBeNull()
  })
  it('filters by action and search', () => {
    const rows = tagEventRows(events)
    expect(filterTagEvents(rows, { action: 'retired' }).map((r) => r.id)).toEqual(['d'])
    expect(filterTagEvents(rows, { search: 'tm514' }).map((r) => r.id)).toEqual(['c', 'b'])
    expect(filterTagEvents(rows, { search: 'nhc' }).map((r) => r.id)).toEqual(['a'])
  })
  it('exports N/A for unknown values', () => {
    const out = tagEventExportRows(tagEventRows([events[3]]))
    expect(out[0]).toMatchObject({ tagId: 'E300', action: 'Retired', from: 'N/A', by: 'N/A', at: 'N/A' })
  })
})
