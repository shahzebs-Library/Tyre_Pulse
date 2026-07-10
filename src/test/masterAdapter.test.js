import { describe, it, expect } from 'vitest'
import { suggestMapping } from '../lib/import/mapping.js'
import { exactAlias, MODULE_FIELDS, MODULE_TABLES } from '../lib/import/synonyms.js'
import { transformRow, validateRow, classifyDuplicates, naturalKey } from '../lib/import/index.js'

/** Build a one-shot transformed row for a module from a flat raw object. */
function tx(raw, module) {
  const mapping = Object.keys(raw).map((h) => ({ sourceHeader: h, target: h, action: 'mapped', confidence: 100 }))
  return transformRow(raw, mapping, { module }).transformed
}

describe('supplier adapter', () => {
  it('maps EN + Arabic headers to canonical fields', () => {
    expect(exactAlias('Vendor Name', 'supplier')).toBe('supplier_name')
    expect(exactAlias('المورد', 'supplier')).toBe('supplier_name')
    expect(exactAlias('Supplier Code', 'supplier')).toBe('supplier_code')
    const plan = suggestMapping({ columns: ['Vendor Name', 'Supplier Code'], module: 'supplier' })
    expect(plan.find((p) => p.sourceHeader === 'Vendor Name').target).toBe('supplier_name')
    expect(plan.every((p) => p.action === 'auto')).toBe(true)
  })

  it('targets the suppliers table', () => {
    expect(MODULE_TABLES.supplier).toBe('suppliers')
    expect(MODULE_FIELDS.supplier.find((f) => f.key === 'supplier_name').required).toBe(true)
  })

  it('flags a missing required supplier_name as error', () => {
    const v = validateRow(tx({ supplier_code: 'V-1' }, 'supplier'), 'supplier')
    expect(v.status).toBe('error')
    expect(v.issues.some((i) => i.code === 'REQUIRED_MISSING')).toBe(true)
  })

  it('dedups by code (preferred) then name; country-scoped', () => {
    const rows = [
      { country: 'KSA', supplier_code: 'BR01', supplier_name: 'Bridgestone' },
      { country: 'KSA', supplier_code: 'BR01', supplier_name: 'Bridge Stone' },
      { country: 'UAE', supplier_code: 'BR01', supplier_name: 'Bridgestone' },
    ]
    const out = classifyDuplicates(rows, 'supplier')
    expect(out[0].dup_status).toBe('none')     // keeper (first of the code+country)
    expect(out[1].dup_status).not.toBe('none') // same code+country repeats (name disagrees)
    expect(out[2].dup_status).toBe('none')     // different country
  })

  it('falls back to name when code is blank', () => {
    const a = naturalKey({ country: 'KSA', supplier_name: 'Michelin' }, 'supplier')
    const b = naturalKey({ country: 'KSA', supplier_code: '', supplier_name: 'Michelin' }, 'supplier')
    expect(a).toBe(b)
    expect(a).not.toBeNull()
  })
})

describe('driver adapter', () => {
  it('maps EN + Arabic headers to canonical fields', () => {
    expect(exactAlias('Employee ID', 'driver')).toBe('driver_id')
    expect(exactAlias('رقم السائق', 'driver')).toBe('driver_id')
    expect(exactAlias('Driver Name', 'driver')).toBe('driver_name')
    expect(exactAlias('License No', 'driver')).toBe('license_no')
  })

  it('targets the drivers table', () => {
    expect(MODULE_TABLES.driver).toBe('drivers')
    expect(MODULE_FIELDS.driver.find((f) => f.key === 'driver_id').required).toBe(true)
    expect(MODULE_FIELDS.driver.find((f) => f.key === 'driver_name').required).toBe(true)
  })

  it('flags missing required driver_id / driver_name as error', () => {
    expect(validateRow(tx({ driver_name: 'Ahmed' }, 'driver'), 'driver').status).toBe('error')
    expect(validateRow(tx({ driver_id: 'D-1' }, 'driver'), 'driver').status).toBe('error')
    expect(validateRow(tx({ driver_id: 'D-1', driver_name: 'Ahmed' }, 'driver'), 'driver').status).toBe('ready')
  })

  it('dedups by driver_id within a country', () => {
    const rows = [
      { country: 'KSA', driver_id: 'EMP100', driver_name: 'Ahmed' },
      { country: 'KSA', driver_id: 'EMP100', driver_name: 'Ahmad' }, // conflict on name
      { country: 'UAE', driver_id: 'EMP100', driver_name: 'Ahmed' },
    ]
    const out = classifyDuplicates(rows, 'driver')
    expect(out[0].dup_status).toBe('none')     // keeper (first of the driver_id+country)
    expect(out[1].dup_status).toBe('conflict') // driver_name in CONFLICT_FIELDS disagrees
    expect(out[2].dup_status).toBe('none')     // different country
  })
})
