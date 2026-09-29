/**
 * Predictive Maintenance overview engine (pure, no I/O).
 *
 * Turns the outputs of the canonical prediction engine
 * (src/lib/predictiveMaintenance.js: buildPredictions + buildFailureRiskRows)
 * plus the preventive-maintenance plans (pm_programs) into the shapes the
 * overview cards draw. Nothing here invents a figure: a value that cannot be
 * measured comes back as null and the page renders it as N/A.
 *
 * Asset risk levels reuse the engine's own composite-score thresholds, one to
 * one: High = 70 or more (engine "extreme"), Medium = 50 to 69 (engine "high"),
 * Low = 30 to 49 (engine "elevated"), Healthy = under 30 (engine "low").
 */
import { REPLACE_TARGET_MM, LIMITING_FACTORS } from './predictiveMaintenance'

export const MS_DAY = 86_400_000
export const DUE_SOON_DAYS = 30
/** A tyre predicted to reach its replacement limit within this many days counts as a predicted failure. */
export const PREDICTED_FAILURE_DAYS = 30
/** Assets whose earliest replacement is within this window get a recommendation. */
export const RECOMMEND_DAYS = 90

export const RISK_LEVELS = ['high', 'medium', 'low', 'healthy']
export const RISK_LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low', healthy: 'Healthy' }
export const RISK_LEVEL_RANGE = { high: '70 or more', medium: '50 to 69', low: '30 to 49', healthy: 'under 30' }

/** Composite 0..100 score to an asset risk level (engine thresholds, relabelled). */
export function riskLevel(score) {
  const s = Number(score)
  if (score == null || !Number.isFinite(s)) return null
  if (s >= 70) return 'high'
  if (s >= 50) return 'medium'
  if (s >= 30) return 'low'
  return 'healthy'
}

const FACTOR_ISSUE = {
  mileage: 'Mileage wear-out',
  tread: 'Tread wear',
  age: 'Tyre age',
  pressure: 'Pressure deviation',
}

/** The largest contributor to a composite score, or null when every factor is zero. */
export function dominantFactor(factors) {
  if (!factors) return null
  let best = null
  let bestVal = 0
  for (const key of ['tread', 'mileage', 'pressure', 'age']) {
    const v = Number(factors[key])
    if (Number.isFinite(v) && v > bestVal) { best = key; bestVal = v }
  }
  return best
}

export function issueLabel(factor) {
  return FACTOR_ISSUE[factor] || null
}

export const LIMITING_LABEL = {
  [LIMITING_FACTORS.tread]: 'Tread wear',
  [LIMITING_FACTORS.km]: 'End of km life',
  [LIMITING_FACTORS.age]: 'Age limit (5 years)',
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function daysBetween(target, now) {
  const t = target instanceof Date ? target.getTime() : new Date(target).getTime()
  if (!Number.isFinite(t)) return null
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(t); end.setHours(0, 0, 0, 0)
  return Math.round((end - start) / MS_DAY)
}

/**
 * One row per asset: the worst active tyre speaks for the asset.
 * @param {object[]} riskRows    buildFailureRiskRows output
 * @param {object[]} predictions buildPredictions output
 * @param {object[]} fleet       vehicle_fleet rows (asset_no, make, model, site, vehicle_type)
 */
export function buildAssetRisk(riskRows = [], predictions = [], fleet = []) {
  const master = new Map()
  for (const f of fleet) if (f?.asset_no && !master.has(f.asset_no)) master.set(f.asset_no, f)
  const predByAsset = new Map()
  for (const p of predictions) {
    if (!p?.asset_no) continue
    const list = predByAsset.get(p.asset_no) || []
    list.push(p)
    predByAsset.set(p.asset_no, list)
  }
  const byAsset = new Map()
  for (const r of riskRows) {
    if (!r?.asset_no || r.asset_no === '-') continue
    const cur = byAsset.get(r.asset_no)
    if (!cur) byAsset.set(r.asset_no, { worst: r, tyres: 1 })
    else {
      cur.tyres += 1
      if (Number(r.risk_score) > Number(cur.worst.risk_score)) cur.worst = r
    }
  }
  const out = []
  for (const [asset, { worst, tyres }] of byAsset) {
    const m = master.get(asset) || {}
    const preds = predByAsset.get(asset) || []
    const days = preds.map((p) => num(p.days_away)).filter((d) => d != null)
    const conf = preds.map((p) => num(p.confidence)).filter((c) => c != null)
    const factor = dominantFactor(worst.factors)
    out.push({
      asset_no: asset,
      site: worst.site && worst.site !== '-' ? worst.site : (m.site || null),
      make: m.make || null,
      model: m.model || null,
      vehicle_type: m.vehicle_type || null,
      score: num(worst.risk_score),
      level: riskLevel(worst.risk_score),
      factor,
      issue: issueLabel(factor),
      position: worst.position && worst.position !== '-' ? worst.position : null,
      tyres,
      minDays: days.length ? Math.min(...days) : null,
      confidence: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null,
    })
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(a.asset_no).localeCompare(String(b.asset_no)))
}

/** Count of assets per risk level, in RISK_LEVELS order. */
export function riskDistribution(assets = []) {
  const counts = { high: 0, medium: 0, low: 0, healthy: 0 }
  for (const a of assets) if (a.level && counts[a.level] != null) counts[a.level] += 1
  return RISK_LEVELS.map((level) => ({ level, label: RISK_LEVEL_LABEL[level], count: counts[level] }))
}

function isActivePlan(p) {
  return String(p?.status || 'active').toLowerCase() === 'active'
}

/**
 * Headline figures. `cost30` is null when `currencySafe` is false (All
 * countries), because summing SAR, AED and EGP is not a quantity of anything.
 */
export function overviewKpis({ assets = [], predictions = [], pmPrograms = [], now = new Date(), currencySafe = true }) {
  const soon = predictions.filter((p) => num(p.days_away) != null && p.days_away <= PREDICTED_FAILURE_DAYS)
  let pmDue = 0
  for (const p of pmPrograms) {
    if (!isActivePlan(p) || !p.next_due) continue
    const d = daysBetween(p.next_due, now)
    if (d != null && d <= DUE_SOON_DAYS) pmDue += 1
  }
  const cost = soon.reduce((s, p) => s + (num(p.estimated_cost) || 0), 0)
  return {
    assetsMonitored: assets.length,
    highRisk: assets.filter((a) => a.level === 'high').length,
    predictedFailures: soon.length,
    dueForService: pmDue,
    cost30: currencySafe ? cost : null,
  }
}

/** Bucket a PM plan into a service type from its own name (never invented). */
export function serviceTypeFor(plan) {
  const t = `${plan?.name || ''} ${plan?.asset_category || ''}`.toLowerCase()
  if (/rotat/.test(t)) return 'rotation'
  if (/inspect|check|survey/.test(t)) return 'inspection'
  if (/tyre|tire/.test(t)) return 'tyre_service'
  return 'general'
}

export const SERVICE_SERIES = [
  { key: 'tyre', label: 'Tyre replacement' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'tyre_service', label: 'Tyre service' },
  { key: 'general', label: 'General service' },
]

function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }

/**
 * Maintenance demand for the next `months` calendar months (current month
 * first): predicted tyre replacements by due date + active PM plans by next due
 * date. Overdue PM plans fall into the current month. Series with no demand in
 * the window are dropped.
 */
export function maintenanceForecast({ predictions = [], pmPrograms = [], now = new Date(), months = 6 }) {
  const first = monthStart(now)
  const labels = []
  const starts = []
  for (let i = 0; i < months; i++) {
    const d = new Date(first.getFullYear(), first.getMonth() + i, 1)
    starts.push(d)
    labels.push(d.toLocaleString('en-US', { month: 'short' }))
  }
  const end = new Date(first.getFullYear(), first.getMonth() + months, 1)
  const idx = (date) => {
    const t = new Date(date)
    if (!Number.isFinite(t.getTime())) return -1
    if (t < first) return 0
    if (t >= end) return -1
    return (t.getFullYear() - first.getFullYear()) * 12 + (t.getMonth() - first.getMonth())
  }
  const values = Object.fromEntries(SERVICE_SERIES.map((s) => [s.key, new Array(months).fill(0)]))
  for (const p of predictions) {
    if (!p?.due_date) continue
    const i = idx(p.due_date)
    if (i >= 0) values.tyre[i] += 1
  }
  for (const plan of pmPrograms) {
    if (!isActivePlan(plan) || !plan.next_due) continue
    const i = idx(plan.next_due)
    if (i >= 0) values[serviceTypeFor(plan)][i] += 1
  }
  const series = SERVICE_SERIES
    .map((s) => ({ ...s, values: values[s.key] }))
    .filter((s) => s.values.some((v) => v > 0))
  const totals = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
  return { labels, starts, series, totals, max: Math.max(0, ...totals) }
}

function priorityFromDays(days) {
  if (days == null) return 'low'
  if (days <= 7) return 'high'
  if (days <= 14) return 'medium'
  return 'low'
}

function canonPriority(p) {
  const v = String(p || '').toLowerCase()
  if (v === 'critical' || v === 'high') return 'high'
  if (v === 'medium') return 'medium'
  if (v === 'low') return 'low'
  return null
}

/**
 * Everything due in the next `days` days: PM plans (their own priority) and
 * the earliest predicted tyre replacement per asset (priority from days left:
 * 7 or fewer High, 8 to 14 Medium, later Low). Overdue items sort first.
 */
export function dueSoon({ predictions = [], pmPrograms = [], now = new Date(), days = DUE_SOON_DAYS, fleet = [] }) {
  const siteOf = new Map(fleet.filter((f) => f?.asset_no).map((f) => [f.asset_no, f.site]))
  const out = []
  for (const plan of pmPrograms) {
    if (!isActivePlan(plan) || !plan.next_due) continue
    const d = daysBetween(plan.next_due, now)
    if (d == null || d > days) continue
    out.push({
      key: `pm-${plan.id}`,
      source: 'pm',
      asset_no: plan.asset_no || plan.asset_type || null,
      site: plan.site || siteOf.get(plan.asset_no) || null,
      service: plan.name || 'Scheduled service',
      days: d,
      priority: canonPriority(plan.priority) || priorityFromDays(d),
      date: plan.next_due,
    })
  }
  const earliest = new Map()
  for (const p of predictions) {
    const d = num(p.days_away)
    if (!p?.asset_no || d == null || d > days) continue
    const cur = earliest.get(p.asset_no)
    if (!cur || d < cur.d) earliest.set(p.asset_no, { d, p, n: (cur?.n || 0) + 1 })
    else cur.n += 1
  }
  for (const [asset, { d, p, n }] of earliest) {
    out.push({
      key: `tyre-${asset}`,
      source: 'tyre',
      asset_no: asset,
      site: p.site && p.site !== '-' ? p.site : (siteOf.get(asset) || null),
      service: 'Tyre replacement',
      detail: n > 1 ? `${n} tyres` : null,
      days: d,
      priority: priorityFromDays(d),
      date: p.due_date,
    })
  }
  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => a.days - b.days || rank[a.priority] - rank[b.priority])
}

/**
 * Tyre removals per month over the last `months` months (by removal_date), and
 * the subset removed before the fleet average life (early removals). This is
 * the only honest history available: composite health scores are not stored.
 */
export function removalTrend(records = [], now = new Date(), months = 6, avgKmLife = null) {
  const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const labels = []
  for (let i = 0; i < months; i++) labels.push(new Date(first.getFullYear(), first.getMonth() + i, 1).toLocaleString('en-US', { month: 'short' }))
  const all = new Array(months).fill(0)
  const early = new Array(months).fill(0)
  let lifeKnown = 0
  for (const r of records) {
    if (!r?.removal_date) continue
    const t = new Date(r.removal_date)
    if (!Number.isFinite(t.getTime())) continue
    const i = (t.getFullYear() - first.getFullYear()) * 12 + (t.getMonth() - first.getMonth())
    if (i < 0 || i >= months) continue
    all[i] += 1
    const life = num(r.km_at_removal) != null && num(r.km_at_fitment) != null ? num(r.km_at_removal) - num(r.km_at_fitment) : null
    if (life != null && life > 0 && avgKmLife) {
      lifeKnown += 1
      if (life < avgKmLife) early[i] += 1
    }
  }
  const total = all.reduce((a, b) => a + b, 0)
  return { labels, all, early: lifeKnown ? early : null, total }
}

/** Predicted replacements within `horizonDays`, grouped by the factor that limits them. */
export function failureTypes(predictions = [], horizonDays = 180) {
  const counts = new Map()
  for (const p of predictions) {
    const d = num(p.days_away)
    if (d == null || d > horizonDays) continue
    const label = LIMITING_LABEL[p.limiting_factor] || 'Not enough data'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

/**
 * Recommendations, one per asset that needs action: a tyre due for
 * replacement within RECOMMEND_DAYS (or already below the replacement tread
 * target), or a Medium/High composite risk that is not yet due (inspect).
 * `openJobs` = Set of asset numbers that already have an open work order.
 */
export function buildRecommendations({ assets = [], predictions = [], openJobs = new Set(), currencySafe = true }) {
  const predByAsset = new Map()
  for (const p of predictions) {
    if (!p?.asset_no) continue
    const list = predByAsset.get(p.asset_no) || []
    list.push(p)
    predByAsset.set(p.asset_no, list)
  }
  const recs = []
  for (const a of assets) {
    const preds = predByAsset.get(a.asset_no) || []
    const due = preds.filter((p) => (num(p.days_away) != null && p.days_away <= RECOMMEND_DAYS)
      || (num(p.tread_depth) != null && p.tread_depth < REPLACE_TARGET_MM))
    const risky = a.level === 'high' || a.level === 'medium'
    if (!due.length && !risky) continue
    let type; let text; let benefit; let target; let cost = null; let conf
    if (due.length) {
      type = 'replace'
      const positions = [...new Set(due.map((p) => p.position).filter((x) => x && x !== '-'))]
      const reasons = [...new Set(due.map((p) => LIMITING_LABEL[p.limiting_factor]).filter(Boolean))]
      const what = due.length === 1 ? `Replace ${positions[0] ? `${positions[0]} tyre` : '1 tyre'}` : `Replace ${due.length} tyres`
      text = reasons.length ? `${what} (${reasons.join(', ').toLowerCase()})` : what
      benefit = 'Avoid an in-service tyre failure'
      target = due.reduce((m, p) => (m == null || p.days_away < m ? p.days_away : m), null)
      const sum = due.reduce((s, p) => s + (num(p.estimated_cost) || 0), 0)
      cost = currencySafe && sum > 0 ? sum : null
      const c = due.map((p) => num(p.confidence)).filter((x) => x != null)
      conf = c.length ? c.reduce((x, y) => x + y, 0) / c.length : null
    } else {
      type = 'inspect'
      text = `Inspect ${a.position ? `${a.position} tyre` : 'tyres'}${a.issue ? ` (${a.issue.toLowerCase()})` : ''}`
      benefit = 'Catch a developing fault early'
      target = a.minDays
      conf = a.confidence
    }
    recs.push({
      id: `${a.asset_no}-${type}`,
      asset_no: a.asset_no,
      make: a.make,
      model: a.model,
      site: a.site,
      type,
      text,
      benefit,
      cost,
      confidence: conf,
      level: a.level,
      score: a.score,
      targetDays: target,
      status: openJobs.has(a.asset_no) ? 'job_open' : 'no_job',
    })
  }
  const rank = { high: 0, medium: 1, low: 2, healthy: 3 }
  return recs.sort((x, y) => (rank[x.level] ?? 4) - (rank[y.level] ?? 4)
    || (x.targetDays ?? 1e9) - (y.targetDays ?? 1e9))
}

/** Apply the recommendation filters (level, type, site). 'all' means no filter. */
export function filterRecommendations(recs = [], { level = 'all', type = 'all', site = 'all' } = {}) {
  return recs.filter((r) => (level === 'all' || r.level === level)
    && (type === 'all' || r.type === type)
    && (site === 'all' || r.site === site))
}
