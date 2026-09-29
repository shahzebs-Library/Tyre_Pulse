/**
 * fleetRenewalView - pure engine for the redesigned Fleet Renewal page
 * (/fleet-renewal). No I/O, no React; anything time based takes `now`.
 *
 * Two sources, never mixed up:
 *   1. The fleet register (vehicle_fleet) is the CANDIDATE list: every current
 *      asset is assessed for replacement from its own recorded facts.
 *   2. Renewal plans (fleet_renewal_plans) carry the DECISION: budget, target
 *      date and status. An asset with no plan reads "No plan", never a guess.
 *
 * THE ASSESSMENT RULE (stated on screen, change it here only):
 *   - Age = current year minus the recorded model year. A model year outside
 *     1970 .. next year (the register holds typos such as 20222) is rejected,
 *     so the asset's age is unknown rather than wrong.
 *   - Planning life = PLANNING_LIFE_YEARS. The register records no useful life
 *     per asset, so one planning life is applied to every asset and named.
 *   - Remaining life = planning life minus age (years).
 *   - Health score (0 to 100) = 70% age score + 30% reliability, where
 *     age score = 100 x (1 - age / planning life) clamped to 0..100 and
 *     reliability = 0 with an open breakdown, else 100. When the breakdown
 *     register could not be read, health is the age score alone. No age means
 *     no health score.
 *   - Priority: marked Plan For Scrap in the register -> critical; else
 *     remaining life <= 1 year -> critical; <= 2 years, or aging with an open
 *     breakdown -> high; <= 4 years -> medium; else low. No age -> unknown.
 */
import { latestUtilByAsset } from './fleetGroupsView'

export { latestUtilByAsset }

export const PLANNING_LIFE_YEARS = 10
export const AGING_YEARS = 7
export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

export const PRIORITY_META = {
  critical: { label: 'Critical', tone: 'bad', rank: 4, rec: 'Replace now' },
  high: { label: 'High', tone: 'orange', rank: 3, rec: 'Plan replacement' },
  medium: { label: 'Medium', tone: 'warn', rank: 2, rec: 'Monitor and plan' },
  low: { label: 'Low', tone: 'good', rank: 1, rec: 'Monitor' },
  unknown: { label: 'Unknown', tone: 'muted', rank: 0, rec: 'Record the model year' },
}
export const PRIORITY_KEYS = ['critical', 'high', 'medium', 'low', 'unknown']

export const PLAN_STATUS_META = {
  planned: { label: 'Planned', tone: 'info' },
  approved: { label: 'Approved', tone: 'good' },
  deferred: { label: 'Deferred', tone: 'warn' },
  completed: { label: 'Completed', tone: 'muted' },
}

export const AGE_DIST_BANDS = [
  { key: '0-2', label: '0-2', min: 0, max: 2 },
  { key: '3-5', label: '3-5', min: 3, max: 5 },
  { key: '6-8', label: '6-8', min: 6, max: 8 },
  { key: '9-10', label: '9-10', min: 9, max: 10 },
  { key: '10+', label: '>10', min: 11, max: Infinity },
]

export const assetKey = (v) => (v == null ? '' : String(v).replace(/\s+/g, '').toUpperCase())

const num = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

export const currencyForCountry = (c) => COUNTRY_CURRENCY[c] || null

/** Asset still in the current fleet (history, scrapped and transferred rows are not renewal candidates). */
export function isCurrentFleet(asset) {
  const s = String(asset?.status ?? '').trim().toLowerCase()
  return !/^(inactive|retired|transferred|disposed|sold|scrapped)$/.test(s)
}

/** Age in whole years from a model year, or null when the year is missing or implausible. */
export function ageFromModelYear(modelYear, now = new Date()) {
  const y = num(modelYear)
  const cur = now.getFullYear()
  if (y == null || !Number.isInteger(y) || y < 1970 || y > cur + 1) return null
  return Math.max(0, cur - y)
}

/** Open breakdowns per asset. Returns null when the source could not be read. */
export function openBreakdownsByAsset(rows) {
  if (rows == null) return null
  const map = new Map()
  for (const r of rows) {
    if (r?.returned_to_service) continue
    const k = assetKey(r?.asset_no)
    if (k) map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

/** Apply the documented assessment rule to one asset. */
export function assessAsset({ age, openBreakdown, opsStatus }) {
  const scrap = /plan(ned)?[\s_-]*(for[\s_-]*)?scrap/i.test(String(opsStatus || ''))
  if (age == null) {
    const priority = scrap ? 'critical' : 'unknown'
    return { health: null, remainingYears: null, priority, recommendation: scrap ? 'Replace now' : PRIORITY_META.unknown.rec, scrap }
  }
  const ageScore = Math.max(0, Math.min(100, 100 * (1 - age / PLANNING_LIFE_YEARS)))
  const health = openBreakdown == null
    ? Math.round(ageScore)
    : Math.round(ageScore * 0.7 + (openBreakdown ? 0 : 100) * 0.3)
  const remainingYears = PLANNING_LIFE_YEARS - age
  let priority
  if (scrap || remainingYears <= 1) priority = 'critical'
  else if (remainingYears <= 2 || (openBreakdown && age >= AGING_YEARS)) priority = 'high'
  else if (remainingYears <= 4) priority = 'medium'
  else priority = 'low'
  return { health, remainingYears, priority, recommendation: PRIORITY_META[priority].rec, scrap }
}

export function remainingLifeLabel(years) {
  if (years == null) return 'N/A'
  if (years <= 0) return 'Past planning life'
  if (years === 1) return '1 year'
  return `${years} years`
}

/** Plans keyed by country+asset, falling back to asset only. Newest plan wins. */
export function indexPlans(plans = []) {
  const byCountry = new Map()
  const byAsset = new Map()
  const sorted = [...(plans || [])].sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))
  for (const p of sorted) {
    const k = assetKey(p?.asset_no)
    if (!k) continue
    const ck = `${p.country || ''}|${k}`
    if (!byCountry.has(ck)) byCountry.set(ck, p)
    if (!byAsset.has(k)) byAsset.set(k, p)
  }
  return { byCountry, byAsset }
}

function planFor(index, asset) {
  const k = assetKey(asset?.asset_no)
  return index.byCountry.get(`${asset?.country || ''}|${k}`) || index.byAsset.get(k) || null
}

/**
 * One planning row per current asset, plus a row for any plan whose asset is
 * not in the register (so every plan stays reachable for edit and delete).
 */
export function buildPlanningRows({ fleet = [], plans = [], utilRows = null, breakdownRows = null, now = new Date() } = {}) {
  const utilMap = utilRows == null ? null : latestUtilByAsset(utilRows)
  const bdMap = openBreakdownsByAsset(breakdownRows)
  const index = indexPlans(plans)
  const used = new Set()
  const rows = []
  for (const a of fleet || []) {
    if (!a?.asset_no || !isCurrentFleet(a)) continue
    const k = assetKey(a.asset_no)
    const age = ageFromModelYear(a.model_year, now)
    const openBreakdown = bdMap == null ? null : (bdMap.get(k) || 0) > 0
    const res = assessAsset({ age, openBreakdown, opsStatus: a.ops_status })
    const plan = planFor(index, a)
    if (plan) used.add(plan.id)
    const util = utilMap?.get(k)?.v
    rows.push({
      id: a.id || `${a.country}|${k}`,
      asset_no: a.asset_no,
      fleet_no: a.fleet_number || a.registration_no || null,
      make: a.make || null,
      model: a.model || null,
      vehicle_type: a.vehicle_type || null,
      site: a.site || null,
      country: a.country || null,
      model_year: a.model_year ?? null,
      current_km: num(a.current_km),
      ops_status: a.ops_status || null,
      age,
      utilization: util == null ? null : util,
      openBreakdown,
      ...res,
      plan,
      planStatus: plan?.status || 'none',
      budget: num(plan?.est_cost),
      currency: currencyForCountry(plan?.country || a.country),
      inRegister: true,
    })
  }
  for (const p of plans || []) {
    if (used.has(p.id)) continue
    rows.push({
      id: `plan:${p.id}`,
      asset_no: p.asset_no,
      fleet_no: null, make: null, model: null,
      vehicle_type: p.vehicle_type || null,
      site: p.site || null,
      country: p.country || null,
      model_year: null,
      current_km: num(p.current_km),
      ops_status: null,
      age: num(p.age_years),
      utilization: null,
      openBreakdown: null,
      health: null,
      remainingYears: null,
      priority: 'unknown',
      recommendation: p.recommendation || 'Asset not in the register',
      scrap: false,
      plan: p,
      planStatus: p.status || 'planned',
      budget: num(p.est_cost),
      currency: currencyForCountry(p.country),
      inRegister: false,
    })
  }
  return rows
}

export function sortPlanningRows(rows = []) {
  return [...rows].sort((a, b) => (PRIORITY_META[b.priority]?.rank ?? 0) - (PRIORITY_META[a.priority]?.rank ?? 0)
    || (b.age ?? -1) - (a.age ?? -1)
    || String(a.asset_no).localeCompare(String(b.asset_no)))
}

function monthsUntil(dateValue, now) {
  const t = dateValue ? Date.parse(String(dateValue).slice(0, 10)) : NaN
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
}

/** Plan is still open and targets the next 12 months (or is already overdue). */
export function isPlanDueWithin12m(plan, now = new Date()) {
  if (!plan || !['planned', 'approved'].includes(plan.status)) return false
  const m = monthsUntil(plan.target_replace_date, now)
  return m != null && m <= 12
}

export const PRESETS = [
  { key: 'due', label: 'Due for replacement', sub: 'Critical under the planning rule', test: (r) => r.priority === 'critical' },
  { key: 'high', label: 'High priority', sub: 'Critical and high priority assets', test: (r) => r.priority === 'critical' || r.priority === 'high' },
  { key: 'next12', label: 'Next 12 months', sub: 'Open plans targeted within a year', test: (r, now) => isPlanDueWithin12m(r.plan, now) },
  { key: 'noplan', label: 'No plan yet', sub: 'Critical or high assets without a plan', test: (r) => (r.priority === 'critical' || r.priority === 'high') && !r.plan },
]

export function presetCounts(rows = [], now = new Date()) {
  return PRESETS.map((p) => ({ key: p.key, label: p.label, sub: p.sub, count: rows.filter((r) => p.test(r, now)).length }))
}

export function filterPlanningRows(rows = [], { q = '', site = '', type = '', priority = '', status = '', preset = '' } = {}, now = new Date()) {
  const needle = String(q).trim().toLowerCase()
  const pre = PRESETS.find((p) => p.key === preset)
  return rows.filter((r) => {
    if (site && r.site !== site) return false
    if (type && r.vehicle_type !== type) return false
    if (priority && r.priority !== priority) return false
    if (status && r.planStatus !== status) return false
    if (pre && !pre.test(r, now)) return false
    if (needle) {
      const hay = [r.asset_no, r.fleet_no, r.make, r.model, r.vehicle_type, r.site].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
}

/** Register age distribution for one asset type (or all). Unknown ages are counted separately. */
export function ageDistribution(rows = [], type = '') {
  const bands = AGE_DIST_BANDS.map((b) => ({ ...b, count: 0 }))
  let unknown = 0
  let total = 0
  for (const r of rows) {
    if (!r.inRegister) continue
    if (type && r.vehicle_type !== type) continue
    total += 1
    if (r.age == null) { unknown += 1; continue }
    const b = bands.find((x) => r.age >= x.min && r.age <= x.max)
    if (b) b.count += 1
  }
  return { bands, unknown, total }
}

/** Renewal pipeline from plan statuses and target dates. */
export function pipelineSegments(plans = [], now = new Date()) {
  const seg = { approved: 0, next12: 0, beyond: 0, deferred: 0, completed: 0 }
  for (const p of plans || []) {
    if (p.status === 'approved') seg.approved += 1
    else if (p.status === 'deferred') seg.deferred += 1
    else if (p.status === 'completed') seg.completed += 1
    else if (isPlanDueWithin12m(p, now)) seg.next12 += 1
    else seg.beyond += 1
  }
  return [
    { key: 'approved', label: 'Approved', count: seg.approved, color: '#16a34a' },
    { key: 'next12', label: 'Planned (next 12m)', count: seg.next12, color: '#f97316' },
    { key: 'beyond', label: 'Planned (later or no date)', count: seg.beyond, color: '#2563eb' },
    { key: 'deferred', label: 'Deferred', count: seg.deferred, color: '#eab308' },
    { key: 'completed', label: 'Completed', count: seg.completed, color: '#94a3b8' },
  ]
}

/** Sum money by currency; `amount` is null when the plans span more than one currency. */
function sumMoney(items) {
  const by = new Map()
  let n = 0
  for (const it of items) {
    const v = num(it.amount)
    if (v == null) continue
    n += 1
    const c = it.currency || 'unknown'
    by.set(c, (by.get(c) || 0) + v)
  }
  const currencies = [...by.keys()]
  if (!currencies.length) return { amount: null, currency: null, mixed: false, costed: 0, byCurrency: [] }
  const byCurrency = currencies.map((c) => ({ currency: c === 'unknown' ? null : c, amount: by.get(c) }))
  if (currencies.length > 1) return { amount: null, currency: null, mixed: true, costed: n, byCurrency }
  return { amount: by.get(currencies[0]), currency: currencies[0] === 'unknown' ? null : currencies[0], mixed: false, costed: n, byCurrency }
}

/** Forecast CAPEX for the next four calendar quarters, from open plans with a cost and a target date. */
export function capexByQuarter(plans = [], now = new Date()) {
  const startQ = Math.floor(now.getMonth() / 3)
  const quarters = []
  for (let i = 0; i < 4; i++) {
    const qi = startQ + i
    const year = now.getFullYear() + Math.floor(qi / 4)
    const q = (qi % 4) + 1
    quarters.push({ key: `${year}-Q${q}`, label: `Q${q} ${year}`, year, q, items: [] })
  }
  for (const p of plans || []) {
    if (!['planned', 'approved'].includes(p.status)) continue
    const t = p.target_replace_date ? Date.parse(String(p.target_replace_date).slice(0, 10)) : NaN
    if (!Number.isFinite(t)) continue
    const d = new Date(t)
    const hit = quarters.find((x) => x.year === d.getFullYear() && x.q === Math.floor(d.getMonth() / 3) + 1)
    if (hit) hit.items.push({ amount: p.est_cost, currency: currencyForCountry(p.country) })
  }
  const all = sumMoney(quarters.flatMap((x) => x.items))
  return {
    mixed: all.mixed,
    currency: all.currency,
    hasData: all.costed > 0,
    quarters: quarters.map((x) => {
      const s = sumMoney(x.items)
      return { key: x.key, label: x.label, amount: all.mixed ? null : s.amount, plans: x.items.length }
    }),
  }
}

export function buildRenewalKpis(rows = [], plans = [], now = new Date()) {
  const reg = rows.filter((r) => r.inRegister)
  const aged = reg.filter((r) => r.age != null)
  const capex = sumMoney((plans || []).filter((p) => isPlanDueWithin12m(p, now))
    .map((p) => ({ amount: p.est_cost, currency: currencyForCountry(p.country) })))
  return {
    assets: reg.length,
    withAge: aged.length,
    due: reg.filter((r) => r.priority === 'critical').length,
    aging: aged.filter((r) => r.age > AGING_YEARS).length,
    capex,
    plans: (plans || []).length,
    approved: (plans || []).filter((p) => p.status === 'approved').length,
    planned: (plans || []).filter((p) => p.status === 'planned').length,
  }
}

/**
 * Deterministic planning rules for the right rail. These are rules over the
 * register, not AI output, and each carries the preset or filter it opens.
 */
export function planningRules(rows = [], now = new Date()) {
  const reg = rows.filter((r) => r.inRegister)
  const out = []
  const scrap = reg.filter((r) => r.scrap && !r.plan).length
  if (scrap) out.push({ key: 'scrap', tone: 'bad', title: `${scrap} asset${scrap === 1 ? '' : 's'} marked for scrap with no plan`, detail: 'The register marks them Plan For Scrap. Add a renewal plan so a replacement is budgeted.', preset: 'noplan' })
  const past = reg.filter((r) => r.remainingYears != null && r.remainingYears <= 0).length
  if (past) out.push({ key: 'past', tone: 'bad', title: `${past} asset${past === 1 ? '' : 's'} past the ${PLANNING_LIFE_YEARS}-year planning life`, detail: 'Replacement is due now under the planning rule.', preset: 'due' })
  const bdAging = reg.filter((r) => r.openBreakdown && r.age != null && r.age >= AGING_YEARS).length
  if (bdAging) out.push({ key: 'bd', tone: 'warn', title: `${bdAging} aging asset${bdAging === 1 ? '' : 's'} currently broken down`, detail: `Over ${AGING_YEARS} years old with an open breakdown. Compare repair against replacement.`, preset: 'high' })
  const noPlan = reg.filter((r) => (r.priority === 'critical' || r.priority === 'high') && !r.plan).length
  if (noPlan) out.push({ key: 'noplan', tone: 'info', title: `${noPlan} high priority asset${noPlan === 1 ? '' : 's'} without a plan`, detail: 'No budget or target date is recorded for them yet.', preset: 'noplan' })
  const noAge = reg.filter((r) => r.age == null).length
  if (noAge) out.push({ key: 'noage', tone: 'muted', title: `${noAge} asset${noAge === 1 ? '' : 's'} with no usable model year`, detail: 'Their age, health and remaining life cannot be measured. Record the model year in Fleet Master.', priority: 'unknown' })
  return out
}

export const PLANNING_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Asset no' },
  { key: 'fleet_no', header: 'Fleet no or plate' },
  { key: 'make_model', header: 'Make / model' },
  { key: 'vehicle_type', header: 'Category' },
  { key: 'site', header: 'Site' },
  { key: 'country', header: 'Country' },
  { key: 'age', header: 'Age (years)' },
  { key: 'utilization', header: 'Utilization %' },
  { key: 'health', header: 'Health score' },
  { key: 'remaining', header: 'Remaining life' },
  { key: 'priority', header: 'Priority' },
  { key: 'recommendation', header: 'Recommendation' },
  { key: 'budget', header: 'Est. budget' },
  { key: 'currency', header: 'Currency' },
  { key: 'target', header: 'Target date' },
  { key: 'status', header: 'Plan status' },
]

export function planningExportRows(rows = []) {
  return rows.map((r) => ({
    asset_no: r.asset_no || '',
    fleet_no: r.fleet_no || '',
    make_model: [r.make, r.model].filter(Boolean).join(' '),
    vehicle_type: r.vehicle_type || '',
    site: r.site || '',
    country: r.country || '',
    age: r.age ?? '',
    utilization: r.utilization == null ? '' : Math.round(r.utilization),
    health: r.health ?? '',
    remaining: r.remainingYears == null ? '' : remainingLifeLabel(r.remainingYears),
    priority: PRIORITY_META[r.priority]?.label || '',
    recommendation: r.recommendation || '',
    budget: r.budget ?? '',
    currency: r.budget == null ? '' : (r.currency || ''),
    target: r.plan?.target_replace_date ? String(r.plan.target_replace_date).slice(0, 10) : '',
    status: r.plan ? (PLAN_STATUS_META[r.planStatus]?.label || r.planStatus) : 'No plan',
  }))
}
