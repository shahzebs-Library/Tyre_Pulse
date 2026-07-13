/**
 * Claims analytics engine — the single calculation source for the Claims Summary
 * dashboard, its PDF/Excel export, and any future claims KPI surface.
 *
 * Operates on ACCIDENT records (the accidents table), where the insurance claim
 * lives embedded on the incident: claim_amount / claim_approved_amount /
 * deductible / recovered_amount / insurer / policy_no / claim_status plus the
 * GCC case fields (gcc_liability_ratio, fault_status, najm_status, taqdeer_status,
 * expected_release_date, release_date). This is deliberately distinct from the
 * standalone insurance_claims register (/insurance-claims) — that is a manual
 * CRUD ledger over a different table; this is live analytics over the claims that
 * ride on real accident records.
 *
 * Pure & deterministic (inject `now` for tests). Honest maths only — a value that
 * cannot be computed stays null/0, never fabricated.
 */

const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const s = (v) => String(v ?? '').trim()

/** An accident carries an insurance claim if it has money, a claim status, an
 *  insurer, or an insurance/claim-flavoured incident status. */
export function hasClaim(r) {
  return (
    N(r.claim_amount) > 0 ||
    N(r.claim_approved_amount) > 0 ||
    !!s(r.claim_status) ||
    !!s(r.insurer) ||
    /insurance|claim/i.test(s(r.status))
  )
}

/** Closed when released, or the incident/closure/claim status reads terminal. */
export function isClosed(r) {
  if (s(r.release_date)) return true
  const blob = `${s(r.status)} ${s(r.closure_status)} ${s(r.claim_status)}`.toLowerCase()
  return /clos|settl|paid|recovered|complete|resolved|reject/.test(blob)
}

/** Open claim past its expected release date (a delayed / overdue claim). */
export function isDelayed(r, today) {
  if (isClosed(r)) return false
  const exp = s(r.expected_release_date).slice(0, 10)
  return !!exp && exp < today
}

/** Net exposure after recoveries: repair (or estimate) + parts − recovered. */
export function claimNet(r) {
  const gross = (N(r.repair_cost) || N(r.estimated_damage_cost)) + N(r.parts_cost)
  return Math.max(0, gross - N(r.recovered_amount))
}

/** Days between two date-ish values (b − a) in whole days, or null. */
function daysBetween(a, b) {
  const da = a ? new Date(a) : null
  const db = b ? new Date(b) : null
  if (!da || !db || Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/** Normalise a GCC liability ratio to one of the 0 / 50 / 100 buckets, or null. */
function liabilityBucket(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n <= 25) return 0
  if (n < 75) return 50
  return 100
}

function topN(map, n = 8) {
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
}

/**
 * Full claims analysis over accident rows.
 * @param {object[]} rows accident records
 * @param {{ now?: Date|string }} [opts]
 */
export function analyzeClaims(rows, { now } = {}) {
  const today = (now ? new Date(now) : new Date()).toISOString().slice(0, 10)
  const claims = (rows || []).filter(hasClaim)

  const insurerMap = new Map()
  const statusMap = new Map()
  const siteMap = new Map()
  const assetMap = new Map()
  const monthMap = new Map()
  const liability = { 0: mk(), 50: mk(), 100: mk(), unknown: mk() }
  const fault = { faulty: mk(), non_faulty: mk(), unknown: mk() }
  const najm = { with_report: 0, no_report: 0, unknown: 0 }
  const taqdeer = { with_report: 0, no_report: 0, unknown: 0 }
  const aging = { '0-30': mk(), '31-60': mk(), '61-90': mk(), '90+': mk() }

  let open = 0, closed = 0, delayed = 0
  let claimed = 0, approved = 0, recovered = 0, deductible = 0, net = 0, openValue = 0
  let closedDaysSum = 0, closedDaysCount = 0
  let firstDate = null, lastDate = null

  for (const r of claims) {
    const cAmt = N(r.claim_amount)
    const aAmt = N(r.claim_approved_amount)
    const rAmt = N(r.recovered_amount)
    const closedFlag = isClosed(r)
    const delayedFlag = isDelayed(r, today)

    if (closedFlag) closed++; else { open++; openValue += cAmt }
    if (delayedFlag) delayed++
    claimed += cAmt
    approved += aAmt
    recovered += rAmt
    deductible += N(r.deductible)
    net += claimNet(r)

    // Insurer
    bump(insurerMap, s(r.insurer) || '(no insurer)', cAmt, rAmt)
    // Claim status
    bump(statusMap, s(r.claim_status) || (closedFlag ? 'Closed' : 'Open'), cAmt, rAmt)
    // Site
    bump(siteMap, s(r.site) || '(no site)', cAmt, rAmt)
    // Asset
    bump(assetMap, s(r.asset_no) || '(no asset)', cAmt, rAmt)

    // Liability bucket
    const lb = liabilityBucket(r.gcc_liability_ratio)
    add(lb == null ? liability.unknown : liability[lb], cAmt)

    // Fault
    const f = s(r.fault_status).toLowerCase()
    if (/non[-\s]?fault|not.?at.?fault|no.?fault/.test(f)) add(fault.non_faulty, cAmt)
    else if (/fault/.test(f)) add(fault.faulty, cAmt)
    else add(fault.unknown, cAmt)

    // Najm / Taqdeer report presence
    tallyReport(najm, r.najm_status)
    tallyReport(taqdeer, r.taqdeer_status)

    // Monthly trend by incident date
    const d = s(r.incident_date).slice(0, 10)
    if (d) {
      if (!firstDate || d < firstDate) firstDate = d
      if (!lastDate || d > lastDate) lastDate = d
      const ym = d.slice(0, 7)
      const m = monthMap.get(ym) || { count: 0, claimed: 0, approved: 0, recovered: 0 }
      m.count++; m.claimed += cAmt; m.approved += aAmt; m.recovered += rAmt
      monthMap.set(ym, m)
    }

    // Closed-claim cycle time (incident → release)
    if (closedFlag) {
      const dd = daysBetween(r.incident_date, r.release_date || today)
      if (dd != null && dd >= 0) { closedDaysSum += dd; closedDaysCount++ }
    }

    // Aging buckets for OPEN claims (days since incident)
    if (!closedFlag && d) {
      const age = daysBetween(d, today)
      if (age != null) {
        const b = age <= 30 ? aging['0-30'] : age <= 60 ? aging['31-60'] : age <= 90 ? aging['61-90'] : aging['90+']
        add(b, cAmt)
      }
    }
  }

  const total = claims.length
  const monthly = [...monthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-12)
    .map(([ym, v]) => ({ ym, ...v }))

  return {
    today,
    total,
    open,
    closed,
    delayed,
    claimed,
    approved,
    recovered,
    deductible,
    netExposure: net,
    openValue,
    avgClaim: total ? Math.round(claimed / total) : 0,
    recoveryRate: claimed > 0 ? Math.round((recovered / claimed) * 100) : null,
    approvalRate: claimed > 0 ? Math.round((approved / claimed) * 100) : null,
    outstanding: Math.max(0, approved - recovered),
    avgCycleDays: closedDaysCount ? Math.round(closedDaysSum / closedDaysCount) : null,
    firstDate,
    lastDate,
    byInsurer: topN(insurerMap),
    byStatus: topN(statusMap),
    bySite: topN(siteMap),
    topAssets: topN(assetMap, 10),
    byMonth: monthly,
    liability: {
      0: liability[0], 50: liability[50], 100: liability[100], unknown: liability.unknown,
    },
    fault,
    najm,
    taqdeer,
    aging,
    claims,
  }
}

// ── small mutable accumulators ────────────────────────────────────────────────
function mk() { return { count: 0, value: 0 } }
function add(acc, value) { acc.count++; acc.value += value }
function bump(map, key, value, recovered) {
  const cur = map.get(key) || { count: 0, value: 0, recovered: 0 }
  cur.count++; cur.value += value; cur.recovered += recovered
  map.set(key, cur)
}
function tallyReport(acc, status) {
  const v = s(status).toLowerCase()
  if (!v) { acc.unknown++; return }
  if (/no|without|none|missing|pending/.test(v)) acc.no_report++
  else acc.with_report++
}
