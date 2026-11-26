/**
 * Pure helpers for driver charge cases. Labels come from the shared document
 * spec so the screen, the PDF and the Flutter app use the same words.
 */
import spec from '../../docs/document-specs/driver-charge-notice.json'
import statementSpec from '../../docs/document-specs/driver-charge-statements.json'
import enLocale from '../locales/en/driverCharges.json'

export const CHARGE_SPEC = spec
export const CATEGORIES = Object.keys(spec.enums.category)
export const SOURCE_TYPES = Object.keys(spec.enums.source_type)
export const STATUSES = Object.keys(spec.enums.status)
export const REVERSAL_CODES = Object.keys(spec.enums.reversal_code)
export const EVIDENCE_KINDS = ['notice', 'photo', 'document', 'record', 'statement', 'other']
export const TERMINAL_STATUSES = ['deducted', 'waived', 'cancelled_wrongly_issued']

/** Statement versions the server stores verbatim with each signature. */
export const STATEMENT_VERSIONS = Object.freeze({ accept: 'deduction-consent-v3', dispute: 'receipt-dispute-v2', witness: 'refusal-witness-v2' })
/** Languages a driver or witness may sign in. The server accepts exactly these. */
export const STATEMENT_LANGUAGES = statementSpec.languages
export const STATEMENT_LANGUAGE_NAMES = Object.freeze({ en: 'English', ar: 'العربية', ur: 'اردو' })
export const STATEMENT_SPEC = statementSpec
export const isRtlLanguage = lang => lang === 'ar' || lang === 'ur'

/**
 * The exact statement for a version and language, from the server payload
 * (driver_charge_detail.statements[version][lang]). Null when the server did
 * not send it: never sign words the server did not supply.
 */
export function statementText(detail, version, lang = 'en') {
  const entry = detail?.statements?.[version]
  const text = entry && typeof entry === 'object' ? entry[lang] : null
  return typeof text === 'string' && text.trim() ? text : null
}

/** Pick a statement language: the app language when signable, else English. */
export function defaultStatementLanguage(appLanguage) {
  return STATEMENT_LANGUAGES.includes(appLanguage) ? appLanguage : 'en'
}

// ── Country deduction rules. Mirror of private.driver_charge_country_key()
//    and private.driver_charge_country_rule(); display only, the server enforces.
const COUNTRY_KEYS = {
  KSA: ['KSA', 'SA', 'SAU', 'SAUDI', 'SAUDIARABIA', 'KINGDOMOFSAUDIARABIA'],
  UAE: ['UAE', 'AE', 'ARE', 'UNITEDARABEMIRATES', 'EMIRATES'],
  EGYPT: ['EGYPT', 'EG', 'EGY', 'ARABREPUBLICOFEGYPT'],
}
/** One spelling per country ("Saudi Arabia", "sa", "K.S.A." all become KSA). */
export function chargeCountryKey(country) {
  const k = String(country || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!k) return null
  return Object.keys(COUNTRY_KEYS).find(key => COUNTRY_KEYS[key].includes(k)) || k
}
export function chargeCountryRule(country) {
  if (chargeCountryKey(country) === 'KSA') {
    return { rule: 'ksa_labour_law', statutory: true, needs_legal_confirmation: false, damage_days: 5, wage_days: 30, total_pct: 50, objection_working_days: 15 }
  }
  return { rule: 'company_setting', statutory: false, needs_legal_confirmation: true }
}

/**
 * damage (Art 91, may be deducted without consent within limits) or consent
 * (Art 92, only with the driver's written consent). A government traffic fine
 * recovered from the driver is an Art 92 deduction, not an Art 70/71 penalty.
 */
export function chargeBucket(category) {
  return ['accident_damage', 'tyre_damage', 'missing_item', 'handover_damage'].includes(category) ? 'damage' : 'consent'
}

/**
 * Saudi Labour Law Art 91(1): damage may be deducted only when caused "as a
 * result of his own fault or violation of the employer's instructions and not
 * as a result of a third party's fault or a force majeure". Staff record the
 * finding on every KSA damage charge; the last two can never be deducted.
 */
export const FAULT_FINDINGS = Object.keys(spec.enums.fault_finding)
export const NO_FAULT_FINDINGS = ['third_party', 'force_majeure']
export const chargeNeedsFaultFinding = (country, category) => chargeCountryRule(country).statutory && chargeBucket(category) === 'damage'

/** Physical damage needs at least one photo before the driver is notified. */
export const chargeNeedsPhoto = category => ['accident_damage', 'tyre_damage', 'handover_damage'].includes(category)
export const photoEvidence = evidence => (Array.isArray(evidence) ? evidence : []).filter(e => e?.kind === 'photo' && typeof e.ref === 'string' && e.ref)

const round2 = n => Math.round(n * 100) / 100

/**
 * The highest instalment one charge may take per month, exactly like the
 * server: KSA damage 5 days' wage (wage / 30 * 5), other KSA deductions
 * (with consent) half the wage; elsewhere the configured percent.
 */
export function scheduleCapFor({ country, category, monthlyWage, capPct }) {
  const wage = Number(monthlyWage)
  if (!Number.isFinite(wage) || wage <= 0) return null
  const rule = chargeCountryRule(country)
  if (!rule.statutory) return capAmountFor(wage, capPct)
  const bucket = chargeBucket(category)
  if (bucket === 'damage') return round2(wage * rule.damage_days / rule.wage_days)
  return round2(wage * rule.total_pct / 100)
}

/**
 * Why finance cannot schedule a deduction yet, or null. Prefers the server's
 * own answer (driver_charge_detail.settings.schedule_block, the rule the
 * schedule command enforces); otherwise works it out from the rule fields the
 * detail returns. Only for a charge the driver did not accept.
 * Returns { code, article, until, message } or null.
 */
export function scheduleBlockFor(detail, now = new Date()) {
  const c = detail?.charge
  if (!c) return null
  const settings = detail.settings || {}
  if (settings.schedule_block && typeof settings.schedule_block === 'object') return settings.schedule_block
  if ('schedule_block' in settings) return null
  const rule = settings.country_rule || chargeCountryRule(c.country)
  if (rule.statutory && (settings.bucket || chargeBucket(c.category)) === 'damage' && NO_FAULT_FINDINGS.includes(c.fault_finding)) {
    return { code: 'no_fault', article: '91', until: null, message: 'Saudi Labour Law (Article 91): the damage was found to be caused by a third party or force majeure, so it cannot be deducted from the driver. Waive the charge.' }
  }
  if (c.driver_response === 'accepted') return null
  const until = settings.objection_last_day || null
  const deadline = settings.objection_deadline ? new Date(settings.objection_deadline) : null
  const windowOpen = !deadline || deadline.getTime() > now.getTime()
  const appealOpen = detail.appeal && !detail.appeal.outcome
  if (rule.statutory) {
    if ((settings.bucket || chargeBucket(c.category)) !== 'damage' || !c.fault_finding) return { code: 'consent_required', article: '92', until: null, message: "Saudi Labour Law (Article 92): this charge can be deducted only with the driver's written consent. It cannot be scheduled because the driver did not accept it." }
    if (appealOpen) return { code: 'open_objection', article: '91', until: null, message: 'Saudi Labour Law (Article 91): the driver has an open objection. Decide it first.' }
    if (windowOpen) return { code: 'window_open', article: '91', until, message: `Saudi Labour Law (Article 91): the driver has 15 working days from the notice to object. A deduction can be scheduled after ${until || 'the objection window'}.` }
    return null
  }
  if (detail.appeal?.outcome === 'upheld') return null
  if (appealOpen) return { code: 'open_objection', article: null, until: null, message: 'The driver has an open appeal. Decide it first.' }
  if (windowOpen) return { code: 'window_open', article: null, until, message: `The driver did not consent. A deduction can be scheduled only after the appeal period ends (${until || 'after the finance approval'}) or an appeal is decided.` }
  return null
}

/** KSA monthly limits across all of a driver's charges. Null outside KSA. */
export function ksaMonthlyLimits(monthlyWage) {
  const wage = Number(monthlyWage)
  if (!Number.isFinite(wage) || wage <= 0) return null
  return { damage: round2(wage * 5 / 30), total: round2(wage * 0.5) }
}

/**
 * Mirror of private.driver_charge_working_deadline(): the end of the n-th
 * working day (Sunday to Thursday) after the Riyadh date of `from`. Returns an
 * ISO instant (Riyadh is UTC+3 all year, no daylight saving).
 */
export function workingDeadline(from, days) {
  const t = new Date(from).getTime()
  if (!Number.isFinite(t) || !(days >= 1)) return null
  const riyadh = new Date(t + 3 * 3600 * 1000)
  let d = Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate())
  let n = 0
  while (n < days) {
    d += 86400000
    const dow = new Date(d).getUTCDay() // 5 Friday, 6 Saturday
    if (dow !== 5 && dow !== 6) n += 1
  }
  return new Date(d + 86400000 - 3 * 3600 * 1000).toISOString()
}

export const ACTION_LABELS = {
  charge_issue: 'Issue charge',
  charge_correct: 'Correct before notice',
  charge_attach_evidence: 'Add evidence',
  charge_notify: 'Notify driver',
  charge_respond: 'Respond and sign',
  charge_record_refusal: 'Record refusal with witness',
  charge_witness_confirm: 'Confirm refusal as witness',
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

const VALIDATE = enLocale.validate
/** A validation message: through the screen's t() when given, else English. */
const vmsg = (t, key) => (typeof t === 'function' ? t(`driverCharges.validate.${key}`) : VALIDATE[key])

export function validateIssue(values, t) {
  if (chargeNeedsPhoto(values.category) && photoEvidence(values.evidence).length === 0) return vmsg(t, 'photoRequired')
  if (values.fault_finding && !FAULT_FINDINGS.includes(values.fault_finding)) return vmsg(t, 'faultFinding')
  if (chargeNeedsFaultFinding(values.country, values.category) && !values.fault_finding) return vmsg(t, 'faultFinding')
  if (!CATEGORIES.includes(values.category)) return vmsg(t, 'category')
  if (values.category === 'traffic_fine' && values.source_type !== 'driver_fine') return vmsg(t, 'fineSource')
  if (values.source_type && values.source_type !== 'none' && !values.source_id) return vmsg(t, 'sourceRecord')
  if ((values.basis || '').trim().length < 10) return vmsg(t, 'basis')
  if (!(Number(values.amount) > 0)) return vmsg(t, 'amount')
  if (!/^[A-Z]{3}$/.test(String(values.currency || '').toUpperCase())) return vmsg(t, 'currency')
  const evidence = (values.evidence || []).filter(e => e.ref || e.label)
  if (evidence.some(e => !e.kind || !String(e.ref || '').trim() || !String(e.label || '').trim())) return vmsg(t, 'evidenceRow')
  if ((!values.source_type || values.source_type === 'none') && evidence.length === 0) return vmsg(t, 'evidenceOrSource')
  return null
}

export function validateResponse(values, t) {
  if (!['accept', 'dispute'].includes(values.response)) return vmsg(t, 'response')
  if (values.language && !STATEMENT_LANGUAGES.includes(values.language)) return vmsg(t, 'language')
  if (values.response === 'dispute' && (values.explanation || '').trim().length < 10) return vmsg(t, 'explanation')
  if (!values.acknowledged) return vmsg(t, 'acknowledge')
  if (!values.signature) return vmsg(t, 'signature')
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
