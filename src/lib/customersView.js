/**
 * customersView - the pure view engine behind the redesigned Customers page
 * (/customers). No I/O and no clock: the caller passes `now`.
 *
 * The Customers register (`customers`) holds identity, contact, type, site and
 * status only. Two other registers carry related facts and are joined by NAME,
 * because neither holds a customer id:
 *  - `customer_accounts` (Customer Portal): account code, linked asset count,
 *    open service requests and the SLA target. Linked when its company name
 *    equals the customer name (case and spacing ignored) and exactly one
 *    account carries that name.
 *  - `contracts`: a contract belongs to a customer when its counterparty
 *    (`vendor`) equals the customer name.
 * The rules are stated on screen. A customer with no match reads N/A, never 0.
 *
 * There is no revenue, satisfaction, segment revenue or SLA performance source,
 * so those figures are always null (rendered N/A).
 */
import { contactQuality } from './customersAnalytics'

export const RENEWAL_DAYS = 90
export const MATCH_RULE = 'Customers link to Customer Portal accounts and to contracts by name: an account whose company name, or a contract whose counterparty, equals the customer name (case and spacing ignored).'
export const HEALTH_RULE = 'Inactive: customer marked inactive. Critical: no valid email or phone on file. At risk: open service requests on the linked portal account, an email that is not valid, or a linked contract ending within 90 days. Healthy: none of these. Prospects are counted separately.'

const clean = (v) => (v == null ? '' : String(v).trim())
/** Normalised join key: lower case, single spaces. */
export const nameKey = (v) => clean(v).toLowerCase().replace(/\s+/g, ' ')

const DAY = 86400000
const toDay = (iso) => {
  if (!iso) return null
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')
  return Number.isFinite(t) ? t : null
}
const dayOf = (now) => {
  const d = now instanceof Date ? now : new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** customer id -> the single portal account with the same name (ambiguous names link to none). */
export function matchAccounts(customers = [], accounts = []) {
  const byName = new Map()
  for (const a of accounts || []) {
    const k = nameKey(a?.company_name)
    if (!k) continue
    byName.set(k, byName.has(k) ? null : a)
  }
  const out = new Map()
  for (const c of customers || []) {
    const a = byName.get(nameKey(c?.name))
    if (a) out.set(c.id, a)
  }
  return out
}

/** customer id -> contracts whose counterparty equals the customer name. */
export function matchContracts(customers = [], contracts = []) {
  const byName = new Map()
  for (const k of contracts || []) {
    const key = nameKey(k?.vendor)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(k)
  }
  const out = new Map()
  for (const c of customers || []) {
    const list = byName.get(nameKey(c?.name))
    if (list?.length) out.set(c.id, list)
  }
  return out
}

/** Active = status active and not already past its end date. */
export function isActiveContract(k, now) {
  if (clean(k?.status).toLowerCase() !== 'active') return false
  const end = toDay(k?.end_date)
  return end == null || end >= dayOf(now)
}

/** Days until the contract ends (negative when past), null with no end date. */
export function daysToEnd(k, now) {
  const end = toDay(k?.end_date)
  return end == null ? null : Math.round((end - dayOf(now)) / DAY)
}

export function isRenewalDue(k, now, days = RENEWAL_DAYS) {
  if (!isActiveContract(k, now)) return false
  const d = daysToEnd(k, now)
  return d != null && d >= 0 && d <= days
}

/** Earliest start and latest end across a customer's contracts. */
export function contractPeriod(list = []) {
  let from = null; let to = null
  for (const k of list || []) {
    const s = toDay(k?.start_date); const e = toDay(k?.end_date)
    if (s != null && (from == null || s < from)) from = s
    if (e != null && (to == null || e > to)) to = e
  }
  if (from == null && to == null) return null
  const fmt = (t) => (t == null ? null : new Date(t).toISOString().slice(0, 10))
  return { from: fmt(from), to: fmt(to) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function periodLabel(p) {
  if (!p) return null
  const m = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : 'Open')
  return `${m(p.from)} to ${m(p.to)}`
}

/** Health bucket for one customer. Rule in HEALTH_RULE. */
export function customerHealth(c, { account, contracts } = {}, now = new Date()) {
  const status = clean(c?.status).toLowerCase()
  if (status === 'inactive') return 'inactive'
  if (status === 'prospect') return 'prospect'
  const q = contactQuality(c)
  if (q === 'missing') return 'critical'
  const openReq = num(account?.open_requests)
  const renewal = (contracts || []).some((k) => isRenewalDue(k, now))
  if ((openReq != null && openReq > 0) || q === 'invalid_email' || renewal) return 'at_risk'
  return 'healthy'
}

export const HEALTH = [
  { key: 'healthy', label: 'Healthy', color: '#16a34a' },
  { key: 'at_risk', label: 'At risk', color: '#f59e0b' },
  { key: 'critical', label: 'Critical', color: '#dc2626' },
  { key: 'inactive', label: 'Inactive', color: '#9ca3af' },
  { key: 'prospect', label: 'Prospect', color: '#0ea5e9' },
]
export const healthLabel = (k) => HEALTH.find((h) => h.key === k)?.label || 'N/A'

/**
 * Enrich each customer with its linked account and contracts. `accounts` or
 * `contracts` may be null when that register could not be read: the linked
 * fields then stay null (unknown), which is different from "no match".
 */
export function buildCustomerRows(customers = [], { accounts = null, contracts = null, now = new Date() } = {}) {
  const acc = accounts ? matchAccounts(customers, accounts) : new Map()
  const con = contracts ? matchContracts(customers, contracts) : new Map()
  return (customers || []).map((c) => {
    const account = acc.get(c.id) || null
    const list = con.get(c.id) || []
    const active = list.filter((k) => isActiveContract(k, now))
    return {
      ...c,
      account,
      contracts: list,
      accountsKnown: accounts != null,
      contractsKnown: contracts != null,
      code: clean(account?.account_code) || null,
      assets: account ? num(account.assets_linked) : null,
      openRequests: account ? num(account.open_requests) : null,
      slaHours: account ? num(account.sla_hours) : null,
      activeContracts: contracts == null ? null : active.length,
      period: contractPeriod(list),
      renewals: list.filter((k) => isRenewalDue(k, now)),
      health: customerHealth(c, { account, contracts: list }, now),
    }
  })
}

const sumKnown = (rows, key) => {
  const vals = rows.map((r) => r[key]).filter((v) => v != null)
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null
}

/** Headline figures. Null means the figure has no source yet (N/A). */
export function customerViewKpis(rows = [], { accountsKnown = false, contractsKnown = false } = {}) {
  const active = rows.filter((r) => clean(r.status).toLowerCase() === 'active').length
  return {
    total: rows.length,
    active,
    activeContracts: contractsKnown ? rows.reduce((s, r) => s + (r.activeContracts || 0), 0) : null,
    linkedContracts: rows.filter((r) => r.contracts.length).length,
    assignedAssets: accountsKnown ? sumKnown(rows, 'assets') : null,
    openIssues: accountsKnown ? sumKnown(rows, 'openRequests') : null,
    linkedAccounts: rows.filter((r) => r.account).length,
    monthlyRevenue: null,
  }
}

/** Customer count per country, largest first. */
export function byCountry(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const k = clean(r.country) || 'Unassigned'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([country, total]) => ({ country, total })).sort((a, b) => b.total - a.total || a.country.localeCompare(b.country))
}

/** Customers ranked by linked asset count (only those with a known count). */
export function topByFleet(rows = [], n = 5) {
  return rows.filter((r) => r.assets != null && r.assets > 0)
    .sort((a, b) => b.assets - a.assets || clean(a.name).localeCompare(clean(b.name)))
    .slice(0, n)
    .map((r) => ({ id: r.id, name: clean(r.name), assets: r.assets }))
}

export function healthSegments(rows = []) {
  return HEALTH.map((h) => ({ ...h, count: rows.filter((r) => r.health === h.key).length })).filter((s) => s.count > 0)
}

/** Share of active customers holding at least one active linked contract. */
export function serviceCoverage(rows = [], contractsKnown = false) {
  const active = rows.filter((r) => clean(r.status).toLowerCase() === 'active')
  if (!contractsKnown || !active.length) return { pct: null, covered: 0, of: active.length }
  const covered = active.filter((r) => (r.activeContracts || 0) > 0).length
  return { pct: Math.round((covered / active.length) * 1000) / 10, covered, of: active.length }
}

/** Linked contracts ending within the renewal window, soonest first. */
export function renewalsDue(rows = [], now = new Date()) {
  const out = []
  for (const r of rows) for (const k of r.renewals) out.push({ customer: clean(r.name), title: clean(k.title) || 'Untitled contract', end: k.end_date, days: daysToEnd(k, now) })
  return out.sort((a, b) => a.days - b.days)
}

/** Register filter: free text, country, industry (customer type) and status. */
export function filterView(rows = [], { query = '', country = '', industry = '', status = '' } = {}) {
  const q = clean(query).toLowerCase()
  return rows.filter((r) => {
    if (country && (clean(r.country) || 'Unassigned') !== country) return false
    if (industry && clean(r.customer_type) !== industry) return false
    if (status && clean(r.status).toLowerCase() !== status) return false
    if (q) {
      const hay = [r.name, r.code, r.email, r.contact_name, r.customer_type, r.site, r.country].map(clean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
