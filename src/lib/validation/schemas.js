/**
 * Central zod schemas for Tyre Pulse forms.
 *
 * Each schema mirrors real columns from MASTER_MIGRATION.sql (tyre_records,
 * inspections, vehicle_fleet, purchase_orders) and encodes the same validation
 * vocabulary as the import pipeline (src/lib/import/validate.js): plausible
 * ISO dates (1970-2100), non-negative quantities/costs, and controlled
 * vocabularies from DB CHECK constraints.
 *
 * All field schemas are input-tolerant: they accept raw HTML form values
 * (strings) and coerce them, so they can back react-hook-form via
 * zodResolver (see src/components/ui/form/) or be used standalone through
 * the validate() helper.
 *
 * @module lib/validation/schemas
 */

import { z } from 'zod'

/* ── Controlled vocabularies (must match MASTER_MIGRATION.sql CHECKs) ──────── */

/** inspections.inspection_type CHECK list. */
export const INSPECTION_TYPES = ['Routine', 'Pressure Check', 'Visual', 'Full Inspection', 'Pre-Trip']

/** vehicle_fleet.status CHECK list (informational; status stays free text below). */
export const VEHICLE_STATUSES = ['Active', 'Inactive', 'Under Maintenance', 'Decommissioned']

/* ── Patterns ──────────────────────────────────────────────────────────────── */

/** Tyre serial: alphanumeric + dash, 3-32 chars. */
export const SERIAL_NO_RE = /^[A-Za-z0-9-]{3,32}$/

/** ISO 3779 VIN: 17 chars, excludes I/O/Q. */
export const VIN_RE = /^[A-HJ-NPR-Za-hj-npr-z0-9]{17}$/

/** Loose international phone: optional +, digits with spaces/dashes/parens, 7-20 chars. */
export const PHONE_RE = /^\+?[0-9][0-9\s\-().]{5,18}[0-9)]$/

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/* ── Coercion helpers (HTML inputs deliver strings; blanks mean "not set") ─── */

function blankToUndefined(v) {
  if (v == null) return undefined
  if (typeof v === 'string' && v.trim() === '') return undefined
  return v
}

/** Local-timezone YYYY-MM-DD (fleet data is captured in local operating time). */
function toLocalIso(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Same plausibility window as the import pipeline (1970-2100, real calendar date). */
function isPlausibleIsoDate(iso) {
  if (!ISO_DATE_RE.test(iso)) return false
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const year = d.getUTCFullYear()
  // Round-trip guard rejects impossible dates like 2024-02-31.
  return year >= 1970 && year <= 2100 && d.toISOString().slice(0, 10) === iso
}

/** Required trimmed string with a clean "is required" message on blank/missing. */
function requiredString(label, max = 120, { uppercase = false } = {}) {
  return z.preprocess(
    (v) => {
      if (v == null) return ''
      let s = typeof v === 'string' ? v.trim() : String(v).trim()
      if (uppercase) s = s.toUpperCase()
      return s
    },
    z
      .string()
      .min(1, `${label} is required`)
      .max(max, `${label} must be at most ${max} characters`)
  )
}

/** Optional trimmed string; blank input becomes undefined. */
function optionalString(label, max) {
  return z.preprocess(
    (v) => {
      const val = blankToUndefined(v)
      return typeof val === 'string' ? val.trim() : val
    },
    z.string().max(max, `${label} must be at most ${max} characters`).optional()
  )
}

/** Number that tolerates numeric strings; blank becomes undefined. */
function numberInput(label, inner) {
  return z.preprocess((v) => {
    const val = blankToUndefined(v)
    if (typeof val === 'string') {
      const n = Number(val.trim())
      return Number.isNaN(n) ? val : n
    }
    return val
  }, inner ?? z.number({ message: `${label} must be a number` }))
}

/**
 * ISO date field. Accepts Date instances or YYYY-MM-DD strings.
 *
 * @param {string} label
 * @param {{ required?: boolean, notFuture?: boolean }} [opts]
 */
function dateInput(label, { required = false, notFuture = false } = {}) {
  let inner = required ? z.string().min(1, `${label} is required`) : z.string()
  // Empty string only occurs in the required branch, where min(1) already
  // reports "is required" - the guards below skip it to avoid double messages.
  inner = inner.refine((iso) => iso === '' || isPlausibleIsoDate(iso), {
    message: `${label} must be a valid date (YYYY-MM-DD)`,
  })
  if (notFuture) {
    // ISO strings compare lexicographically; guard only valid dates.
    inner = inner.refine((iso) => !isPlausibleIsoDate(iso) || iso <= toLocalIso(new Date()), {
      message: `${label} cannot be in the future`,
    })
  }
  return z.preprocess((v) => {
    const val = blankToUndefined(v)
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? 'invalid-date' : toLocalIso(val)
    if (typeof val === 'string') return val.trim()
    return required && val == null ? '' : val
  }, required ? inner : inner.optional())
}

/* ── Schemas ───────────────────────────────────────────────────────────────── */

/** tyre_records: manual entry / edit form. */
export const tyreRecordSchema = z.object({
  asset_no: requiredString('Asset number', 60),
  serial_no: z.preprocess(
    (v) => {
      const val = blankToUndefined(v)
      return typeof val === 'string' ? val.trim() : val
    },
    z
      .string()
      .regex(SERIAL_NO_RE, 'Serial number must be 3-32 letters, digits or dashes')
      .optional()
  ),
  brand: optionalString('Brand', 60),
  position: optionalString('Position', 20),
  qty: numberInput(
    'Quantity',
    z
      .number({ message: 'Quantity must be a number' })
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1')
      .max(100, 'Quantity must be at most 100')
      .default(1)
  ),
  cost_per_tyre: numberInput(
    'Cost per tyre',
    z
      .number({ message: 'Cost per tyre must be a number' })
      .min(0, 'Cost per tyre cannot be negative')
      .max(100000, 'Cost per tyre must be at most 100,000')
      .optional()
  ),
  issue_date: dateInput('Issue date', { notFuture: true }),
  site: optionalString('Site', 60),
  country: optionalString('Country', 60),
})

/** inspections: schedule / capture form. */
export const inspectionSchema = z.object({
  asset_no: requiredString('Asset number', 60),
  inspection_type: z.preprocess(
    (v) => blankToUndefined(v),
    z
      .enum(INSPECTION_TYPES, {
        message: `Inspection type must be one of: ${INSPECTION_TYPES.join(', ')}`,
      })
      .default('Routine')
  ),
  scheduled_date: dateInput('Scheduled date', { required: true }),
  tread_depth: numberInput(
    'Tread depth',
    z
      .number({ message: 'Tread depth must be a number' })
      .min(0, 'Tread depth cannot be negative')
      .max(30, 'Tread depth must be at most 30 mm')
      .optional()
  ),
  pressure_reading: numberInput(
    'Pressure reading',
    z
      .number({ message: 'Pressure reading must be a number' })
      .min(0, 'Pressure reading cannot be negative')
      .max(200, 'Pressure reading must be at most 200 PSI')
      .optional()
  ),
  findings: optionalString('Findings', 2000),
})

/** vehicle_fleet: asset master form. */
export const vehicleSchema = z.object({
  asset_no: requiredString('Asset number', 60, { uppercase: true }),
  vin: z.preprocess(
    (v) => {
      const val = blankToUndefined(v)
      return typeof val === 'string' ? val.trim().toUpperCase() : val
    },
    z
      .string()
      .regex(VIN_RE, 'VIN must be 17 characters (letters/digits, excluding I, O, Q)')
      .optional()
  ),
  make: optionalString('Make', 60),
  model: optionalString('Model', 60),
  status: optionalString('Status', 40),
})

/** Suppliers / vendors master form. */
export const vendorSchema = z.object({
  name: requiredString('Vendor name', 120),
  email: z.preprocess(
    (v) => {
      const val = blankToUndefined(v)
      return typeof val === 'string' ? val.trim() : val
    },
    z.email({ message: 'Enter a valid email address' }).max(120).optional()
  ),
  phone: z.preprocess(
    (v) => {
      const val = blankToUndefined(v)
      return typeof val === 'string' ? val.trim() : val
    },
    z.string().regex(PHONE_RE, 'Enter a valid phone number (7-20 digits, may start with +)').optional()
  ),
})

/** purchase_orders: header form. */
export const purchaseOrderSchema = z.object({
  po_no: requiredString('PO number', 30),
  supplier: requiredString('Supplier', 100),
  total: numberInput(
    'Total',
    z.number({ message: 'Total must be a number' }).min(0, 'Total cannot be negative')
  ),
})

/* ── Standalone validation helper ──────────────────────────────────────────── */

/**
 * Validate values against a schema outside react-hook-form (imports, API
 * payload guards, tests).
 *
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} values
 * @returns {{ ok: true, data: T } | { ok: false, fieldErrors: Record<string, string> }}
 *   fieldErrors is keyed by dot-joined field path ('_form' for root issues),
 *   first message per field.
 */
export function validate(schema, values) {
  const result = schema.safeParse(values)
  if (result.success) return { ok: true, data: result.data }
  /** @type {Record<string, string>} */
  const fieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form'
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message
  }
  return { ok: false, fieldErrors }
}
