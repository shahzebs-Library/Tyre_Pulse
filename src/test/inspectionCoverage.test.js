import { describe, it, expect } from 'vitest'
import {
  isCompletedInspection, tyreManVehicleTypeSummary, tyreManVehicleTypeTable,
} from '../lib/inspectionCoverage'

const ROWS = [
  { inspector: 'Ali',   vehicle_type: 'Transit Mixer', status: 'Done', completed_date: '2026-09-12' },
  { inspector: 'Ali',   vehicle_type: 'Transit Mixer', status: 'Done', completed_date: '2026-09-12' },
  { inspector: 'Ali',   vehicle_type: 'Pickup',        status: 'Done', completed_date: '2026-09-12' },
  { inspector: 'Omar',  vehicle_type: 'Transit Mixer', status: 'Done', completed_date: '2026-09-12' },
  // Still open - must not count as completed.
  { inspector: 'Omar',  vehicle_type: 'Pickup',        status: 'In Progress' },
  // Blank inspector/vehicle type - reported honestly, never dropped.
  { inspector: '   ',   vehicle_type: '',               status: 'Done', completed_date: '2026-09-12' },
]

describe('isCompletedInspection', () => {
  it('counts a completed_date or Done status as done', () => {
    expect(isCompletedInspection({ completed_date: '2026-09-12' })).toBe(true)
    expect(isCompletedInspection({ status: 'Done' })).toBe(true)
    expect(isCompletedInspection({ status: 'In Progress' })).toBe(false)
    expect(isCompletedInspection({})).toBe(false)
  })
})

describe('tyreManVehicleTypeSummary', () => {
  it('groups completed inspections by inspector and vehicle type', () => {
    const s = tyreManVehicleTypeSummary(ROWS)
    expect(s.grandTotal).toBe(5) // the open Omar/Pickup row is excluded
    expect(s.totalInspections).toBe(6)
    expect(s.vehicleTypes).toEqual(['Transit Mixer', 'Pickup', 'Unspecified'].sort())

    const ali = s.rows.find((r) => r.inspector === 'Ali')
    expect(ali.total).toBe(3)
    expect(ali.byType['Transit Mixer']).toBe(2)
    expect(ali.byType.Pickup).toBe(1)

    const omar = s.rows.find((r) => r.inspector === 'Omar')
    expect(omar.total).toBe(1)
    expect(omar.byType['Transit Mixer']).toBe(1)
    expect(omar.byType.Pickup).toBeUndefined() // open, not completed
  })

  it('never invents an inspector or vehicle type - blanks are labelled honestly', () => {
    const s = tyreManVehicleTypeSummary(ROWS)
    expect(s.rows.some((r) => r.inspector === 'Unassigned')).toBe(true)
    expect(s.vehicleTypes).toContain('Unspecified')
  })

  it('sorts busiest tyre man first, then alphabetically', () => {
    const s = tyreManVehicleTypeSummary(ROWS)
    expect(s.rows[0].inspector).toBe('Ali')
  })

  it('reports zero, not nothing, when no inspections are completed', () => {
    const s = tyreManVehicleTypeSummary([{ inspector: 'Ali', vehicle_type: 'Pickup', status: 'Scheduled' }])
    expect(s.grandTotal).toBe(0)
    expect(s.rows).toEqual([])
    expect(s.vehicleTypes).toEqual([])
  })

  it('degrades on junk input instead of throwing', () => {
    expect(tyreManVehicleTypeSummary(null).grandTotal).toBe(0)
    expect(tyreManVehicleTypeSummary(undefined).rows).toEqual([])
  })
})

describe('tyreManVehicleTypeTable', () => {
  it('flattens the pivot into export-ready rows with a totals row', () => {
    const t = tyreManVehicleTypeTable(tyreManVehicleTypeSummary(ROWS))
    expect(t.columns[0]).toBe('inspector')
    expect(t.columns[t.columns.length - 1]).toBe('total')
    expect(t.headers[0]).toBe('Tyre Man')
    expect(t.headers[t.headers.length - 1]).toBe('Total Completed')

    const ali = t.rows.find((r) => r.inspector === 'Ali')
    expect(ali.total).toBe(3)

    const totals = t.rows[t.rows.length - 1]
    expect(totals.inspector).toBe('All Tyre Men')
    expect(totals.total).toBe(5)
  })

  it('still emits a totals row of zero when nobody has completed anything', () => {
    const t = tyreManVehicleTypeTable(tyreManVehicleTypeSummary([]))
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toMatchObject({ inspector: 'All Tyre Men', total: 0 })
  })
})
