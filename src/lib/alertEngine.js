// ─────────────────────────────────────────────────────────────────────────────
// alertEngine.js - Rule-based alert detection (no AI tokens)
// Call detectAlerts(supabase, country) to get live alert list.
// country = null means all countries.
// ─────────────────────────────────────────────────────────────────────────────

import { detectRiskSpike } from './analyticsEngine'
import { fetchAllPages } from './fetchAll'

export const ALERT_TYPES = {
  STOCK_CRITICAL:     'STOCK_CRITICAL',
  BUDGET_OVERAGE:     'BUDGET_OVERAGE',
  OVERDUE_ACTION:     'OVERDUE_ACTION',
  RISK_SPIKE:         'RISK_SPIKE',
  INSPECTION_OVERDUE: 'INSPECTION_OVERDUE',
  VEHICLE_INACTIVE:   'VEHICLE_INACTIVE',
  HIGH_CPK:           'HIGH_CPK',
  DATA_QUALITY:       'DATA_QUALITY',
}

export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH:     'high',
  MEDIUM:   'medium',
  INFO:     'info',
}

function alertId(type, key) {
  return `${type}::${key}`
}

/** Apply optional country filter to a Supabase query */
function withCountry(q, country) {
  return country ? q.eq('country', country) : q
}

// ─── Read shapes ─────────────────────────────────────────────────────────────
// Two column sets per source, because the sidebar badge and the /alerts page ask
// different questions. The badge reduces every alert to ONE integer
// (critical + high), so it needs only the fields the SEVERITY rules read plus the
// row id the dismissal filter keys on. The page additionally prints titles, sites
// and descriptions. Selecting `*` served the page's needs on every load the badge
// made, which is how a single sidebar number came to pull the whole inspections
// table across the wire.
const STOCK_COLS       = 'id,site,description,stock_qty,min_level,critical_level'
const STOCK_BADGE_COLS = 'id,stock_qty,critical_level'
const ACTION_COLS       = 'id,title,site,due_date'
const ACTION_BADGE_COLS = 'id,due_date'
const INSPECTION_COLS       = 'id,title,site,asset_no,scheduled_date'
const INSPECTION_BADGE_COLS = 'id,scheduled_date'
// detectRiskSpike reads exactly these two; `id`/`issue_date` were fetched and
// never looked at.
const SPIKE_COLS = 'risk_level,created_at'
// The inactivity / CPK / data-quality rules run over this sample. `id` is unused
// (their alert ids are built from the asset number) and `site` only appears in the
// inactivity MESSAGE, so the badge drops both.
const TYRE_COLS       = 'asset_no,site,issue_date,cost_per_tyre,km_at_fitment,km_at_removal,category'
const TYRE_BADGE_COLS = 'asset_no,issue_date,cost_per_tyre,km_at_fitment,km_at_removal,category'

// A corrective action / inspection only reaches HIGH once it is more than this
// many days overdue; below it the rule emits MEDIUM, which the badge never counts.
// So the badge can bound both reads server-side instead of fetching every open
// row and discarding the recent ones in the browser.
const OVERDUE_HIGH_DAYS = 7

const DAY_MS = 86400000
const daysAgoIso = (days) => new Date(Date.now() - days * DAY_MS).toISOString()
const daysAgoDate = (days) => daysAgoIso(days).split('T')[0]

const rowsOf = (res) => res?.data || []

function detectVehicleInactivity(tyreRecords = [], thresholds = {}) {
  const inactiveDays = thresholds.vehicleInactiveDays || 90
  const now = new Date()
  const lastSeen = {}
  tyreRecords.forEach(r => {
    if (!r.asset_no || !r.issue_date) return
    const d = new Date(r.issue_date)
    if (!lastSeen[r.asset_no] || d > lastSeen[r.asset_no].date)
      lastSeen[r.asset_no] = { date: d, site: r.site }
  })
  return Object.entries(lastSeen)
    .map(([assetNo, info]) => {
      const daysSince = Math.floor((now - info.date) / 86400000)
      if (daysSince < inactiveDays) return null
      return {
        type: ALERT_TYPES.VEHICLE_INACTIVE,
        severity: daysSince >= 180 ? 'high' : 'medium',
        title: `Vehicle ${assetNo} - No Activity`,
        message: `No tyre records for ${daysSince} days. Last seen: ${info.date.toLocaleDateString()}`,
        site: info.site,
        meta: { assetNo, daysSince, lastSeen: info.date.toISOString() },
      }
    })
    .filter(Boolean)
    .slice(0, 20)
}

function detectHighCpk(tyreRecords = [], thresholds = {}) {
  const multiplier = thresholds.cpkAlertMultiplier || 2.5
  const withCpk = tyreRecords.filter(r =>
    (r.cost_per_tyre||0) > 0 && (r.km_at_fitment||0) >= 0 && (r.km_at_removal||0) > (r.km_at_fitment||0)
  ).map(r => ({ ...r, cpk: r.cost_per_tyre / (r.km_at_removal - r.km_at_fitment) }))
  if (withCpk.length < 5) return []
  const avgCpk = withCpk.reduce((s,r) => s+r.cpk, 0) / withCpk.length
  const threshold = avgCpk * multiplier
  const byAsset = {}
  withCpk.forEach(r => {
    if (!r.asset_no) return
    if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
    byAsset[r.asset_no].push(r.cpk)
  })
  return Object.entries(byAsset)
    .filter(([,cpks]) => cpks.length >= 2)
    .map(([assetNo, cpks]) => {
      const assetAvg = cpks.reduce((s,v)=>s+v,0)/cpks.length
      if (assetAvg <= threshold) return null
      return {
        type: ALERT_TYPES.HIGH_CPK,
        severity: assetAvg > threshold*1.5 ? 'high' : 'medium',
        title: `High CPK - ${assetNo}`,
        message: `Avg CPK ${assetAvg.toFixed(4)} SAR/km is ${(assetAvg/avgCpk).toFixed(1)}x fleet average (${avgCpk.toFixed(4)})`,
        meta: { assetNo, assetAvg, fleetAvg: avgCpk, ratio: assetAvg/avgCpk },
      }
    })
    .filter(Boolean)
    .slice(0, 10)
}

function detectDataQuality(tyreRecords = [], thresholds = {}) {
  const missingCostThreshold = thresholds.missingCostPct || 0.3
  const unclassifiedThreshold = thresholds.unclassifiedPct || 0.4
  const alerts = []
  if (!tyreRecords.length) return alerts
  const missingCost = tyreRecords.filter(r => !r.cost_per_tyre || r.cost_per_tyre === 0).length
  const unclassified = tyreRecords.filter(r => !r.category || r.category === 'Unclassified').length
  const missingKm = tyreRecords.filter(r => !(r.km_at_fitment||0) && !(r.km_at_removal||0)).length
  const n = tyreRecords.length
  if (missingCost/n > missingCostThreshold) alerts.push({
    type: ALERT_TYPES.DATA_QUALITY, severity: missingCost/n > 0.6 ? 'high' : 'medium',
    title: 'Missing Cost Data',
    message: `${missingCost}/${n} records (${(missingCost/n*100).toFixed(0)}%) have no cost. Analytics accuracy reduced.`,
    meta: { missingCost, total: n },
  })
  if (unclassified/n > unclassifiedThreshold) alerts.push({
    type: ALERT_TYPES.DATA_QUALITY, severity: 'medium',
    title: 'High Unclassified Rate',
    message: `${unclassified}/${n} records (${(unclassified/n*100).toFixed(0)}%) unclassified. Run Data Cleaning.`,
    meta: { unclassified, total: n },
  })
  if (missingKm/n > 0.7) alerts.push({
    type: ALERT_TYPES.DATA_QUALITY, severity: 'info',
    title: 'Missing KM Data',
    message: `${missingKm} records lack km_at_fitment/km_at_removal. CPK analysis unavailable.`,
    meta: { missingKm, total: n },
  })
  return alerts
}

/**
 * Main entry point - fetches all needed data and returns alerts array.
 *
 * `badgeOnly` serves the sidebar count, which is `critical + high` and nothing
 * else. In that mode the reads are narrowed to the columns the severity rules
 * consume and bounded by the date at which each rule can first reach HIGH, and
 * the budgets read is skipped outright because BUDGET_OVERAGE is emitted at INFO
 * severity only and therefore can never move the badge. The MEDIUM/INFO alerts a
 * badge-only run returns are consequently incomplete - use `detectAlertBadgeCount`
 * rather than reading counts off this result.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null} country  - 'KSA' | 'UAE' | 'Egypt' | null (all)
 * @param {{badgeOnly?:boolean}} [opts]
 * @returns {Promise<Alert[]>}
 */
export async function detectAlerts(supabase, country = null, { badgeOnly = false } = {}) {
  const alerts = []
  const now    = new Date()

  // Overdue cutoffs. Deliberately a SUPERSET of what reaches HIGH (">= 7 days"
  // rather than "> 7 days"): the exact day count is still computed per row below,
  // so a boundary row is classified by the same arithmetic as before and only the
  // rows that cannot possibly qualify are left on the server.
  const actionCutoff = badgeOnly ? daysAgoIso(OVERDUE_HIGH_DAYS) : null
  const inspCutoff   = badgeOnly ? daysAgoDate(OVERDUE_HIGH_DAYS) : now.toISOString().split('T')[0]

  // ── Fetch data in parallel with optional country filter ───────────────────
  const [stockRes, budgetRes, actionsRes, tyreRes, inspRes, fullTyreRes] = await Promise.all([
    (() => {
      const q = supabase.from('stock_records').select(badgeOnly ? STOCK_BADGE_COLS : STOCK_COLS)
      // Ordering is presentation only (the result is re-sorted by severity), so
      // the badge skips it. It stays on the page path to keep the listed order of
      // equal-severity stock alerts identical to before.
      return withCountry(badgeOnly ? q : q.order('site'), country)
    })(),
    // Skipped for the badge: every BUDGET_OVERAGE alert is INFO.
    badgeOnly
      ? Promise.resolve({ data: [] })
      : withCountry(supabase.from('budgets').select('*').eq('year', now.getFullYear()), country),
    (() => {
      let q = withCountry(
        supabase
          .from('corrective_actions')
          .select(badgeOnly ? ACTION_BADGE_COLS : ACTION_COLS)
          .neq('status', 'Closed'),
        country
      )
      if (actionCutoff) q = q.lt('due_date', actionCutoff)
      return q
    })(),
    withCountry(
      supabase.from('tyre_records')
        .select(SPIKE_COLS)
        .order('created_at', { ascending: false })
        .limit(500),
      country
    ),
    // Paged rather than a bare select: `inspections` grows per inspection, and a
    // silently truncated read here would UNDER-report the badge, which is the one
    // direction a safety count must never be wrong in.
    fetchAllPages((from, to) => withCountry(
      supabase.from('inspections')
        .select(badgeOnly ? INSPECTION_BADGE_COLS : INSPECTION_COLS)
        .neq('status', 'Done')
        .neq('status', 'Cancelled')
        .lte('scheduled_date', inspCutoff)
        .order('scheduled_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
      country
    ), { max: 5000 }),
    withCountry(
      supabase.from('tyre_records')
        .select(badgeOnly ? TYRE_BADGE_COLS : TYRE_COLS)
        .order('issue_date', { ascending: false })
        .limit(2000),
      country
    ),
  ])

  const stockRecords = rowsOf(stockRes)
  const budgets      = rowsOf(budgetRes)
  const openActions  = rowsOf(actionsRes)
  const recentTyres  = rowsOf(tyreRes)
  const overdueInsp  = rowsOf(inspRes)
  const fullTyres    = rowsOf(fullTyreRes)

  // ── 1. Stock Critical ─────────────────────────────────────────────────────
  stockRecords.forEach(s => {
    if (s.stock_qty <= s.critical_level) {
      alerts.push({
        id:       alertId(ALERT_TYPES.STOCK_CRITICAL, s.id),
        type:     ALERT_TYPES.STOCK_CRITICAL,
        severity: s.stock_qty === 0 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
        title:    `Stock Critical: ${s.site}`,
        message:  `${s.description || 'Tyre stock'} at ${s.site} is critically low (${s.stock_qty} remaining, min ${s.min_level}).`,
        link:     '/stock',
        data:     s,
        createdAt: now.toISOString(),
      })
    } else if (s.stock_qty <= s.min_level) {
      alerts.push({
        id:       alertId(ALERT_TYPES.STOCK_CRITICAL, `low-${s.id}`),
        type:     ALERT_TYPES.STOCK_CRITICAL,
        severity: SEVERITY.MEDIUM,
        title:    `Low Stock: ${s.site}`,
        message:  `${s.description || 'Tyre stock'} at ${s.site} is below minimum level (${s.stock_qty} of ${s.min_level} min).`,
        link:     '/stock',
        data:     s,
        createdAt: now.toISOString(),
      })
    }
  })

  // ── 2. Budget Warning ─────────────────────────────────────────────────────
  const currentMonth = now.getMonth() + 1
  const currentYear  = now.getFullYear()
  const thisMonthBudgets = budgets.filter(b => b.month === currentMonth && b.year === currentYear)

  thisMonthBudgets.forEach(b => {
    if (b.monthly_budget < 1000) {
      alerts.push({
        id:       alertId(ALERT_TYPES.BUDGET_OVERAGE, b.id),
        type:     ALERT_TYPES.BUDGET_OVERAGE,
        severity: SEVERITY.INFO,
        title:    `Budget Warning: ${b.site}`,
        message:  `${b.site}'s monthly budget (${b.monthly_budget?.toLocaleString()}) may be too low for this month.`,
        link:     '/budgets',
        data:     b,
        createdAt: now.toISOString(),
      })
    }
  })

  // ── 3. Overdue Corrective Actions ─────────────────────────────────────────
  openActions.forEach(a => {
    if (!a.due_date) return
    const due = new Date(a.due_date)
    if (due < now) {
      const daysOverdue = Math.floor((now - due) / (1000 * 86400))
      alerts.push({
        id:       alertId(ALERT_TYPES.OVERDUE_ACTION, a.id),
        type:     ALERT_TYPES.OVERDUE_ACTION,
        severity: daysOverdue > 14 ? SEVERITY.CRITICAL : daysOverdue > 7 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        title:    `Overdue Action: ${a.title}`,
        message:  `"${a.title}" at ${a.site || 'N/A'} was due ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} ago.`,
        link:     '/actions',
        data:     a,
        createdAt: now.toISOString(),
      })
    }
  })

  // ── 4. Risk Spike Detection ───────────────────────────────────────────────
  if (recentTyres.length >= 20) {
    const spike = detectRiskSpike(recentTyres, Math.min(50, Math.floor(recentTyres.length / 2)))
    if (spike.isSpike) {
      alerts.push({
        id:       alertId(ALERT_TYPES.RISK_SPIKE, country ?? 'fleet'),
        type:     ALERT_TYPES.RISK_SPIKE,
        severity: spike.deltaPct > 50 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
        title:    'Risk Spike Detected',
        message:  `High-risk tyres jumped from ${spike.prior}% to ${spike.current}% in recent records (+${spike.deltaPct}%).`,
        link:     '/analytics',
        data:     spike,
        createdAt: now.toISOString(),
      })
    }
  }

  // ── 5. Overdue Inspections ────────────────────────────────────────────────
  overdueInsp.forEach(insp => {
    const scheduled = new Date(insp.scheduled_date)
    const daysOverdue = Math.floor((now - scheduled) / (1000 * 86400))
    if (daysOverdue >= 0) {
      alerts.push({
        id:       alertId(ALERT_TYPES.INSPECTION_OVERDUE, insp.id),
        type:     ALERT_TYPES.INSPECTION_OVERDUE,
        severity: daysOverdue > 7 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        title:    `Overdue Inspection: ${insp.site}`,
        message:  `${insp.title} at ${insp.site}${insp.asset_no ? ` (${insp.asset_no})` : ''} is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue.`,
        link:     '/inspections',
        data:     insp,
        createdAt: now.toISOString(),
      })
    }
  })

  // ── 6. Vehicle Inactivity ─────────────────────────────────────────────────
  detectVehicleInactivity(fullTyres).forEach((a, i) => {
    alerts.push({
      id:        alertId(ALERT_TYPES.VEHICLE_INACTIVE, `${a.meta.assetNo}-${i}`),
      type:      a.type,
      severity:  a.severity,
      title:     a.title,
      message:   a.message,
      link:      '/analytics',
      data:      a.meta,
      createdAt: now.toISOString(),
    })
  })

  // ── 7. High CPK ───────────────────────────────────────────────────────────
  detectHighCpk(fullTyres).forEach((a, i) => {
    alerts.push({
      id:        alertId(ALERT_TYPES.HIGH_CPK, `${a.meta.assetNo}-${i}`),
      type:      a.type,
      severity:  a.severity,
      title:     a.title,
      message:   a.message,
      link:      '/analytics',
      data:      a.meta,
      createdAt: now.toISOString(),
    })
  })

  // ── 8. Data Quality ───────────────────────────────────────────────────────
  detectDataQuality(fullTyres).forEach((a, i) => {
    alerts.push({
      id:        alertId(ALERT_TYPES.DATA_QUALITY, `${a.title.replace(/\s+/g, '-')}-${i}`),
      type:      a.type,
      severity:  a.severity,
      title:     a.title,
      message:   a.message,
      link:      '/analytics',
      data:      a.meta,
      createdAt: now.toISOString(),
    })
  })

  // Sort by severity then date
  const ORDER = { critical: 0, high: 1, medium: 2, info: 3 }
  const sorted = alerts.sort((a, b) => (ORDER[a.severity] ?? 4) - (ORDER[b.severity] ?? 4))

  // Update app badge with critical+high count (PWA Badging API)
  const badgeCount = sorted.filter(a => a.severity === 'critical' || a.severity === 'high').length
  if ('setAppBadge' in navigator) {
    try {
      badgeCount > 0
        ? navigator.setAppBadge(Math.min(badgeCount, 99)).catch(() => {})
        : navigator.clearAppBadge().catch(() => {})
    } catch { /* ignore */ }
  }

  return sorted
}

/**
 * The sidebar badge number: how many un-dismissed alerts are critical or high.
 *
 * Runs the SAME rules as `detectAlerts` over the same rows, so the number cannot
 * drift from the /alerts page; it only avoids paying for the columns and rows
 * that no severity rule reads. Callers pass the dismissed-id set because the
 * badge must exclude alerts the user has already cleared.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null} country
 * @param {Set<string>} [dismissed]
 * @returns {Promise<number>}
 */
export async function detectAlertBadgeCount(supabase, country = null, dismissed = new Set()) {
  const found = await detectAlerts(supabase, country, { badgeOnly: true })
  return found.filter(
    (a) => !dismissed.has(a.id) && (a.severity === SEVERITY.CRITICAL || a.severity === SEVERITY.HIGH),
  ).length
}

/**
 * Count alerts by severity - used for the badge in Layout
 */
export function countAlertsBySeverity(alerts) {
  const counts = { critical: 0, high: 0, medium: 0, info: 0 }
  alerts.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1 })
  return { ...counts, total: alerts.length }
}

export const SEVERITY_CONFIG = {
  critical: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    badge: 'bg-red-600' },
  high:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', badge: 'bg-orange-600' },
  medium:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', badge: 'bg-yellow-600' },
  info:     { label: 'Info',     color: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700',  badge: 'bg-green-600' },
}

export const ALERT_TYPE_LABELS = {
  [ALERT_TYPES.STOCK_CRITICAL]:      'Stock',
  [ALERT_TYPES.BUDGET_OVERAGE]:      'Budget',
  [ALERT_TYPES.OVERDUE_ACTION]:      'Action',
  [ALERT_TYPES.RISK_SPIKE]:          'Risk',
  [ALERT_TYPES.INSPECTION_OVERDUE]:  'Inspection',
  [ALERT_TYPES.VEHICLE_INACTIVE]:    'Vehicle Inactive',
  [ALERT_TYPES.HIGH_CPK]:            'High Cost Per KM',
  [ALERT_TYPES.DATA_QUALITY]:        'Data Quality',
}
