import { describe, it, expect } from 'vitest'
import {
  supplierSchema,
  driverSchema,
  vehicleSchema,
  tyreRecordSchema,
  inspectionSchema,
  supplierContractSchema,
  tyreRecordFormSchema,
  contractFormSchema,
  isPlausibleIsoDate,
  TYRE_SIZE_RE,
  PRESSURE_PSI,
  TREAD_DEPTH_MM,
} from '../lib/validation/schemas.js'

const issuesOf = (result) => (result.success ? [] : result.error.issues)
const pathsOf = (result) => issuesOf(result).map((i) => i.path.join('.'))

describe('validation schemas - shared rules', () => {
  it('isPlausibleIsoDate accepts real ISO dates in the 1970-2100 window', () => {
    expect(isPlausibleIsoDate('2024-06-15')).toBe(true)
    expect(isPlausibleIsoDate('1970-01-01')).toBe(true)
    expect(isPlausibleIsoDate('2100-12-31')).toBe(true)
  })

  it('isPlausibleIsoDate rejects garbage, impossible and out-of-window dates', () => {
    expect(isPlausibleIsoDate('15/06/2024')).toBe(false)
    expect(isPlausibleIsoDate('2024-13-40')).toBe(false)
    expect(isPlausibleIsoDate('1899-01-01')).toBe(false)
    expect(isPlausibleIsoDate('2200-01-01')).toBe(false)
    expect(isPlausibleIsoDate('')).toBe(false)
    expect(isPlausibleIsoDate(null)).toBe(false)
  })

  it('TYRE_SIZE_RE matches common truck sizes and rejects noise', () => {
    expect(TYRE_SIZE_RE.test('315/80R22.5')).toBe(true)
    expect(TYRE_SIZE_RE.test('385/65 R 22.5')).toBe(true)
    expect(TYRE_SIZE_RE.test('12R22.5')).toBe(true)
    expect(TYRE_SIZE_RE.test('445/95R25')).toBe(true)
    expect(TYRE_SIZE_RE.test('MICHELIN XZY')).toBe(false)
    expect(TYRE_SIZE_RE.test('315-80-22.5')).toBe(false)
  })
})

describe('supplierSchema', () => {
  const valid = { country: 'KSA', supplier_name: 'Al Dobowi Tyres', email: 'sales@dobowi.com' }

  it('accepts a valid supplier', () => {
    expect(supplierSchema.safeParse(valid).success).toBe(true)
  })

  it('requires the natural-key fields (country + supplier_name)', () => {
    const res = supplierSchema.safeParse({ supplier_name: '', country: '  ' })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toContain('country')
    expect(pathsOf(res)).toContain('supplier_name')
  })

  it('rejects malformed emails but allows blank/null', () => {
    expect(supplierSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
    expect(supplierSchema.safeParse({ ...valid, email: '' }).success).toBe(true)
    expect(supplierSchema.safeParse({ ...valid, email: null }).success).toBe(true)
  })

  it('bounds the rating to 0-5', () => {
    expect(supplierSchema.safeParse({ ...valid, rating: 6 }).success).toBe(false)
    expect(supplierSchema.safeParse({ ...valid, rating: 4 }).success).toBe(true)
  })
})

describe('driverSchema', () => {
  const valid = { country: 'UAE', driver_id: 'DRV-102', driver_name: 'Ahmed Khan' }

  it('accepts a valid driver', () => {
    expect(driverSchema.safeParse(valid).success).toBe(true)
  })

  it('requires country + driver_id + driver_name (natural key)', () => {
    const res = driverSchema.safeParse({})
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toEqual(expect.arrayContaining(['country', 'driver_id', 'driver_name']))
  })

  it('validates license expiry as a plausible date when present', () => {
    expect(driverSchema.safeParse({ ...valid, license_expiry: '2026-03-01' }).success).toBe(true)
    expect(driverSchema.safeParse({ ...valid, license_expiry: 'next year' }).success).toBe(false)
    expect(driverSchema.safeParse({ ...valid, license_expiry: '' }).success).toBe(true)
  })
})

describe('vehicleSchema', () => {
  const valid = { country: 'KSA', asset_no: 'TRK-8801' }

  it('accepts a valid vehicle and requires country + asset_no', () => {
    expect(vehicleSchema.safeParse(valid).success).toBe(true)
    const res = vehicleSchema.safeParse({ make: 'Volvo' })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toEqual(expect.arrayContaining(['country', 'asset_no']))
  })

  it('rejects negative mileage and accepts zero', () => {
    expect(vehicleSchema.safeParse({ ...valid, current_km: -1 }).success).toBe(false)
    expect(vehicleSchema.safeParse({ ...valid, current_km: 0 }).success).toBe(true)
    expect(vehicleSchema.safeParse({ ...valid, current_km: 254000 }).success).toBe(true)
  })

  it('validates the tyre size format when present', () => {
    expect(vehicleSchema.safeParse({ ...valid, tyre_size: '315/80R22.5' }).success).toBe(true)
    expect(vehicleSchema.safeParse({ ...valid, tyre_size: 'big tyre' }).success).toBe(false)
    expect(vehicleSchema.safeParse({ ...valid, tyre_size: '' }).success).toBe(true)
  })
})

describe('tyreRecordSchema', () => {
  const valid = {
    country: 'KSA', asset_no: 'TRK-8801', serial_no: 'SN12345',
    issue_date: '2024-06-15', qty: 2, cost_per_tyre: 1450,
    km_at_fitment: 120000, km_at_removal: 210000, risk_level: 'Low',
  }

  it('accepts a valid record', () => {
    expect(tyreRecordSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects removal km before fitment km (lifecycle rule)', () => {
    const res = tyreRecordSchema.safeParse({ ...valid, km_at_fitment: 210000, km_at_removal: 120000 })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toContain('km_at_removal')
  })

  it('rejects negative cost/km values and non-positive qty', () => {
    expect(tyreRecordSchema.safeParse({ ...valid, cost_per_tyre: -100 }).success).toBe(false)
    expect(tyreRecordSchema.safeParse({ ...valid, km_at_fitment: -5 }).success).toBe(false)
    expect(tyreRecordSchema.safeParse({ ...valid, qty: 0 }).success).toBe(false)
    expect(tyreRecordSchema.safeParse({ ...valid, qty: 1.5 }).success).toBe(false)
  })

  it('constrains risk_level to the known scale (blank allowed)', () => {
    expect(tyreRecordSchema.safeParse({ ...valid, risk_level: 'Extreme' }).success).toBe(false)
    expect(tyreRecordSchema.safeParse({ ...valid, risk_level: '' }).success).toBe(true)
  })

  it('rejects an implausible issue date', () => {
    expect(tyreRecordSchema.safeParse({ ...valid, issue_date: '15-06-2024' }).success).toBe(false)
  })
})

describe('inspectionSchema', () => {
  const valid = { country: 'KSA', asset_no: 'TRK-8801', inspection_date: '2024-07-01' }

  it('accepts a valid inspection and requires its natural-key parts', () => {
    expect(inspectionSchema.safeParse(valid).success).toBe(true)
    const res = inspectionSchema.safeParse({ inspector: 'F. Hassan' })
    expect(pathsOf(res)).toEqual(expect.arrayContaining(['country', 'asset_no', 'inspection_date']))
  })

  it(`bounds pressure to ${PRESSURE_PSI.min}-${PRESSURE_PSI.max} PSI`, () => {
    expect(inspectionSchema.safeParse({ ...valid, pressure_reading: 120 }).success).toBe(true)
    expect(inspectionSchema.safeParse({ ...valid, pressure_reading: PRESSURE_PSI.max + 1 }).success).toBe(false)
    expect(inspectionSchema.safeParse({ ...valid, pressure_reading: PRESSURE_PSI.min - 1 }).success).toBe(false)
    expect(inspectionSchema.safeParse({ ...valid, pressure_reading: null }).success).toBe(true)
  })

  it(`bounds tread depth to ${TREAD_DEPTH_MM.min}-${TREAD_DEPTH_MM.max} mm`, () => {
    expect(inspectionSchema.safeParse({ ...valid, tread_depth: 14.5 }).success).toBe(true)
    expect(inspectionSchema.safeParse({ ...valid, tread_depth: -1 }).success).toBe(false)
    expect(inspectionSchema.safeParse({ ...valid, tread_depth: 45 }).success).toBe(false)
  })

  it('constrains status to the known workflow values', () => {
    expect(inspectionSchema.safeParse({ ...valid, status: 'Done' }).success).toBe(true)
    expect(inspectionSchema.safeParse({ ...valid, status: 'Finished' }).success).toBe(false)
  })
})

describe('supplierContractSchema', () => {
  const valid = {
    supplier_name: 'Bridgestone MEA', contract_start: '2024-01-01',
    contract_end: '2025-01-01', price_per_unit: 1500, min_order: 50,
  }

  it('accepts a valid contract', () => {
    expect(supplierContractSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an end date before the start date', () => {
    const res = supplierContractSchema.safeParse({ ...valid, contract_end: '2023-12-31' })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toContain('contract_end')
  })

  it('rejects negative price and non-integer minimum order', () => {
    expect(supplierContractSchema.safeParse({ ...valid, price_per_unit: -1 }).success).toBe(false)
    expect(supplierContractSchema.safeParse({ ...valid, min_order: 2.5 }).success).toBe(false)
  })
})

describe('tyreRecordFormSchema (raw form values - no transforms)', () => {
  const validForm = {
    sr: '', issue_date: '2024-06-15', description: '', brand: 'Michelin', serial_no: 'SN1',
    qty: '2', job_card: '', mis_number: '', asset_no: 'TRK-8801', site: 'Riyadh',
    country: 'KSA', remarks: '', cost_per_tyre: '1450', risk_level: 'Low', category: '',
    km_at_fitment: '120000', km_at_removal: '210000',
  }

  it('accepts a valid form and returns values unchanged (payload-safe)', () => {
    const res = tyreRecordFormSchema.safeParse(validForm)
    expect(res.success).toBe(true)
    expect(res.data).toEqual(validForm)
  })

  it('accepts numeric defaults loaded from an existing record', () => {
    const res = tyreRecordFormSchema.safeParse({ ...validForm, qty: 2, cost_per_tyre: 1450, km_at_fitment: 120000, km_at_removal: 210000 })
    expect(res.success).toBe(true)
    expect(res.data.qty).toBe(2)
  })

  it('requires asset_no and country, allows everything else blank', () => {
    const blank = { ...validForm, issue_date: '', qty: '', cost_per_tyre: '', km_at_fitment: '', km_at_removal: '', brand: '', serial_no: '', site: '' }
    expect(tyreRecordFormSchema.safeParse(blank).success).toBe(true)
    const res = tyreRecordFormSchema.safeParse({ ...blank, asset_no: '  ', country: '' })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toEqual(expect.arrayContaining(['asset_no', 'country']))
  })

  it('rejects non-numeric, negative, or lifecycle-violating km strings', () => {
    expect(tyreRecordFormSchema.safeParse({ ...validForm, km_at_fitment: 'abc' }).success).toBe(false)
    expect(tyreRecordFormSchema.safeParse({ ...validForm, cost_per_tyre: '-10' }).success).toBe(false)
    const res = tyreRecordFormSchema.safeParse({ ...validForm, km_at_fitment: '210000', km_at_removal: '120000' })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toContain('km_at_removal')
  })

  it('rejects fractional or zero quantity strings', () => {
    expect(tyreRecordFormSchema.safeParse({ ...validForm, qty: '0' }).success).toBe(false)
    expect(tyreRecordFormSchema.safeParse({ ...validForm, qty: '1.5' }).success).toBe(false)
  })
})

describe('contractFormSchema (raw form values - no transforms)', () => {
  const validForm = {
    supplier_name: 'Bridgestone MEA', contract_start: '2024-01-01', contract_end: '2025-01-01',
    payment_terms: 'Net 30', price_per_unit: '1500', min_order: '50', notes: '',
  }

  it('accepts a valid form and returns values unchanged (payload-safe)', () => {
    const res = contractFormSchema.safeParse(validForm)
    expect(res.success).toBe(true)
    expect(res.data).toEqual(validForm)
  })

  it('accepts numeric defaults loaded from an existing contract row', () => {
    expect(contractFormSchema.safeParse({ ...validForm, price_per_unit: 1500, min_order: 50 }).success).toBe(true)
  })

  it('requires supplier_name and rejects end-before-start', () => {
    expect(contractFormSchema.safeParse({ ...validForm, supplier_name: '   ' }).success).toBe(false)
    const res = contractFormSchema.safeParse({ ...validForm, contract_end: '2023-06-01' })
    expect(res.success).toBe(false)
    expect(pathsOf(res)).toContain('contract_end')
  })

  it('rejects invalid dates and negative numeric strings', () => {
    expect(contractFormSchema.safeParse({ ...validForm, contract_start: '01/01/2024' }).success).toBe(false)
    expect(contractFormSchema.safeParse({ ...validForm, price_per_unit: '-5' }).success).toBe(false)
    expect(contractFormSchema.safeParse({ ...validForm, min_order: '2.5' }).success).toBe(false)
  })
})
