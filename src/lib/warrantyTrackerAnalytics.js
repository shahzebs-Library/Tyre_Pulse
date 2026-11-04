/**
 * warrantyTrackerAnalytics.js - pure engine behind /warranty (WarrantyTracker).
 *
 * Owns the claim vocabulary, the two filter scopes (population vs dimension),
 * the KPI strip, the brand / failure / status breakdowns, the 12-month credit
 * series, the credit analysis, the ROI model and claim numbering. The page and
 * its exports both read from here so one rule produces both.
 *
 * Honest nulls: a rate or average with nothing to measure is null (the page
 * renders N/A), never 0. `now` is injectable wherever the calendar matters.
 */

export const FAILURE_TYPES = [
  'Premature Wear', 'Sidewall Failure', 'Tread Separation',
  'Bead Failure', 'Manufacturing Defect', 'Other',
]

export const CLAIM_STATUSES = [
  'Submitted', 'Under Review', 'Approved', 'Rejected', 'Credit Issued', 'Closed',
]

export const OPEN_STATUSES = ['Submitted', 'Under Review', 'Approved']
export const APPROVED_STATUSES = ['Approved', 'Credit Issued', 'Closed']
export const CREDITED_STATUSES = ['Credit Issued', 'Closed']

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null)
const isCredited = (c) => CREDITED_STATUSES.includes(c?.claim_status)

/** 'All' keeps every claim; a country keeps its rows plus NULL-country rows. */
export function scopeClaimsByCountry(claims = [], country = 'All') {
  if (!country || country === 'All') return claims
  return claims.filter(c => c.country == null || c.country === country)
}

/** Population filters: site, created-at range, free-text search. */
export function filterClaimsBase(claims = [], { site = 'All', from = '', to = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return claims.filter(c => {
    if (site !== 'All' && c.site !== site) return false
    const created = c.created_at ? String(c.created_at) : ''
    if (from && created.slice(0, 10) < from) return false
    if (to && created.slice(0, 10) > to) return false
    if (q) {
      return [c.claim_no, c.serial_number, c.brand, c.asset_no, c.site]
        .some(v => String(v || '').toLowerCase().includes(q))
    }
    return true
  })
}

/** Dimension filters (brand, status, failure), newest first. */
export function filterClaimsByDimension(claims = [], { brand = 'All', status = 'All', failure = 'All' } = {}) {
  return claims
    .filter(c => (brand === 'All' || c.brand === brand) &&
      (status === 'All' || c.claim_status === status) &&
      (failure === 'All' || c.failure_type === failure))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

export function claimKpis(claims = []) {
  const total = claims.length
  const credited = claims.filter(isCredited)
  const creditAmounts = credited.map(c => num(c.credit_amount)).filter(v => v !== null)
  const approved = claims.filter(c => APPROVED_STATUSES.includes(c.claim_status)).length
  return {
    total,
    open: claims.filter(c => OPEN_STATUSES.includes(c.claim_status)).length,
    totalCredits: creditAmounts.reduce((s, v) => s + v, 0),
    approvalRate: total ? (approved / total) * 100 : null,
    avgCredit: mean(creditAmounts),
  }
}

/** % of expected life the tyre ran before failing; null when unmeasurable. */
export function lifePct(claim = {}) {
  const exp = num(claim.expected_life_km)
  const run = num(claim.km_run)
  if (!exp || exp <= 0 || run === null) return null
  return (run / exp) * 100
}

export function brandPerformance(claims = []) {
  const map = {}
  claims.forEach(c => {
    const b = String(c.brand || '').trim() || 'Unknown'
    const e = (map[b] ||= { brand: b, total: 0, approved: 0, credits: [], km: [] })
    e.total++
    if (APPROVED_STATUSES.includes(c.claim_status)) e.approved++
    const credit = num(c.credit_amount)
    if (isCredited(c) && credit) e.credits.push(credit)
    const km = num(c.km_run)
    if (km && km > 0) e.km.push(km)
  })
  return Object.values(map).map(e => ({
    brand: e.brand,
    total: e.total,
    approved: e.approved,
    credits: e.credits.reduce((s, v) => s + v, 0),
    approvalRate: e.total ? (e.approved / e.total) * 100 : null,
    avgCredit: mean(e.credits),
    avgKm: mean(e.km),
  })).sort((a, b) => b.total - a.total)
}

export function failureBreakdown(claims = []) {
  const map = {}
  FAILURE_TYPES.forEach(f => { map[f] = { count: 0, km: [] } })
  claims.forEach(c => {
    const e = map[c.failure_type]
    if (!e) return
    e.count++
    const km = num(c.km_run)
    if (km && km > 0) e.km.push(km)
  })
  return Object.entries(map).map(([type, e]) => ({
    type, count: e.count, avgKm: e.km.length ? Math.round(mean(e.km)) : null,
  })).sort((a, b) => b.count - a.count)
}

export function statusCounts(claims = []) {
  const map = {}
  CLAIM_STATUSES.forEach(s => { map[s] = 0 })
  claims.forEach(c => { if (map[c.claim_status] != null) map[c.claim_status]++ })
  return map
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Credits received per month for the 12 months ending with `now`. */
export function monthlyCredits(claims = [], { now = new Date() } = {}) {
  const ref = new Date(now)
  const data = Array(12).fill(0)
  claims.forEach(c => {
    if (!isCredited(c) || !c.credit_date) return
    const d = new Date(c.credit_date)
    if (Number.isNaN(d.getTime())) return
    const diff = (ref.getFullYear() - d.getFullYear()) * 12 + ref.getMonth() - d.getMonth()
    if (diff >= 0 && diff < 12) data[11 - diff] += num(c.credit_amount) || 0
  })
  const labels = []
  for (let i = 11; i >= 0; i--) labels.push(MONTHS[new Date(ref.getFullYear(), ref.getMonth() - i, 1).getMonth()])
  return { labels, data }
}

/** Credits received and the value still sitting in approved-but-uncredited claims. */
export function creditAnalysis(claims = []) {
  const credited = claims.filter(isCredited)
  const amounts = credited.map(c => num(c.credit_amount)).filter(v => v)
  const avg = mean(amounts)
  const openApproved = claims.filter(c => c.claim_status === 'Approved').length
  return {
    totalCredits: amounts.reduce((s, v) => s + v, 0),
    openApprovedCount: openApproved,
    // Estimated from the average credit actually issued; null when nothing was issued yet.
    estimatedUnclaimed: avg === null ? null : openApproved * avg,
  }
}

/**
 * ROI model over the whole country (not the filtered view): this year's credits
 * against an annual purchase volume the user types in.
 */
export function roiModel(claims = [], { annualCount = 0, avgCost = 0, now = new Date() } = {}) {
  const year = new Date(now).getFullYear()
  const count = num(annualCount) || 0
  const cost = num(avgCost) || 0
  const thisYear = claims.filter(c => String(c.claim_no || '').startsWith(`WAR-${year}-`))
  const credits = thisYear.filter(isCredited).reduce((s, c) => s + (num(c.credit_amount) || 0), 0)
  const spend = count * cost
  return {
    thisYearClaims: thisYear.length,
    thisYearCredits: credits,
    recoveryRate: spend > 0 ? (credits / spend) * 100 : null,
    // Planning assumption: 30% of tyres eligible, 40% of cost recoverable.
    eligibleUnclaimed: count > 0 ? Math.round(count * 0.3) * cost * 0.4 : null,
  }
}

/** Next claim number WAR-<year>-00001 for the year of `now`. */
export function generateClaimNo(existing = [], now = new Date()) {
  const year = new Date(now).getFullYear()
  const seqs = existing
    .map(c => String(c.claim_no || ''))
    .filter(no => no.startsWith(`WAR-${year}-`))
    .map(no => Number(no.slice(`WAR-${year}-`.length)))
    .filter(Number.isFinite)
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1
  return `WAR-${year}-${String(next).padStart(5, '0')}`
}

/** Distinct option list with an 'All' sentinel first. */
export function optionsOf(claims = [], key) {
  return ['All', ...[...new Set(claims.map(c => c[key]).filter(Boolean))].sort()]
}

// ---------------------------------------------------------------------------
// Warranty CANDIDATES (not claims). warranty_claims is filled by hand, so a
// page reading only that table shows nothing until someone raises a claim.
// The tyre removal history already says which tyres came off early for a
// reason a supplier could be asked to cover. These helpers list them, clearly
// as candidates for review, never as claims.
// ---------------------------------------------------------------------------

/** Default early-life windows (km). Defects inside expected life; wear inside half of it. */
export const CANDIDATE_DEFAULTS = { expectedLifeKm: 100000, prematureWearShare: 0.5 }

// Ordered: the first match decides. Road-hazard and operator causes (puncture,
// cut, damage, misuse, alignment, valve) are deliberately absent - a supplier
// does not cover them, so they are never offered as candidates.
const DEFECT_RULES = [
  { re: /sidewall\s*separat|side\s*wall\s*separat|bulge/i, failure: 'Sidewall Failure', kind: 'defect' },
  { re: /tread\s*separat|thread\s*separat|thread\s*seprat|separat|seprat/i, failure: 'Tread Separation', kind: 'defect' },
  { re: /\bbead\b/i, failure: 'Bead Failure', kind: 'defect' },
  { re: /manufactur|defect/i, failure: 'Manufacturing Defect', kind: 'defect' },
  { re: /blow\s*-?\s*out|burst|blast/i, failure: 'Other', kind: 'burst' },
]

/**
 * Classify a free-text removal reason. Returns { kind, failure } or null.
 * kind: 'defect' | 'burst' | 'premature_wear'. 'Normal tread wear' is not early.
 */
export function classifyRemovalReason(reason) {
  const r = String(reason || '').trim()
  if (!r) return null
  for (const rule of DEFECT_RULES) if (rule.re.test(r)) return { kind: rule.kind, failure: rule.failure }
  if (/normal/i.test(r)) return null
  if (/worn|wear/i.test(r)) return { kind: 'premature_wear', failure: 'Premature Wear' }
  return null
}

/** km a tyre ran: total_km, else removal minus fitment odometer; null when unknown. */
export function tyreKmRun(t) {
  const total = num(t?.total_km)
  if (total != null && total > 0) return total
  const fit = num(t?.km_at_fitment)
  const rem = num(t?.km_at_removal)
  if (fit != null && rem != null && fit > 0 && rem > fit) return rem - fit
  return null
}

const serialKey = (s) => String(s || '').replace(/\s+/g, '').toUpperCase()

/**
 * Build the candidate list from tyre removal rows.
 * - defect / burst: kept when km is unknown (flagged) or below expected life.
 * - premature_wear: kept only with a measured km below expectedLife x share.
 * - tyres whose serial already carries a warranty claim are dropped.
 */
export function buildWarrantyCandidates(tyres = [], claims = [], opts = {}) {
  const { expectedLifeKm, prematureWearShare } = { ...CANDIDATE_DEFAULTS, ...opts }
  const wearLimit = expectedLifeKm * prematureWearShare
  const claimed = new Set(claims.map(c => serialKey(c.serial_number)).filter(Boolean))
  const out = []
  for (const t of tyres) {
    const cls = classifyRemovalReason(t.removal_reason)
    if (!cls) continue
    const serial = t.serial_no ?? t.serial_number ?? ''
    if (serial && claimed.has(serialKey(serial))) continue
    const km = tyreKmRun(t)
    if (cls.kind === 'premature_wear') {
      if (km == null || km >= wearLimit) continue
    } else if (km != null && km >= expectedLifeKm) {
      continue
    }
    out.push({
      id: t.id,
      serial_number: serial || null,
      brand: t.brand || null,
      size: t.size || null,
      asset_no: t.asset_no || null,
      position: t.tyre_position || null,
      site: t.site || null,
      country: t.country || null,
      fitment_date: t.fitment_date || t.issue_date || null,
      removal_date: t.removal_date || null,
      km_at_fitment: num(t.km_at_fitment),
      km_at_removal: num(t.km_at_removal),
      km_run: km,
      removal_reason: String(t.removal_reason).trim(),
      kind: cls.kind,
      failure_type: cls.failure,
      life_pct: km != null && expectedLifeKm > 0 ? (km / expectedLifeKm) * 100 : null,
      km_known: km != null,
    })
  }
  return out.sort((a, b) => String(b.removal_date || '').localeCompare(String(a.removal_date || '')))
}

/** Counts by kind for the candidate tiles. */
export function candidateSummary(candidates = []) {
  const s = { total: candidates.length, defect: 0, burst: 0, premature_wear: 0, kmUnknown: 0 }
  for (const c of candidates) {
    s[c.kind] = (s[c.kind] || 0) + 1
    if (!c.km_known) s.kmUnknown += 1
  }
  return s
}
