/**
 * Domain validation schemas (Zod) for TyrePulse entities.
 *
 * Two families are exported:
 *
 * 1. ENTITY schemas (`supplierSchema`, `driverSchema`, `vehicleSchema`,
 *    `tyreRecordSchema`, `inspectionSchema`, `supplierContractSchema`) -
 *    validate TYPED payloads (numbers as numbers, ISO dates as strings).
 *    Rules mirror src/lib/import/validate.js: natural-key fields required
 *    (country + code), plausible dates (1970-2100), non-negative quantities,
 *    removal km never before fitment km.
 *
 * 2. FORM schemas (`tyreRecordFormSchema`, `contractFormSchema`) - validate
 *    the RAW STRING values held by react-hook-form inputs WITHOUT transforming
 *    them, so the values object the resolver returns is byte-identical to what
 *    the page's existing payload builders expect. Pages keep their own
 *    coercion (`+form.qty || 1`, blank -> null) untouched.
 *
 * @module lib/validation/schemas
 */

import { z } from 'zod'

/* ── Shared rules / constants ─────────────────────────────────────────────── */

/** Cold-inflation pressure sanity window (PSI) for truck/OTR tyres. */
export const PRESSURE_PSI = { min: 20, max: 200 }

/** Tread depth sanity window (mm); new drive tyres top out around 30 mm. */
export const TREAD_DEPTH_MM = { min: 0, max: 30 }

/**
 * Tyre size formats accepted:
 *   metric        315/80R22.5, 385/65 R 22.5
 *   wide base     12R22.5, 11R24.5, 24R21
 *   flotation     445/95R25
 */
export const TYRE_SIZE_RE = /^(\d{2,3}(\/\d{2,3})?\s?[Rr]\s?\d{2}(\.\d)?)$/

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Same plausibility rule as import/validate.js: real calendar date, 1970-2100. */
export function isPlausibleIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const year = d.getUTCFullYear()
  return year >= 1970 && year <= 2100
}

/** Required ISO date within the plausible window. */
const isoDate = (label) =>
  z.string()
    .min(1, { message: `${label} is required.` })
    .refine(isPlausibleIsoDate, { message: `${label} must be a valid date (YYYY-MM-DD, 1970-2100).` })

/** Optional ISO date: blank/null/missing allowed, non-blank must be plausible. */
const isoDateOptional = (label) =>
  z.union([z.literal(''),
    z.string().refine(isPlausibleIsoDate, { message: `${label} must be a valid date (YYYY-MM-DD, 1970-2100).` })]).nullish()

/** Optional string (blank/null/missing allowed). */
const optionalStr = (max = 200) => z.string().max(max).nullish()

/** Required natural-key string (non-blank after trim). */
const requiredStr = (label, max = 120) =>
  z.string({ message: `${label} is required.` })
    .max(max, { message: `${label} must be at most ${max} characters.` })
    .refine((v) => v.trim().length > 0, { message: `${label} is required.` })

/** Optional email (blank/null/missing allowed, otherwise valid format). */
const optionalEmail = z.union([z.literal(''),
  z.email({ message: 'Invalid email address.' })]).nullish()

/** Optional finite number with bounds; null/undefined/missing allowed. */
const optionalNumber = (label, { min = null, max = null } = {}) =>
  z.number({ message: `${label} must be a number.` })
    .refine((v) => Number.isFinite(v), { message: `${label} must be a finite number.` })
    .refine((v) => min == null || v >= min, { message: `${label} must be >= ${min}.` })
    .refine((v) => max == null || v <= max, { message: `${label} must be <= ${max}.` })
    .nullish()

/** Optional tyre size: blank allowed, otherwise must match TYRE_SIZE_RE. */
const optionalTyreSize = z.union([z.literal(''),
  z.string().refine((v) => TYRE_SIZE_RE.test(v.trim()), {
    message: 'Tyre size must look like 315/80R22.5 or 12R22.5.',
  })]).nullish()

export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
export const INSPECTION_STATUSES = ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled']

/* ── Entity schemas (typed payloads) ──────────────────────────────────────── */

/**
 * Supplier master. Natural key (import/validate.js): country + (supplier_code
 * || supplier_name) - so country and supplier_name are required; code optional.
 */
export const supplierSchema = z.object({
  country: requiredStr('Country', 40),
  supplier_name: requiredStr('Supplier name', 160),
  supplier_code: optionalStr(60),
  supplier_type: optionalStr(60),
  phone: optionalStr(40),
  email: optionalEmail,
  rating: optionalNumber('Rating', { min: 0, max: 5 }),
  notes: optionalStr(2000),
}).passthrough()

/** Driver master. Natural key: country + driver_id (both required). */
export const driverSchema = z.object({
  country: requiredStr('Country', 40),
  driver_id: requiredStr('Driver ID', 60),
  driver_name: requiredStr('Driver name', 160),
  license_no: optionalStr(60),
  license_expiry: isoDateOptional('License expiry'),
  phone: optionalStr(40),
  email: optionalEmail,
  status: optionalStr(40),
}).passthrough()

/** Vehicle / fleet asset. Natural key: country + asset_no. Mileage >= 0. */
export const vehicleSchema = z.object({
  country: requiredStr('Country', 40),
  asset_no: requiredStr('Asset number', 60),
  make: optionalStr(80),
  model: optionalStr(80),
  vehicle_type: optionalStr(80),
  registration_no: optionalStr(60),
  tyre_size: optionalTyreSize,
  current_km: optionalNumber('Mileage', { min: 0 }),
}).passthrough()

/**
 * Tyre record (tyre_records row). Natural key: country + serial_no; asset_no
 * required (import module marks it required). Removal km never before
 * fitment km; all quantities non-negative; qty a positive integer.
 */
export const tyreRecordSchema = z.object({
  country: requiredStr('Country', 40),
  asset_no: requiredStr('Asset number', 60),
  serial_no: optionalStr(80),
  brand: optionalStr(80),
  site: optionalStr(120),
  size: optionalTyreSize,
  issue_date: isoDateOptional('Issue date'),
  qty: optionalNumber('Quantity', { min: 1 })
    .refine((v) => v == null || Number.isInteger(v), { message: 'Quantity must be a whole number.' }),
  cost_per_tyre: optionalNumber('Cost per tyre', { min: 0 }),
  km_at_fitment: optionalNumber('KM at fitment', { min: 0 }),
  km_at_removal: optionalNumber('KM at removal', { min: 0 }),
  risk_level: z.union([z.literal(''), z.enum(RISK_LEVELS)]).nullish(),
  remarks: optionalStr(4000),
}).passthrough().superRefine((row, ctx) => {
  if (typeof row.km_at_fitment === 'number' && typeof row.km_at_removal === 'number'
      && row.km_at_removal < row.km_at_fitment) {
    ctx.addIssue({
      code: 'custom',
      path: ['km_at_removal'],
      message: `Removal KM (${row.km_at_removal}) is less than fitment KM (${row.km_at_fitment}).`,
    })
  }
})

/**
 * Inspection event. Natural key components (import/validate.js): country +
 * asset_no + inspection_date; pressure/tread readings inside sane windows.
 */
export const inspectionSchema = z.object({
  country: requiredStr('Country', 40),
  asset_no: requiredStr('Asset number', 60),
  inspection_date: isoDate('Inspection date'),
  inspection_type: optionalStr(80),
  inspector: optionalStr(120),
  status: z.union([z.literal(''), z.enum(INSPECTION_STATUSES)]).nullish(),
  pressure_reading: optionalNumber('Pressure', { min: PRESSURE_PSI.min, max: PRESSURE_PSI.max }),
  tread_depth: optionalNumber('Tread depth', { min: TREAD_DEPTH_MM.min, max: TREAD_DEPTH_MM.max }),
  findings: optionalStr(4000),
}).passthrough()

/** Supplier contract (supplier_contracts row): end never before start. */
export const supplierContractSchema = z.object({
  supplier_name: requiredStr('Supplier name', 160),
  contract_start: isoDateOptional('Contract start'),
  contract_end: isoDateOptional('Contract end'),
  payment_terms: optionalStr(120),
  price_per_unit: optionalNumber('Price per unit', { min: 0 }),
  min_order: optionalNumber('Minimum order', { min: 0 })
    .refine((v) => v == null || Number.isInteger(v), { message: 'Minimum order must be a whole number.' }),
  notes: optionalStr(2000),
}).passthrough().superRefine((c, ctx) => {
  if (c.contract_start && c.contract_end
      && isPlausibleIsoDate(c.contract_start) && isPlausibleIsoDate(c.contract_end)
      && c.contract_end < c.contract_start) {
    ctx.addIssue({
      code: 'custom',
      path: ['contract_end'],
      message: 'Contract end date cannot be before the start date.',
    })
  }
})

/* ── Form schemas (raw string inputs, no transforms) ──────────────────────── */

/** Blank-or-numeric string within bounds; NEVER transforms the value. */
const numericStr = (label, { min = null, max = null, integer = false } = {}) =>
  z.string().superRefine((v, ctx) => {
    if (v === '') return
    const n = Number(v)
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a number.` })
      return
    }
    if (integer && !Number.isInteger(n)) ctx.addIssue({ code: 'custom', message: `${label} must be a whole number.` })
    if (min != null && n < min) ctx.addIssue({ code: 'custom', message: `${label} must be >= ${min}.` })
    if (max != null && n > max) ctx.addIssue({ code: 'custom', message: `${label} must be <= ${max}.` })
  })

/** Blank-or-plausible-ISO-date string; never transforms. */
const dateStr = (label) =>
  z.string().refine((v) => v === '' || isPlausibleIsoDate(v), {
    message: `${label} must be a valid date (1970-2100).`,
  })

/**
 * TyreRecords add/edit form: field values are the exact strings the page's
 * saveRecord() payload builder already coerces - output equals input.
 */
export const tyreRecordFormSchema = z.object({
  sr: z.string(),
  issue_date: dateStr('Issue date'),
  description: z.string().max(500, { message: 'Description must be at most 500 characters.' }),
  brand: z.string().max(80, { message: 'Brand must be at most 80 characters.' }),
  serial_no: z.string().max(80, { message: 'Serial number must be at most 80 characters.' }),
  qty: z.union([numericStr('Quantity', { min: 1, integer: true }), z.number().int().min(1)]),
  job_card: z.string().max(60, { message: 'Job card must be at most 60 characters.' }),
  mis_number: z.string().max(60, { message: 'MIS number must be at most 60 characters.' }),
  asset_no: z.string().refine((v) => v.trim().length > 0, { message: 'Asset number is required.' }),
  site: z.string().max(120, { message: 'Site must be at most 120 characters.' }),
  country: z.string().refine((v) => v.trim().length > 0, { message: 'Country is required.' }),
  remarks: z.string().max(4000, { message: 'Remarks must be at most 4000 characters.' }),
  cost_per_tyre: z.union([numericStr('Cost per tyre', { min: 0 }), z.number().min(0)]),
  risk_level: z.string().refine((v) => v === '' || RISK_LEVELS.includes(v), { message: 'Invalid risk level.' }),
  category: z.string(),
  km_at_fitment: z.union([numericStr('KM at fitment', { min: 0 }), z.number().min(0)]),
  km_at_removal: z.union([numericStr('KM at removal', { min: 0 }), z.number().min(0)]),
}).superRefine((f, ctx) => {
  const fit = f.km_at_fitment === '' ? null : Number(f.km_at_fitment)
  const rem = f.km_at_removal === '' ? null : Number(f.km_at_removal)
  if (fit != null && rem != null && Number.isFinite(fit) && Number.isFinite(rem) && rem < fit) {
    ctx.addIssue({
      code: 'custom',
      path: ['km_at_removal'],
      message: 'Removal KM cannot be less than fitment KM.',
    })
  }
})

/**
 * Supplier contract add/edit form (SupplierManagement ContractModal): string
 * inputs validated in place; the page's saveContract() keeps its own coercion.
 */
export const contractFormSchema = z.object({
  supplier_name: z.string().refine((v) => v.trim().length > 0, { message: 'Supplier name is required.' }),
  contract_start: dateStr('Contract start'),
  contract_end: dateStr('Contract end'),
  payment_terms: z.string().max(120, { message: 'Payment terms must be at most 120 characters.' }),
  price_per_unit: z.union([numericStr('Price per unit', { min: 0 }), z.number().min(0)]),
  min_order: z.union([numericStr('Minimum order quantity', { min: 0, integer: true }), z.number().int().min(0)]),
  notes: z.string().max(2000, { message: 'Notes must be at most 2000 characters.' }),
}).superRefine((f, ctx) => {
  if (f.contract_start && f.contract_end
      && isPlausibleIsoDate(f.contract_start) && isPlausibleIsoDate(f.contract_end)
      && f.contract_end < f.contract_start) {
    ctx.addIssue({
      code: 'custom',
      path: ['contract_end'],
      message: 'Contract end date cannot be before the start date.',
    })
  }
})
