import { describe, it, expect } from 'vitest'
import {
  tyreRecordSchema, inspectionSchema, vehicleSchema, vendorSchema,
  purchaseOrderSchema, validate,
} from '../lib/validation'

describe('validation - tyreRecordSchema', () => {
  const good = {
    asset_no: 'TRK-100', serial_no: 'SN-2024-01', brand: 'Michelin',
    position: 'D1', qty: 2, cost_per_tyre: 1450, issue_date: '2026-01-15',
    site: 'RUH', country: 'KSA',
  }

  it('accepts a valid record', () => {
    expect(validate(tyreRecordSchema, good).ok).toBe(true)
  })

  it('rejects a future issue_date', () => {
    const r = validate(tyreRecordSchema, { ...good, issue_date: '2099-01-01' })
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fieldErrors)).toContain('issue_date')
  })

  it('rejects a malformed serial and out-of-range cost', () => {
    const r = validate(tyreRecordSchema, { ...good, serial_no: '!!', cost_per_tyre: -5 })
    expect(r.ok).toBe(false)
    expect(r.fieldErrors.serial_no).toBeTruthy()
    expect(r.fieldErrors.cost_per_tyre).toBeTruthy()
  })

  it('requires asset_no', () => {
    const r = validate(tyreRecordSchema, { ...good, asset_no: '  ' })
    expect(r.ok).toBe(false)
    expect(r.fieldErrors.asset_no).toBeTruthy()
  })
})

describe('validation - inspectionSchema', () => {
  const good = {
    asset_no: 'TRK-100', inspection_type: 'Routine', scheduled_date: '2026-07-01',
    tread_depth: 8.5, pressure_reading: 110, findings: 'ok',
  }

  it('accepts a valid inspection', () => {
    expect(validate(inspectionSchema, good).ok).toBe(true)
  })

  it('rejects out-of-range pressure and tread', () => {
    const r = validate(inspectionSchema, { ...good, pressure_reading: 999, tread_depth: 45 })
    expect(r.ok).toBe(false)
    expect(r.fieldErrors.pressure_reading).toBeTruthy()
    expect(r.fieldErrors.tread_depth).toBeTruthy()
  })

  it('rejects an unknown inspection_type', () => {
    const r = validate(inspectionSchema, { ...good, inspection_type: 'Casual Glance' })
    expect(r.ok).toBe(false)
    expect(r.fieldErrors.inspection_type).toBeTruthy()
  })
})

describe('validation - vehicleSchema (VIN ISO 3779)', () => {
  it('accepts a valid 17-char VIN without I/O/Q', () => {
    expect(validate(vehicleSchema, { asset_no: 'TRK-1', vin: '1HGCM82633A004352' }).ok).toBe(true)
  })

  it('rejects VINs containing I/O/Q or wrong length', () => {
    expect(validate(vehicleSchema, { asset_no: 'TRK-1', vin: '1HGCM82633A00435I' }).ok).toBe(false)
    expect(validate(vehicleSchema, { asset_no: 'TRK-1', vin: 'SHORT' }).ok).toBe(false)
  })
})

describe('validation - vendorSchema / purchaseOrderSchema', () => {
  it('vendor: valid email/phone pass, malformed fail', () => {
    expect(validate(vendorSchema, { name: 'Al Futtaim', email: 'x@y.com', phone: '+971 4 123 4567' }).ok).toBe(true)
    const bad = validate(vendorSchema, { name: 'V', email: 'not-an-email' })
    expect(bad.ok).toBe(false)
    expect(bad.fieldErrors.email).toBeTruthy()
  })

  it('purchase order: negative total rejected', () => {
    expect(validate(purchaseOrderSchema, { po_no: 'PO-1', supplier: 'ACME', total: 100 }).ok).toBe(true)
    const bad = validate(purchaseOrderSchema, { po_no: 'PO-1', supplier: 'ACME', total: -1 })
    expect(bad.ok).toBe(false)
    expect(bad.fieldErrors.total).toBeTruthy()
  })
})
