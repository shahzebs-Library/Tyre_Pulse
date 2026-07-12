import { describe, it, expect } from 'vitest'
import { buildPassport, serialOfRecord } from '../lib/tyrePassport'

describe('buildPassport', () => {
  it('returns null with no records', () => {
    expect(buildPassport([])).toBeNull()
    expect(buildPassport(null)).toBeNull()
  })

  it('resolves the serial across the three serial columns', () => {
    expect(serialOfRecord({ tyre_serial: ' T-9 ' })).toBe('T-9')
    expect(serialOfRecord({ serial_number: 'S2' })).toBe('S2')
  })

  it('collapses multiple records into one lifecycle with totals + CPK', () => {
    const p = buildPassport([
      { id: 2, serial_no: 'AA1', brand: 'Bridgestone', size: '11R22.5', asset_no: 'TM517', position: 'Drive', fitment_date: '2024-06-01', removal_date: '2025-01-01', total_km: 40000, cost_per_tyre: 1600, reason_for_removal: 'Worn', status: 'removed' },
      { id: 1, serial_no: 'AA1', brand: 'Bridgestone', asset_no: 'MP078', position: 'Steer', fitment_date: '2023-01-01', total_km: 60000, cost_per_tyre: 0 },
    ])
    expect(p.serial).toBe('AA1')
    expect(p.brand).toBe('Bridgestone')
    // events are chronological (2023 fitment first)
    expect(p.events[0].asset_no).toBe('MP078')
    expect(p.events[1].asset_no).toBe('TM517')
    expect(p.assets).toEqual(expect.arrayContaining(['MP078', 'TM517']))
    expect(p.totals.km).toBe(100000)
    expect(p.totals.cost).toBe(1600)
    // CPK = 1600 / 100000 = 0.016
    expect(p.totals.cpk).toBe(0.016)
    expect(p.recordCount).toBe(2)
  })

  it('derives km from fitment/removal odometer when total_km is absent', () => {
    const p = buildPassport([
      { id: 1, serial_no: 'B2', km_at_fitment: 10000, km_at_removal: 55000, removal_date: '2025-03-01' },
    ])
    expect(p.events[0].km).toBe(45000)
    expect(p.totals.km).toBe(45000)
  })
})
