/**
 * customerPortalAnalytics - pure view-model engine for the Customer Portal
 * admin page (/customer-portal). Reuses the roll-ups in
 * `src/lib/customerPortal.js` (summariseAccounts / byTier / needsAttention)
 * and adds: search + filters, honest KPIs (N/A instead of a fabricated 0%),
 * contact-data quality and the export shape.
 *
 * No I/O. Deterministic.
 */
import {
  summariseAccounts, byTier, needsAttention, toFiniteNumber, isValidEmail,
} from './customerPortal'
import { searchRows, sortRows, buildExport } from './consoleTable'

export const BACKLOG_THRESHOLD = 5

const lc = (v) => String(v || '').trim().toLowerCase()
const portalOn = (r) => r?.portal_enabled === true || r?.portal_enabled === 'true' || r?.portal_enabled === 1 || r?.portal_enabled === '1'

export function countryOptions(rows = []) {
  return [...new Set(rows.map((r) => r?.country).filter(Boolean))].sort()
}

/** Filter + search; default order: company name A to Z. */
export function filterAccounts(rows = [], { status = '', tier = '', country = '', portal = '', search = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status && lc(r.status) !== status) return false
    if (tier === 'unspecified' ? lc(r.tier) !== '' : tier && lc(r.tier) !== tier) return false
    if (country && r.country !== country) return false
    if (portal === 'on' && !portalOn(r)) return false
    if (portal === 'off' && portalOn(r)) return false
    return true
  })
  const searched = searchRows(list, search, ['company_name', 'contact_name', 'email', 'account_code', 'account_manager', 'contract_ref', 'phone'])
  return sortRows(searched, { key: 'company_name', dir: 'asc' })
}

/**
 * KPI strip. Adoption / average SLA are null (N/A) when nothing can be
 * measured; sums only count values actually recorded.
 */
export function accountKpis(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const s = summariseAccounts(list)
  const slas = list.map((r) => toFiniteNumber(r?.sla_hours)).filter((v) => v != null)
  const withEmail = list.filter((r) => String(r?.email || '').trim())
  const invalidEmail = withEmail.filter((r) => !isValidEmail(r.email)).length
  const noContact = list.filter((r) => !String(r?.email || '').trim() && !String(r?.phone || '').trim()).length
  const backlogged = list.filter((r) => (toFiniteNumber(r?.open_requests) ?? 0) > BACKLOG_THRESHOLD).length
  const suspended = list.filter((r) => lc(r?.status) === 'suspended').length
  return {
    total: s.totalAccounts,
    active: s.activeCount,
    onboarding: s.onboardingCount,
    suspended,
    portalEnabled: s.portalEnabledCount,
    adoptionPct: s.totalAccounts ? Math.round((s.portalEnabledCount / s.totalAccounts) * 100) : null,
    openRequests: s.totalOpenRequests,
    linkedAssets: s.totalLinkedAssets,
    avgSlaHours: slas.length ? Math.round((slas.reduce((a, b) => a + b, 0) / slas.length) * 10) / 10 : null,
    slaCoverage: slas.length,
    backlogged,
    invalidEmail,
    noContact,
    attention: needsAttention(list).length,
  }
}

export function tierBreakdown(rows = []) {
  const tiers = byTier(rows)
  const max = tiers.reduce((m, t) => Math.max(m, t.count), 0)
  return tiers.map((t) => ({ ...t, pct: max ? Math.round((t.count / max) * 100) : 0 }))
}

/** Why an account is on the attention list (plain words). */
export function attentionReasons(r) {
  const out = []
  const st = lc(r?.status)
  if (st === 'suspended') out.push('Suspended')
  if (st === 'onboarding') out.push('Still onboarding')
  const open = toFiniteNumber(r?.open_requests) ?? 0
  if (open > BACKLOG_THRESHOLD) out.push(`${open} open requests`)
  if (String(r?.email || '').trim() && !isValidEmail(r.email)) out.push('Email looks invalid')
  return out
}

export function attentionList(rows = []) {
  return needsAttention(rows).map((r) => ({ ...r, _reasons: attentionReasons(r) }))
}

export const ACCOUNT_EXPORT_COLUMNS = [
  { key: 'company_name', header: 'Company' },
  { key: 'account_code', header: 'Account code' },
  { key: 'contact_name', header: 'Contact' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'tier', header: 'Tier', value: (r) => r.tier || 'Unspecified' },
  { key: 'status', header: 'Status' },
  { key: 'portal_enabled', header: 'Portal', value: (r) => (portalOn(r) ? 'Enabled' : 'Disabled') },
  { key: 'assets_linked', header: 'Linked assets', value: (r) => toFiniteNumber(r.assets_linked) ?? 'N/A' },
  { key: 'open_requests', header: 'Open requests', value: (r) => toFiniteNumber(r.open_requests) ?? 'N/A' },
  { key: 'sla_hours', header: 'SLA (h)', value: (r) => toFiniteNumber(r.sla_hours) ?? 'N/A' },
  { key: 'account_manager', header: 'Account manager' },
  { key: 'contract_ref', header: 'Contract ref' },
  { key: 'country', header: 'Country' },
]

export function accountExport(filtered = []) {
  return buildExport(filtered, ACCOUNT_EXPORT_COLUMNS)
}

export { portalOn }
