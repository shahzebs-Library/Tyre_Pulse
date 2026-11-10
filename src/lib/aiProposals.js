/**
 * aiProposals.js - THE detector engine for AI-prepared proposals.
 *
 * A proposal is a suggestion a person approves or rejects. Nothing here buys,
 * edits a source record, approves safety, closes an inspection or submits a
 * warranty claim. Accepting a proposal (server RPC ai_proposal_decide) only
 * records the decision and, when asked, opens a corrective action through the
 * existing corrective_actions path.
 *
 * Detection is deterministic and pure (no I/O, no LLM, explicit `now`), so the
 * same inputs always yield the same proposals and the same dedupe keys. The
 * dedupe key is the identity of a finding: re-running the scan refreshes an
 * open proposal instead of creating a second one.
 *
 * Reuses, never re-derives:
 *   - tyre km/life:     tyreKmAssessment / tyreLifeCapKm (src/lib/tyreKm.js)
 *   - warranty reasons: buildWarrantyCandidates (src/lib/warrantyTrackerAnalytics.js)
 *   - severe findings:  severePositions (src/lib/inspectionTyreFlags.js)
 *   - running-life due: isDueRow / measureFor (src/lib/tyreRunningLife.js)
 *   - strong serials:   isStrongSerial (src/lib/tyreLifetime.js)
 */
import { tyreKmAssessment } from './tyreKm'
import { buildWarrantyCandidates, classifyRemovalReason } from './warrantyTrackerAnalytics'
import { severePositions } from './inspectionTyreFlags'
import { isDueRow, measureFor } from './tyreRunningLife'
import { isStrongSerial } from './tyreLifetime'

export const DETECTOR_VERSION = 'ai-proposals-v1'

/** Proposal types. MIRROR of the CHECK on public.ai_proposals.proposal_type. */
export const PROPOSAL_TYPES = Object.freeze([
  'critical_finding_no_action',
  'repeated_failure',
  'cpk_spike',
  'abnormal_consumption',
  'premature_removal',
  'warranty_opportunity',
  'overdue_corrective_action',
  'tyre_overdue_no_action',
  'data_integrity',
])

export const PROPOSAL_TYPE_LABEL = Object.freeze({
  critical_finding_no_action: 'Critical finding with no action',
  repeated_failure: 'Repeated failure on one wheel',
  cpk_spike: 'Cost per km / hour spike',
  abnormal_consumption: 'Abnormal monthly tyre consumption',
  premature_removal: 'Premature tyre removal',
  warranty_opportunity: 'Warranty opportunity',
  overdue_corrective_action: 'Overdue corrective action',
  tyre_overdue_no_action: 'Tyre past expected life, no action',
  data_integrity: 'Data integrity issue',
})

/** Severities. MIRROR of the CHECK on public.ai_proposals.severity. */
export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low'])
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 }

export const DEFAULTS = Object.freeze({
  repeatWindowDays: 180,
  repeatMinCount: 2,
  cpkSpikeShare: 0.25,
  cpkSpikeHighShare: 0.5,
  consumptionMinHistory: 3,
  consumptionHistoryMonths: 6,
  consumptionRatio: 1.5,
  consumptionMinCount: 5,
  prematureShare: 0.4,
  overdueHighDays: 14,
  maxEvidence: 50,
  maxPerType: 50,
})

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const txt = (v) => (v == null ? '' : String(v).trim())
const up = (v) => txt(v).toUpperCase()
const day = (v) => (v ? String(v).slice(0, 10) : '')
const toTime = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const DAY_MS = 86400000
const asNow = (now) => (now instanceof Date ? now : new Date(now ?? Date.now()))
const isoDay = (d) => d.toISOString().slice(0, 10)

const ACTION_CLOSED = new Set(['closed', 'resolved', 'cancelled'])
export const isActionOpen = (a) => !ACTION_CLOSED.has(txt(a?.status).toLowerCase())

/** Stable, order-independent evidence list (unique ids, capped). */
function evidenceList(items, max) {
  const seen = new Set()
  const out = []
  for (const it of items) {
    if (!it || !it.id) continue
    const k = `${it.table}:${it.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ table: it.table, id: String(it.id) })
  }
  out.sort((a, b) => (a.table + a.id).localeCompare(b.table + b.id))
  return out.slice(0, max)
}

function proposal({ type, severity, dedupeKey, title, summary, recommendedAction, refs = {}, evidence = [], country = null, site = null, metrics = {} }, cfg) {
  return {
    proposal_type: type,
    severity,
    dedupe_key: dedupeKey,
    title: txt(title).slice(0, 240),
    summary: txt(summary).slice(0, 2000),
    recommended_action: txt(recommendedAction).slice(0, 2000),
    entity_refs: refs,
    evidence: evidenceList(evidence, cfg.maxEvidence),
    evidence_total: evidence.length,
    metrics,
    country: country || null,
    site: site || null,
    detector_version: DETECTOR_VERSION,
  }
}

// ---------------------------------------------------------------------------
// 1. critical inspection findings without a corrective action
// ---------------------------------------------------------------------------
export function detectCriticalFindingsWithoutAction({ inspections = [], correctiveActions = [] } = {}, cfg = DEFAULTS) {
  const covered = new Set()
  for (const a of correctiveActions) {
    if (a?.source_id && (a.source_type === 'inspection' || !a.source_type)) covered.add(String(a.source_id))
  }
  const out = []
  for (const insp of inspections) {
    if (!insp?.id) continue
    const severe = severePositions(insp)
    if (!severe.length) continue
    if (covered.has(String(insp.id))) continue
    const positions = severe.map((d) => d.position || 'unknown position')
    out.push(proposal({
      type: 'critical_finding_no_action',
      severity: 'critical',
      dedupeKey: `critical_finding:${insp.id}`,
      title: `Critical tyre finding on ${insp.asset_no || 'an asset'} has no corrective action`,
      summary: `Inspection on ${day(insp.inspection_date || insp.created_at) || 'an unknown date'} recorded `
        + `${severe.map((d) => `${d.condition} at ${d.position || 'unknown position'}`).join(', ')}, `
        + 'and no corrective action is linked to it.',
      recommendedAction: 'Raise a corrective action for each severe position and decide whether the vehicle must stop.',
      refs: { asset_no: insp.asset_no || null, inspection_id: insp.id, positions },
      evidence: [{ table: 'inspections', id: insp.id }],
      country: insp.country, site: insp.site,
      metrics: { severe_positions: severe.length },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 2. repeated failures on the same asset + position
// ---------------------------------------------------------------------------
const FAILURE_RE = /puncture|cut|damage|burst|blast|blow|separat|seprat|bulge|bead|defect|flat/i
export function isFailureRemoval(reason) {
  const r = txt(reason)
  if (!r) return false
  if (/normal/i.test(r)) return false
  const cls = classifyRemovalReason(r)
  if (cls && cls.kind !== 'premature_wear') return true
  return FAILURE_RE.test(r)
}

export function detectRepeatedFailures({ tyres = [] } = {}, cfg = DEFAULTS, now = new Date()) {
  const since = asNow(now).getTime() - cfg.repeatWindowDays * DAY_MS
  const groups = new Map()
  for (const t of tyres) {
    if (!t?.asset_no || !t?.tyre_position) continue
    const when = toTime(t.removal_date)
    if (when == null || when < since) continue
    if (!isFailureRemoval(t.removal_reason)) continue
    const key = `${up(t.country)}|${up(t.asset_no)}|${up(t.tyre_position)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const out = []
  for (const [key, rows] of groups) {
    if (rows.length < cfg.repeatMinCount) continue
    const first = rows[0]
    const reasons = [...new Set(rows.map((r) => txt(r.removal_reason)).filter(Boolean))]
    out.push(proposal({
      type: 'repeated_failure',
      severity: rows.length >= 3 ? 'high' : 'medium',
      dedupeKey: `repeat_failure:${key}`,
      title: `${rows.length} failures on ${first.asset_no} ${first.tyre_position} in ${cfg.repeatWindowDays} days`,
      summary: `Tyres on ${first.asset_no} position ${first.tyre_position} were removed ${rows.length} times `
        + `for failure (${reasons.join(', ')}). A repeating failure on one wheel usually points to the wheel, `
        + 'not the tyre.',
      recommendedAction: 'Check alignment, rim, suspension and inflation on this wheel position before fitting another tyre.',
      refs: { asset_no: first.asset_no, position: first.tyre_position },
      evidence: rows.map((r) => ({ table: 'tyre_records', id: r.id })),
      country: first.country, site: first.site,
      metrics: { failures: rows.length },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 3. cost per km spike vs prior window
// ---------------------------------------------------------------------------
/**
 * windows: [{ scope, country, currency, current, prior, period, unit: 'km'|'hours' }]
 * `current`/`prior` are CPK figures in ONE currency; a null side is skipped.
 */
export function detectCpkSpikes({ cpkWindows = [] } = {}, cfg = DEFAULTS) {
  const out = []
  for (const w of cpkWindows) {
    const cur = num(w?.current)
    const prior = num(w?.prior)
    if (cur == null || prior == null || prior <= 0) continue
    const change = cur / prior - 1
    if (change < cfg.cpkSpikeShare) continue
    const pct = Math.round(change * 100)
    out.push(proposal({
      type: 'cpk_spike',
      severity: change >= cfg.cpkSpikeHighShare ? 'high' : 'medium',
      dedupeKey: `cpk_spike:${up(w.country)}|${txt(w.scope) || 'fleet'}|${w.unit === 'hours' ? 'hours' : 'km'}|${txt(w.period) || 'current'}`,
      title: `Cost per ${w.unit === 'hours' ? 'hour' : 'km'} up ${pct}% (${w.scope || 'fleet'})`,
      summary: `Cost per ${w.unit === 'hours' ? 'hour' : 'km'} for ${w.scope || 'the fleet'} rose from ${prior.toFixed(4)} to ${cur.toFixed(4)} `
        + `${w.currency ? `${w.currency} ` : ''}per ${w.unit === 'hours' ? 'hour' : 'km'} against the prior window.`,
      recommendedAction: 'Open CPK Intelligence, "Why it changed", to see whether price, volume, mix or utilisation drove the rise.',
      refs: { scope: w.scope || 'fleet', period: w.period || null, currency: w.currency || null },
      evidence: [],
      country: w.country,
      metrics: { current: cur, prior, change_pct: pct },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 4. abnormal monthly tyre consumption
// ---------------------------------------------------------------------------
/** rows: [{ month:'YYYY-MM', country, count }] - fitments (or tyres issued) per month. */
export function detectAbnormalConsumption({ monthlyConsumption = [] } = {}, cfg = DEFAULTS) {
  const byCountry = new Map()
  for (const r of monthlyConsumption) {
    const m = txt(r?.month).slice(0, 7)
    const c = num(r?.count)
    if (!/^\d{4}-\d{2}$/.test(m) || c == null) continue
    const k = up(r.country) || 'ALL'
    if (!byCountry.has(k)) byCountry.set(k, new Map())
    const mm = byCountry.get(k)
    mm.set(m, (mm.get(m) || 0) + c)
  }
  const out = []
  for (const [country, mm] of byCountry) {
    const months = [...mm.keys()].sort()
    if (months.length < cfg.consumptionMinHistory + 1) continue
    const latest = months[months.length - 1]
    const history = months.slice(0, -1).slice(-cfg.consumptionHistoryMonths).map((m) => mm.get(m))
    if (history.length < cfg.consumptionMinHistory) continue
    const mean = history.reduce((a, b) => a + b, 0) / history.length
    const sd = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length)
    const value = mm.get(latest)
    if (mean <= 0 || value < cfg.consumptionMinCount) continue
    if (value < mean * cfg.consumptionRatio || value <= mean + 2 * sd) continue
    const ratio = value / mean
    out.push(proposal({
      type: 'abnormal_consumption',
      severity: ratio >= 2 ? 'high' : 'medium',
      dedupeKey: `consumption:${country}|${latest}`,
      title: `Tyre consumption ${latest} is ${ratio.toFixed(1)}x the recent average (${country})`,
      summary: `${value} tyres in ${latest} against an average of ${mean.toFixed(1)} over the previous `
        + `${history.length} months. Check whether this is a real rise, a catch-up upload or a duplicate load.`,
      recommendedAction: 'Review the month\'s fitments by site and asset; confirm the upload was not loaded twice before acting on the figure.',
      refs: { month: latest },
      evidence: [],
      country: country === 'ALL' ? null : country,
      metrics: { value, mean: Number(mean.toFixed(2)), sd: Number(sd.toFixed(2)), ratio: Number(ratio.toFixed(2)) },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 5 + 6. premature removals and warranty opportunities
// ---------------------------------------------------------------------------
export function detectWarrantyOpportunities({ tyres = [], warrantyClaims = [] } = {}, cfg = DEFAULTS) {
  return buildWarrantyCandidates(tyres, warrantyClaims)
    .filter((c) => c.kind === 'defect')
    .map((c) => proposal({
      type: 'warranty_opportunity',
      severity: c.km_known ? 'medium' : 'low',
      dedupeKey: `warranty:${c.id}`,
      title: `Warranty candidate: ${c.serial_number || 'tyre'} on ${c.asset_no || 'unknown asset'} (${c.failure_type})`,
      summary: `Removed ${day(c.removal_date) || 'on an unknown date'} for "${c.removal_reason}"`
        + (c.km_known
          ? ` after ${Math.round(c.km_run).toLocaleString('en-US')} km, ${Math.round(c.life_pct)}% of the ${c.expected_life_km.toLocaleString('en-US')} km class life.`
          : '. Distance run is not recorded, so the claim needs the km confirmed first.'),
      recommendedAction: 'Review the tyre and its evidence; if it qualifies, raise the claim yourself in the Warranty Tracker. Nothing is submitted automatically.',
      refs: { asset_no: c.asset_no, serial_no: c.serial_number, position: c.position, tyre_id: c.id },
      evidence: [{ table: 'tyre_records', id: c.id }],
      country: c.country, site: c.site,
      metrics: { km_run: c.km_run, life_pct: c.life_pct == null ? null : Math.round(c.life_pct) },
    }, cfg))
}

export function detectPrematureRemovals({ tyres = [] } = {}, cfg = DEFAULTS) {
  const out = []
  for (const t of tyres) {
    if (!t?.id || !t.removal_date) continue
    // A manufacturing-type reason is the warranty detector's job, not this one.
    const cls = classifyRemovalReason(t.removal_reason)
    if (cls && cls.kind === 'defect') continue
    const a = tyreKmAssessment(t)
    if (a.km == null || (a.status !== 'measured' && a.status !== 'factory')) continue
    if (a.km >= a.cap * cfg.prematureShare) continue
    const pct = Math.round((a.km / a.cap) * 100)
    out.push(proposal({
      type: 'premature_removal',
      severity: pct < 15 ? 'high' : 'medium',
      dedupeKey: `premature:${t.id}`,
      title: `Tyre ${t.serial_no || ''} removed at ${pct}% of class life (${t.asset_no || 'unknown asset'})`.replace(/\s+/g, ' '),
      summary: `Ran ${Math.round(a.km).toLocaleString('en-US')} km against a ${a.cap.toLocaleString('en-US')} km class ceiling, `
        + `removed ${day(t.removal_date)} for "${txt(t.removal_reason) || 'no reason recorded'}".`,
      recommendedAction: 'Find the root cause (inflation, alignment, load, road, driver) before the same position consumes another tyre.',
      refs: { asset_no: t.asset_no || null, serial_no: t.serial_no || null, position: t.tyre_position || null, tyre_id: t.id },
      evidence: [{ table: 'tyre_records', id: t.id }],
      country: t.country, site: t.site,
      metrics: { km_run: a.km, cap: a.cap, life_pct: pct },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 7. overdue corrective actions
// ---------------------------------------------------------------------------
export function detectOverdueActions({ correctiveActions = [] } = {}, cfg = DEFAULTS, now = new Date()) {
  const today = isoDay(asNow(now))
  const out = []
  for (const a of correctiveActions) {
    if (!a?.id || !isActionOpen(a)) continue
    if (a.source_type === 'ai_proposal' && !a.due_date) continue
    const due = day(a.due_date)
    if (!due || due >= today) continue
    const days = Math.round((toTime(today) - toTime(due)) / DAY_MS)
    out.push(proposal({
      type: 'overdue_corrective_action',
      severity: days > cfg.overdueHighDays || a.priority === 'High' ? 'high' : 'medium',
      dedupeKey: `overdue_action:${a.id}`,
      title: `Corrective action overdue ${days} day${days === 1 ? '' : 's'}: ${txt(a.title) || 'untitled'}`,
      summary: `Due ${due}, still ${txt(a.status) || 'Open'}${a.assigned_to ? `, assigned to ${a.assigned_to}` : ', not assigned'}.`,
      recommendedAction: a.assigned_to ? 'Follow up with the owner or re-plan the due date.' : 'Assign an owner and a realistic due date.',
      refs: { corrective_action_id: a.id, asset_no: a.asset_no || null },
      evidence: [{ table: 'corrective_actions', id: a.id }],
      country: a.country, site: a.site,
      metrics: { days_overdue: days },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 8. tyres past expected life with no open action (running life rule)
// ---------------------------------------------------------------------------
export function detectTyresOverdueNoAction({ runningLife = [], correctiveActions = [] } = {}, cfg = DEFAULTS) {
  // Rows are SHAPED running-life rows (shapeRow in tyreRunningLife.js).
  const openAssets = new Set(correctiveActions.filter(isActionOpen).map((a) => up(a.asset_no)).filter(Boolean))
  const out = []
  for (const r of runningLife) {
    if (!r || !isDueRow(r)) continue
    const m = measureFor(r)
    if (m.band !== 'overdue') continue
    if (!r.asset || openAssets.has(up(r.asset))) continue
    out.push(proposal({
      type: 'tyre_overdue_no_action',
      severity: 'high',
      dedupeKey: `tyre_overdue:${up(r.country)}|${up(r.asset)}|${up(r.position)}|${up(r.serial)}`,
      title: `Tyre past expected life on ${r.asset} ${r.position || ''}`.trim(),
      summary: `Running-life rule says tyre ${r.serial || '(no serial)'} is past its expected `
        + `${m.dimension === 'hours' ? 'hours' : 'km'} and the asset has no open corrective action.`,
      recommendedAction: 'Plan the replacement or record why it stays in service.',
      refs: { asset_no: r.asset, serial_no: r.serial || null, position: r.position || null },
      evidence: [],
      country: r.country, site: r.site,
      metrics: { used_pct: m.used == null ? null : Math.round(m.used) },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// 9. data integrity issues (one proposal per country per issue kind)
// ---------------------------------------------------------------------------
export function detectDataIntegrity({ tyres = [] } = {}, cfg = DEFAULTS) {
  const buckets = new Map()
  const add = (kind, country, id) => {
    const k = `${kind}|${up(country) || 'ALL'}`
    if (!buckets.has(k)) buckets.set(k, { kind, country: up(country) || null, ids: [] })
    buckets.get(k).ids.push(id)
  }
  const activeBySerial = new Map()
  for (const t of tyres) {
    if (!t?.id) continue
    const fit = day(t.fitment_date || t.issue_date)
    const rem = day(t.removal_date)
    if (fit && rem && rem < fit) add('reversed_dates', t.country, t.id)
    if (t.removal_date) {
      const a = tyreKmAssessment(t)
      if (a.status === 'placeholder') add('placeholder_km', t.country, t.id)
      if (a.status === 'over_cap') add('over_cap_km', t.country, t.id)
    }
    if (!t.removal_date && /active/i.test(txt(t.status)) && isStrongSerial(t.serial_no)) {
      const k = `${up(t.country)}|${up(t.serial_no)}`
      if (!activeBySerial.has(k)) activeBySerial.set(k, [])
      activeBySerial.get(k).push(t)
    }
  }
  for (const rows of activeBySerial.values()) {
    const assets = new Set(rows.map((r) => up(r.asset_no)))
    if (assets.size > 1) for (const r of rows) add('serial_two_assets', r.country, r.id)
  }
  const META = {
    reversed_dates: ['removal date before fitment date', 'Correct the dates on these tyre records; life and CPK are wrong until then.'],
    placeholder_km: ['fitment odometer typed as 1', 'Enter the real fitment odometer so tyre life can be measured.'],
    over_cap_km: ['tyre life above the class ceiling', 'Check the meters on these tyres; the life is a reading error.'],
    serial_two_assets: ['one serial active on two vehicles', 'Decide which vehicle holds the tyre and close the other fitment.'],
  }
  const out = []
  for (const b of buckets.values()) {
    const [label, action] = META[b.kind]
    out.push(proposal({
      type: 'data_integrity',
      severity: b.kind === 'serial_two_assets' ? 'high' : b.ids.length >= 20 ? 'medium' : 'low',
      dedupeKey: `data:${b.kind}|${b.country || 'ALL'}`,
      title: `${b.ids.length} tyre record${b.ids.length === 1 ? '' : 's'}: ${label}${b.country ? ` (${b.country})` : ''}`,
      summary: `${b.ids.length} tyre records have ${label}.`,
      recommendedAction: action,
      refs: { issue: b.kind },
      evidence: b.ids.map((id) => ({ table: 'tyre_records', id })),
      country: b.country,
      metrics: { count: b.ids.length },
    }, cfg))
  }
  return out
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------
export const sortProposals = (list) => [...list].sort((a, b) =>
  (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0)
  || String(a.proposal_type).localeCompare(String(b.proposal_type))
  || String(a.dedupe_key).localeCompare(String(b.dedupe_key)))

/**
 * Run every detector over the supplied data. Missing inputs simply produce no
 * proposals of that type. Result is deduped by key and capped per type
 * (worst first), so the queue cannot be flooded by one noisy detector.
 */
export function detectProposals(input = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.config || {}) }
  const now = options.now ?? new Date()
  const all = [
    ...detectCriticalFindingsWithoutAction(input, cfg),
    ...detectRepeatedFailures(input, cfg, now),
    ...detectCpkSpikes(input, cfg),
    ...detectAbnormalConsumption(input, cfg),
    ...detectPrematureRemovals(input, cfg),
    ...detectWarrantyOpportunities(input, cfg),
    ...detectOverdueActions(input, cfg, now),
    ...detectTyresOverdueNoAction(input, cfg),
    ...detectDataIntegrity(input, cfg),
  ]
  const byKey = new Map()
  for (const p of all) if (!byKey.has(p.dedupe_key)) byKey.set(p.dedupe_key, p)
  const perType = new Map()
  const out = []
  for (const p of sortProposals([...byKey.values()])) {
    const n = perType.get(p.proposal_type) || 0
    if (n >= cfg.maxPerType) continue
    perType.set(p.proposal_type, n + 1)
    out.push(p)
  }
  return out
}

/** Counts for tiles. */
export function summarizeProposals(list = []) {
  const s = { total: list.length, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, byType: {} }
  for (const p of list) {
    if (s.bySeverity[p.severity] != null) s.bySeverity[p.severity] += 1
    s.byType[p.proposal_type] = (s.byType[p.proposal_type] || 0) + 1
  }
  return s
}
