import { describe, it, expect } from 'vitest'
import { filterEquipment, distinctValues } from '../lib/equipmentAnalytics'

const NOW = Date.UTC(2026, 8, 27)
const rows = [
  { id: 1, name: 'Torque wrench', equipment_type: 'Wrench', site: 'NHC', status: 'available', calibration_due: '2026-09-01' },
  { id: 2, name: 'Balancer', equipment_type: 'Balancer', site: 'JED', status: 'in_use', calibration_due: '2026-10-10' },
  { id: 3, name: 'Jack', equipment_type: 'Jack', site: 'NHC', status: 'retired', calibration_due: '2026-01-01' },
  { id: 4, name: 'Gauge', serial_no: 'SN-9', status: 'available' },
]

describe('equipmentAnalytics.filterEquipment', () => {
  it('filters by calibration state using the shared rule', () => {
    expect(filterEquipment(rows, { calibration: 'overdue' }, NOW).map((r) => r.id)).toEqual([1])
    expect(filterEquipment(rows, { calibration: 'due_soon' }, NOW).map((r) => r.id)).toEqual([2])
    // retired and undated items are 'none', never overdue
    expect(filterEquipment(rows, { calibration: 'none' }, NOW).map((r) => r.id)).toEqual([3, 4])
  })
  it('filters by status, type, site and search', () => {
    expect(filterEquipment(rows, { status: 'available', site: 'NHC' }, NOW).map((r) => r.id)).toEqual([1])
    expect(filterEquipment(rows, { type: 'Jack' }, NOW).map((r) => r.id)).toEqual([3])
    expect(filterEquipment(rows, { search: 'sn-9', status: 'all' }, NOW).map((r) => r.id)).toEqual([4])
  })
  it('lists distinct sites', () => {
    expect(distinctValues(rows, 'site')).toEqual(['JED', 'NHC'])
  })
})
