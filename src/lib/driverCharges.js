/**
 * Pure helpers for driver charge cases. Labels come from the shared document
 * spec so the screen, the PDF and the Flutter app use the same words.
 */
import spec from '../../docs/document-specs/driver-charge-notice.json'

export const CHARGE_SPEC = spec
export const CATEGORIES = Object.keys(spec.enums.category)
export const SOURCE_TYPES = Object.keys(spec.enums.source_type)
export const STATUSES = Object.keys(spec.enums.status)
export const REVERSAL_CODES = Object.keys(spec.enums.reversal_code)
export const EVIDENCE_KINDS = ['notice', 'photo', 'document', 'record', 'statement', 'other']
export const TERMINAL_STATUSES = ['deducted', 'waived', 'cancelled_wrongly_issued']

export const ACTION_LABELS = {
  charge_issue: 'Issue charge',
  charge_correct: 'Correct before notice',
  charge_attach_evidence: 'Add evidence',
  charge_notify: 'Notify driver',
  charge_respond: 'Respond and sign',
  charge_record_refusal: 'Record refusal with witness',
  charge_supervisor_review: 'Supervisor review',
  charge_finance_review: 'Finance review',
  charge_schedule: 'Schedule deduction',
  charge_record_deduction: 'Record payroll deduction',
  charge_waive: 'Waive charge',
  charge_reverse: 'Reverse as wrongly issued',
  charge_appeal: 'Appeal',
  charge_decide_appeal: 'Decide appeal',
}

export function enumLabel(enumName, value) {
  if (value === null || value === undefined || value === '') return spec.formats.missing
  return spec.enums[enumName]?.[value] || String(value).replaceAll('_', ' ')
}

export function money(amount, currency) {
  const n = Number(amount)
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return spec.formats.missing
  return `${currency || ''} ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}

const toCents = v => Math.round(Number(v) * 100)

/** Highest instalment per month, rounded like the server: round(wage * pct / 100, 2). */
export function capAmountFor(monthlyWage, capPct) {
  const wage = Number(monthlyWage); const pct = Number(capPct)
  if (!Number.isFinite(wage) || wage <= 0 || !Number.isFinite(pct) || pct <= 0) return null
  return Math.round(wage * pct) / 100
}

/** First day of a month as YYYY-MM-01, offset by n months (UTC, no drift). */
export function monthStart(date = new Date(), offset = 0) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/**
 * Split the outstanding amount into monthly instalments that never exceed the
 * cap. Uses whole cents so the total always matches the server check.
 */
export function buildInstalmentPlan(outstanding, capAmount, firstMonth) {
  const total = toCents(outstanding); const cap = toCents(capAmount)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(cap) || cap <= 0 || !/^\d{4}-\d{2}-01$/.test(firstMonth || '')) return []
  const count = Math.ceil(total / cap)
  if (count > 60) return []
  const start = new Date(`${firstMonth}T00:00:00Z`)
  const plan = []
  let left = total
  for (let i = 0; i < count; i += 1) {
    const cents = Math.min(cap, left)
    plan.push({ due_month: monthStart(start, i), amount: cents / 100 })
    left -= cents
  }
  return plan
}

export function validateIssue(values) {
  if (!CATEGORIES.includes(values.category)) return 'Choose a charge category.'
  if (values.category === 'traffic_fine' && values.source_type !== 'driver_fine') return 'A traffic fine charge must link the traffic fine record.'
  if (values.source_type && values.source_type !== 'none' && !values.source_id) return 'Choose the linked record.'
  if ((values.basis || '').trim().length < 10) return 'Write the basis for the charge (at least 10 characters).'
  if (!(Number(values.amount) > 0)) return 'Amount must be greater than zero.'
  if (!/^[A-Z]{3}$/.test(String(values.currency || '').toUpperCase())) return 'Enter a three letter currency code.'
  const evidence = (values.evidence || []).filter(e => e.ref || e.label)
  if (evidence.some(e => !e.kind || !String(e.ref || '').trim() || !String(e.label || '').trim())) return 'Each evidence row needs a type, reference and description.'
  if ((!values.source_type || values.source_type === 'none') && evidence.length === 0) return 'Link a source record or list at least one piece of evidence.'
  return null
}

export function validateResponse(values) {
  if (!['accept', 'dispute'].includes(values.response)) return 'Choose accept or dispute.'
  if (values.response === 'dispute' && (values.explanation || '').trim().length < 10) return 'Explain why you dispute the charge.'
  if (!values.acknowledged) return 'Read and confirm the statement.'
  if (!values.signature) return 'Sign before submitting.'
  return null
}

/** Outstanding amount per currency; never adds different currencies together. */
export function outstandingByCurrency(rows) {
  const map = new Map()
  for (const row of rows || []) {
    if (TERMINAL_STATUSES.includes(row.status) && row.status !== 'deducted') continue
    const value = Number(row.outstanding ?? (Number(row.amount) - Number(row.deducted_amount || 0)))
    if (!Number.isFinite(value) || value <= 0) continue
    map.set(row.currency, (map.get(row.currency) || 0) + value)
  }
  return [...map.entries()].map(([currency, outstanding]) => ({ currency, outstanding: Math.round(outstanding * 100) / 100 }))
}
