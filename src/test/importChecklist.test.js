import { describe, it, expect } from 'vitest'
import {
  buildTemplateFromRows, detectColumns, detectVehicleColumns, normalizeInterval, normalizeVehicleCode,
} from '../lib/checklist/importChecklist'
import { isFieldVisible } from '../lib/checklist/fieldTypes'

const ROWS = [
  ['Category', 'Sub Category', 'Date Interval', 'Recommended Inspect Hr', 'Recommended Inspect KM', 'Life Hrs', 'Life KM / Time', 'Symptoms', 'Requirement'],
  ['AIR SYSTEM', 'Air Compressor', 'Monthly Inspection', '500', '', '20000', 'Every 4 Years', 'Pressure - Leaks', 'Required spare'],
  ['AIR SYSTEM', 'Air Drier', 'Quarterly Inspection', '1500', '', '', '', 'Leaks - Pressure', 'Required spare'],
  ['AXLE', 'Front Hub Overhaul', '4 Years', '20000', '250000', '', '', '', 'Required spare'],
  ['BRAKE SYSTEM', 'Brake discs', 'Semi-anual Inspection', '3000', '30000', '', '', '', 'Required spare'],
  ['BRAKE SYSTEM', 'Brake Pads', 'Annual', '', '30000', '', '', '', 'Required spare'],
]

describe('importChecklist parser', () => {
  it('normalizes intervals', () => {
    expect(normalizeInterval('Monthly Inspection')).toBe('Monthly')
    expect(normalizeInterval('Quarterly Inspection')).toBe('Quarterly')
    expect(normalizeInterval('Semi-anual Inspection')).toBe('Semi-annual')
    expect(normalizeInterval('4 Years')).toBe('4-Yearly')
    expect(normalizeInterval('Annual')).toBe('Annual')
    expect(normalizeInterval('')).toBe('')
  })

  it('detects the header row and columns', () => {
    const d = detectColumns(ROWS)
    expect(d).not.toBeNull()
    expect(d.headerRow).toBe(0)
    expect(d.cols.category).toBe(0)
    expect(d.cols.subcategory).toBe(1)
    expect(d.cols.interval).toBe(2)
  })

  it('builds a template grouped by category with interval-driven visibility', () => {
    const { template, stats } = buildTemplateFromRows(ROWS, { name: 'Predictive Maintenance' })
    expect(template).toBeTruthy()
    expect(stats.items).toBe(5)
    expect(stats.categories).toBe(3)
    expect(stats.intervals).toEqual(expect.arrayContaining(['Monthly', 'Quarterly', 'Semi-annual', 'Annual', '4-Yearly']))

    // Header auto fields present + locked.
    const inspector = template.fields.find((f) => f.label === 'Inspector')
    expect(inspector.autoValue).toBe('current_user')
    expect(template.fields.find((f) => f.label === 'Date').autoValue).toBe('today')
    expect(template.fields.some((f) => f.label === 'KM meter (km)')).toBe(true)
    expect(template.fields.some((f) => f.label === 'Hour meter (hrs)')).toBe(true)
    expect(template.require_signature).toBe(true)
    expect(template.require_approval).toBe(true)

    // The interval selector drives visibility.
    const interval = template.fields.find((f) => f.label === 'Inspection interval')
    expect(interval.type).toBe('select')
    const airCompressor = template.fields.find((f) => f.label === 'Air Compressor')
    expect(airCompressor.allow_photo).toBe(true)
    expect(airCompressor.visibleWhen).toEqual({ field: interval.id, op: '=', value: 'Monthly' })

    // With "Monthly" selected, only monthly points are visible.
    const answers = { [interval.id]: 'Monthly' }
    expect(isFieldVisible(airCompressor, answers)).toBe(true)
    const brakePads = template.fields.find((f) => f.label === 'Brake Pads') // Annual
    expect(isFieldVisible(brakePads, answers)).toBe(false)
    expect(isFieldVisible(brakePads, { [interval.id]: 'Annual' })).toBe(true)
  })

  it('returns a clear error when no recognizable columns exist', () => {
    const { template, stats } = buildTemplateFromRows([['foo', 'bar'], ['1', '2']])
    expect(template).toBeNull()
    expect(stats.error).toMatch(/Category/i)
  })
})

// Rows carrying per-vehicle-type columns (MP / TM / BH): a non-empty cell means
// "this item applies to that vehicle type".
const VEHICLE_ROWS = [
  ['Category', 'Sub Category', 'Date Interval', 'MP', 'TM', 'BH', 'Symptoms'],
  ['CONCRETE PUMP PARTS', 'Wear Ring', 'Semi-anual Inspection', '3000', '', '', 'Clearence'],
  ['CHASSIS', 'Mixer Control unit', 'Quarterly', '', '1500', '', 'Function'],
  ['AXLE', 'Rear Axle', '4 Years', '20000', '20000', '20000', 'Oil Sample'],
]

describe('importChecklist vehicle-type filtering', () => {
  it('normalizes vehicle codes from codes and words', () => {
    expect(normalizeVehicleCode('MP123')).toBe('MP')
    expect(normalizeVehicleCode('concrete pump')).toBe('MP')
    expect(normalizeVehicleCode('Transit Mixer')).toBe('TM')
    expect(normalizeVehicleCode('BUS')).toBe('BH')
    expect(normalizeVehicleCode('pickup')).toBe('LP')
    expect(normalizeVehicleCode('')).toBeNull()
  })

  it('detects per-vehicle-type columns in the header', () => {
    const cols = detectVehicleColumns(VEHICLE_ROWS[0])
    expect(cols).toEqual({ MP: 3, TM: 4, BH: 5 })
  })

  it('scopes items to the vehicle types whose cell is filled', () => {
    const { template, stats } = buildTemplateFromRows(VEHICLE_ROWS)
    expect(stats.vehicleTypes).toEqual(expect.arrayContaining(['MP', 'TM', 'BH']))
    expect(stats.vehicleScopedItems).toBe(3)

    const interval = template.fields.find((f) => f.label === 'Inspection interval')
    const vehicle = template.fields.find((f) => f.label === 'Vehicle type')
    expect(vehicle).toBeTruthy()
    expect(vehicle.options).toEqual(expect.arrayContaining([
      'Concrete Pump (MP)', 'Transit Mixer (TM)', 'Bus / Heavy (BH)',
    ]))

    const wearRing = template.fields.find((f) => f.label === 'Wear Ring') // MP only, Semi-annual
    expect(Array.isArray(wearRing.visibleWhen)).toBe(true)
    expect(wearRing.visibleWhen).toHaveLength(2)

    // Visible only when BOTH the interval and a matching vehicle type are chosen.
    const mp = { [interval.id]: 'Semi-annual', [vehicle.id]: 'Concrete Pump (MP)' }
    expect(isFieldVisible(wearRing, mp)).toBe(true)
    const tm = { [interval.id]: 'Semi-annual', [vehicle.id]: 'Transit Mixer (TM)' }
    expect(isFieldVisible(wearRing, tm)).toBe(false)
    // Right vehicle but wrong interval → still hidden.
    expect(isFieldVisible(wearRing, { [interval.id]: 'Monthly', [vehicle.id]: 'Concrete Pump (MP)' })).toBe(false)

    // An all-vehicles item (every cell filled) shows for any listed vehicle type.
    const rearAxle = template.fields.find((f) => f.label === 'Rear Axle')
    expect(isFieldVisible(rearAxle, { [interval.id]: '4-Yearly', [vehicle.id]: 'Bus / Heavy (BH)' })).toBe(true)
  })

  it('omits the vehicle selector when no vehicle columns exist', () => {
    const { template, stats } = buildTemplateFromRows(ROWS)
    expect(stats.vehicleTypes).toEqual([])
    expect(template.fields.some((f) => f.label === 'Vehicle type')).toBe(false)
  })
})
