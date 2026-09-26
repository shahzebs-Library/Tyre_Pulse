/**
 * Tyre Position Intelligence - pure engine behind /position-intelligence.
 *
 * WHAT THE PAGE USED TO MEASURE, AND WHY IT HAD TO CHANGE.
 * The old page computed a "failure rate" per axle from tyre_records.risk_level.
 * Measured live on 2026-09-26: risk_level is populated on 0 of 11,284 tyre
 * records, so every position printed 0% failure - a perfect fleet built from no
 * data. kpiEngine.computeFailureRate already refuses that (it rates only the
 * rated subset and returns null otherwise), so this page must too.
 *
 * The signal that DOES exist is the removal reason (4,057 of 11,284 rows). A
 * removal whose reason names a failure (damage / puncture / burst / blast / cut /
 * bulge / separation / flat) is a failure removal; a removal for wear is the
 * tyre doing its job. The failure stems are NOT re-declared here: they are
 * inspectionTyreFlags.isSevereCondition, the same stems the inspection flags
 * use, matched by stem so "Blast", "BURST" and "side wall damage" all land.
 * A brand stored in removal_reason (the UAE import misalignment) is not a
 * reason and is dropped through removalReason.cleanRemovalReason.
 *
 * CPK and life are NOT recomputed here - kpiEngine.computeCpkFleet /
 * computeAvgTyreLife own those formulas and both return honest nulls.
 *
 * Tyre price totals here are the RECORDED per-tyre price on tyre_records. The
 * authoritative tyre spend lives in the expense grid (loadCostSplit); a
 * position cannot be derived from the grid, so the page labels this figure as
 * the recorded price, never as spend.
 *
 * Pure: no I/O, no clock unless `now` is passed in.
 */
import { AXLE_GROUPS, normalizePosition, canonicalCode, describePosition } from './tyrePositions'
import { computeCpkFleet, computeAvgTyreLife } from './kpiEngine'
import { cleanRemovalReason } from './removalReason'
import { isSevereCondition } from './inspectionTyreFlags'

export { AXLE_GROUPS }

const txt = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null)

/**
 * Functional axle group for any position token the fleet stores.
 *
 * tyrePositions.normalizePosition handles the canonical grammar (LHF1, RHRO,
 * LHR1-O). Two real vocabularies fall through it to 'Other':
 *   - the ERP dual-rear codes LHRCO / RHRRO / LHRCI (Rear-Centre, Rear-Rear)
 *   - the field app's slot ids F1L / R2Ri (F = front axle, R = rear axle)
 * Both carry an unambiguous axle letter, so they are mapped rather than lost.
 */
export function positionGroup(raw) {
  const s = txt(raw).toUpperCase().replace(/\s+/g, '')
  if (!s) return 'Other'
  const g = normalizePosition(s)
  if (g !== 'Other') return g
  const erp = s.match(/^[LR]H?([FCR])/)
  if (erp) return erp[1] === 'F' ? 'Steer' : 'Drive'
  const slot = s.match(/^([FR])\d/)
  if (slot) return slot[1] === 'F' ? 'Steer' : 'Drive'
  return 'Other'
}

/** The position column the row actually carries (position, else tyre_position). */
export function positionOf(r) {
  return txt(r?.position) || txt(r?.tyre_position) || null
}

/**
 * Import bookkeeping written INTO removal_reason by the loaders, not a reason
 * anyone recorded ("TWO CURRENT TYRES - MANUAL REVIEW" 447 rows,
 * "REMOVED (FITMENT PREDATES EXPORT)"). Counting them as reasons would dilute
 * every failure rate with rows nobody explained.
 */
const SYSTEM_MARKER_RE = /manual review|predates export|^reason$/i

/**
 * Classify one removal reason.
 * @returns {'failure'|'wear'|'other'|null} null when no usable reason was recorded
 */
export function removalClass(reason) {
  const clean = cleanRemovalReason(reason)
  if (!clean || SYSTEM_MARKER_RE.test(clean)) return null
  // SEPRATION is how the ERP spells it on 53 live rows; the shared stem is
  // `separat`, which the misspelling never reaches.
  if (isSevereCondition(clean) || /sep[ae]?rat/i.test(clean)) return 'failure'
  if (/wear|worn|end of life/i.test(clean)) return 'wear'
  return 'other'
}

export function isRemoved(r) {
  return Boolean(r?.removal_date) || num(r?.km_at_removal) != null
}

function recordedPrice(r) {
  const c = num(r?.cost_per_tyre)
  if (c == null || c <= 0) return null
  const q = num(r?.qty)
  return c * (q && q > 0 ? q : 1)
}

/** Shared per-group aggregate. */
function summarize(recs) {
  const count = recs.length
  let removed = 0
  let withReason = 0
  let failures = 0
  let wear = 0
  let priced = 0
  let price = 0
  const reasonCounts = {}
  for (const r of recs) {
    if (isRemoved(r)) removed += 1
    const cls = removalClass(r.removal_reason)
    if (cls) {
      withReason += 1
      if (cls === 'failure') failures += 1
      if (cls === 'wear') wear += 1
      const key = cleanRemovalReason(r.removal_reason).toUpperCase()
      reasonCounts[key] = (reasonCounts[key] || 0) + 1
    }
    const p = recordedPrice(r)
    if (p != null) { priced += 1; price += p }
  }
  const cpk = computeCpkFleet(recs)
  const life = computeAvgTyreLife(recs)
  return {
    count,
    removed,
    withReason,
    failures,
    wear,
    // null, never 0, when no removal carried a usable reason
    failureRatePct: pct(failures, withReason),
    wearRatePct: pct(wear, withReason),
    reasonCoveragePct: pct(withReason, removed),
    avgCpk: cpk.fleetAvgCpk,
    cpkSample: cpk.validCount,
    avgLifeKm: life.validCount > 0 ? life.avgKm : null,
    medianLifeKm: life.validCount > 0 ? life.medianKm : null,
    lifeSample: life.validCount,
    pricedCount: priced,
    recordedPrice: priced > 0 ? price : null,
    avgPrice: priced > 0 ? price / priced : null,
    topReasons: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([reason, n]) => ({ reason, count: n })),
  }
}

/** Metrics per axle group, in AXLE_GROUPS order, only groups that hold records. */
export function groupMetrics(records = []) {
  const byGroup = {}
  for (const r of records) {
    const g = positionGroup(positionOf(r))
    ;(byGroup[g] ||= []).push(r)
  }
  const total = records.length
  return AXLE_GROUPS
    .filter((g) => byGroup[g]?.length)
    .map((g) => ({ group: g, sharePct: pct(byGroup[g].length, total), ...summarize(byGroup[g]) }))
}

/** Metrics per individual wheel position (canonical code), worst failure rate first. */
export function positionCodeMetrics(records = []) {
  const byCode = {}
  for (const r of records) {
    const raw = positionOf(r)
    if (!raw) continue
    const code = canonicalCode(raw.toUpperCase().replace(/\s+/g, '')) || raw
    ;(byCode[code] ||= []).push(r)
  }
  return Object.entries(byCode)
    .map(([code, recs]) => ({
      code,
      label: describePosition(code),
      group: positionGroup(code),
      ...summarize(recs),
    }))
    .sort((a, b) =>
      (b.failureRatePct ?? -1) - (a.failureRatePct ?? -1)
      || b.count - a.count
      || a.code.localeCompare(b.code))
}

/** Site x axle-group failure-rate matrix. Cells are null when no reason was recorded. */
export function siteGroupMatrix(records = [], { maxSites = 20 } = {}) {
  const bySite = {}
  for (const r of records) {
    const site = txt(r.site) || 'Unknown'
    ;(bySite[site] ||= []).push(r)
  }
  const sites = Object.keys(bySite).sort((a, b) => bySite[b].length - bySite[a].length).slice(0, maxSites)
  const groups = AXLE_GROUPS.filter((g) => records.some((r) => positionGroup(positionOf(r)) === g))
  const rows = sites.map((site) => {
    const row = { site, count: bySite[site].length }
    for (const g of groups) {
      const recs = bySite[site].filter((r) => positionGroup(positionOf(r)) === g)
      const s = summarize(recs)
      row[g] = recs.length ? { count: recs.length, failureRatePct: s.failureRatePct, withReason: s.withReason } : null
    }
    return row
  })
  return { groups, rows }
}

/** Brand performance inside one axle group. */
export function brandsForGroup(records = [], group) {
  const byBrand = {}
  for (const r of records) {
    if (group && positionGroup(positionOf(r)) !== group) continue
    const b = txt(r.brand).toUpperCase() || 'NOT RECORDED'
    ;(byBrand[b] ||= []).push(r)
  }
  return Object.entries(byBrand)
    .map(([brand, recs]) => ({ brand, ...summarize(recs) }))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand))
}

/** Assets with the most failure removals inside a group (or overall). */
export function assetsForGroup(records = [], group, { limit = 50 } = {}) {
  const byAsset = {}
  for (const r of records) {
    if (group && positionGroup(positionOf(r)) !== group) continue
    const a = txt(r.asset_no).toUpperCase()
    if (!a) continue
    ;(byAsset[a] ||= []).push(r)
  }
  return Object.entries(byAsset)
    .map(([asset_no, recs]) => ({
      asset_no,
      site: txt(recs[0]?.site) || null,
      ...summarize(recs),
    }))
    .sort((a, b) => b.failures - a.failures || b.count - a.count || a.asset_no.localeCompare(b.asset_no))
    .slice(0, limit)
}

function monthKey(d) {
  const m = txt(d).match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : null
}

/** Last N months of removals per axle group (by removal_date). */
export function monthlyRemovals(records = [], { now = Date.now(), months = 12 } = {}) {
  const base = new Date(now)
  const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const groups = AXLE_GROUPS.filter((g) => records.some((r) => positionGroup(positionOf(r)) === g))
  const counts = Object.fromEntries(groups.map((g) => [g, Object.fromEntries(keys.map((k) => [k, 0]))]))
  const failures = Object.fromEntries(keys.map((k) => [k, 0]))
  for (const r of records) {
    const k = monthKey(r.removal_date)
    if (!k || !keys.includes(k)) continue
    const g = positionGroup(positionOf(r))
    if (counts[g]) counts[g][k] += 1
    if (removalClass(r.removal_reason) === 'failure') failures[k] += 1
  }
  return {
    months: keys,
    series: groups.map((g) => ({ group: g, data: keys.map((k) => counts[g][k]) })),
    failures: keys.map((k) => failures[k]),
  }
}

/** Filter the raw records. Dates compare against issue_date (the fitment record date). */
export function filterRecords(records = [], { site = '', group = '', brand = '', from = '', to = '', search = '' } = {}) {
  const q = txt(search).toLowerCase()
  return records.filter((r) => {
    if (site && txt(r.site) !== site) return false
    if (group && positionGroup(positionOf(r)) !== group) return false
    if (brand && txt(r.brand).toUpperCase() !== brand) return false
    const d = txt(r.issue_date).slice(0, 10)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    if (q) {
      const hay = `${txt(r.asset_no)} ${txt(r.serial_no)} ${txt(r.site)} ${txt(r.brand)} ${positionOf(r) || ''} ${txt(r.removal_reason)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Headline figures across the filtered set. */
export function fleetPositionKpis(records = []) {
  const all = summarize(records)
  const groups = groupMetrics(records)
  const rated = groups.filter((g) => g.failureRatePct != null && g.withReason >= 5)
  const worst = rated.length ? rated.reduce((a, b) => (b.failureRatePct > a.failureRatePct ? b : a)) : null
  const lived = groups.filter((g) => g.avgLifeKm != null && g.lifeSample >= 5)
  const shortest = lived.length ? lived.reduce((a, b) => (b.avgLifeKm < a.avgLifeKm ? b : a)) : null
  const positioned = records.filter((r) => positionGroup(positionOf(r)) !== 'Other').length
  return {
    ...all,
    positionCoveragePct: pct(positioned, records.length),
    unplaced: records.length - positioned,
    worstGroup: worst ? { group: worst.group, failureRatePct: worst.failureRatePct, sample: worst.withReason } : null,
    shortestLifeGroup: shortest ? { group: shortest.group, avgLifeKm: shortest.avgLifeKm, sample: shortest.lifeSample } : null,
  }
}

/**
 * Plain-English findings derived only from measured figures. Every line names
 * the sample it rests on; a figure resting on fewer than `minSample` is not
 * turned into a finding at all.
 */
export function positionInsights(records = [], { minSample = 10 } = {}) {
  const out = []
  const k = fleetPositionKpis(records)
  if (!records.length) return out
  if (k.reasonCoveragePct != null && k.reasonCoveragePct < 50) {
    out.push({
      priority: 'High',
      message: `Only ${Math.round(k.reasonCoveragePct)}% of the ${k.removed.toLocaleString()} removals record a usable reason, so failure rates rest on a partial sample. Make the removal reason mandatory at tyre change.`,
    })
  }
  if (k.unplaced > 0) {
    out.push({
      priority: 'Medium',
      message: `${k.unplaced.toLocaleString()} tyre records carry no readable wheel position and are grouped as Other.`,
    })
  }
  for (const g of groupMetrics(records)) {
    if (g.failureRatePct != null && g.withReason >= minSample && k.failureRatePct != null
      && g.failureRatePct >= k.failureRatePct * 1.25 && g.failureRatePct >= 10) {
      const hint = g.group === 'Steer'
        ? 'Check alignment and steer inflation.'
        : g.group === 'Drive'
          ? 'Check load compliance, dual matching and inflation.'
          : 'Check inflation and road damage on this axle.'
      out.push({
        priority: g.failureRatePct >= 30 ? 'Critical' : 'High',
        message: `${g.group} axle: ${g.failureRatePct.toFixed(1)}% of reasoned removals were failures (fleet ${k.failureRatePct.toFixed(1)}%, ${g.withReason} removals). ${hint}`,
      })
    }
  }
  const codes = positionCodeMetrics(records).filter((c) => c.withReason >= minSample && c.failureRatePct != null)
  if (codes.length >= 2) {
    const top = codes[0]
    out.push({
      priority: 'Medium',
      message: `Highest failure share at a single wheel: ${top.code} (${top.label}) at ${top.failureRatePct.toFixed(1)}% of ${top.withReason} reasoned removals.`,
    })
  }
  if (k.lifeSample < minSample) {
    out.push({
      priority: 'Medium',
      message: 'Too few tyres carry both a fitment and a removal odometer reading to compare tyre life by position.',
    })
  }
  const order = { Critical: 0, High: 1, Medium: 2 }
  return out.sort((a, b) => order[a.priority] - order[b.priority])
}

/** Flat export rows for the per-position table. */
export function positionExportRows(records = []) {
  return positionCodeMetrics(records).map((c) => ({
    code: c.code,
    label: c.label,
    group: c.group,
    count: c.count,
    removed: c.removed,
    withReason: c.withReason,
    failures: c.failures,
    failureRatePct: c.failureRatePct == null ? 'N/A' : Number(c.failureRatePct.toFixed(1)),
    avgLifeKm: c.avgLifeKm == null ? 'N/A' : Math.round(c.avgLifeKm),
    avgCpk: c.avgCpk == null ? 'N/A' : Number(c.avgCpk.toFixed(4)),
    topReason: c.topReasons[0]?.reason || 'N/A',
  }))
}

export const POSITION_EXPORT_COLS = ['code', 'label', 'group', 'count', 'removed', 'withReason', 'failures', 'failureRatePct', 'avgLifeKm', 'avgCpk', 'topReason']
export const POSITION_EXPORT_HEADERS = ['Position', 'Description', 'Axle group', 'Tyre records', 'Removed', 'Removals with reason', 'Failure removals', 'Failure rate %', 'Avg life km', 'Avg CPK', 'Top reason']
