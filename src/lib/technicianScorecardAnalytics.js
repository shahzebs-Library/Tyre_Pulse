/**
 * technicianScorecardAnalytics - page-level engine for /technician-scorecard.
 *
 * The maths (composite score, lifecycle band, cert expiry, skills matrix, SLA)
 * lives in `src/lib/technicianScorecard.js` and is REUSED here, never
 * re-derived. This module owns only what the page used to compute inline:
 * filtering, the KPI strips, the per-technician competency roll-up, the
 * certification register and the export shapes. Pure; the clock is injected.
 *
 * Honesty rules: a rate over zero jobs is `null` (N/A), never 0%; a failed
 * source read is reported by the page, not collapsed into an empty list here.
 */
import {
  completionRating, certExpiryStatus, lifecycleScore, skillsMatrix, slaCompliancePct,
  skillById, certById, LEVEL_LABELS, LIFECYCLE_BAND_LABELS, SKILL_CATALOGUE,
} from './technicianScorecard'

export const TECH_ROLE_RE = /tyre\s*man|technician|mechanic|fitter|foreman|inspector|workshop|helper|service|bay/i
export const MIN_JOB_OPTIONS = [1, 3, 5, 10, 20, 50]
export const RATINGS = ['Excellent', 'Good', 'Average', 'Needs Improvement']
export const CERT_STATUSES = ['expired', 'warning', 'valid', 'unknown']
export const CERT_STATUS_LABELS = { expired: 'Expired', warning: 'Expiring within 60 days', valid: 'Valid', unknown: 'No expiry date' }
export const CATEGORY_LABELS = { core: 'Core', hardware: 'Hardware', specialist: 'Specialist', management: 'Management', other: 'Other' }

export const normName = (s) => (s || '').toString().trim().toLowerCase()
export const profileName = (p) => (p?.full_name || p?.username || p?.email || 'Unnamed user')

// ── Leaderboard ──────────────────────────────────────────────────────────────
export function filterLeaderboard(rows = [], { search = '', minJobs = 1, rating = 'all' } = {}) {
  const q = String(search).trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (r.jobs < minJobs) return false
    if (q && !r.technician.toLowerCase().includes(q)) return false
    if (rating !== 'all' && completionRating(r.completionRate) !== rating) return false
    return true
  })
}

/**
 * Leaderboard KPIs over the (filtered) technician rows plus the raw orders for
 * SLA. Every rate is null when its denominator is zero.
 */
export function leaderboardKpis(rows = [], orders = [], nowMs = Date.now()) {
  const list = rows || []
  const jobs = list.reduce((s, r) => s + r.jobs, 0)
  const completed = list.reduce((s, r) => s + r.completed, 0)
  const open = list.reduce((s, r) => s + r.open, 0)
  const cost = list.reduce((s, r) => s + r.totalCost, 0)
  const taRows = list.filter((r) => r.avgTurnaround != null)
  const names = new Set(list.map((r) => r.technician))
  const scopedOrders = (orders || []).filter((o) => names.has(((o?.technician_name || o?.assigned_to || '').toString().trim()) || 'Unassigned'))
  return {
    technicians: list.length,
    jobs,
    completed,
    open,
    totalCost: cost,
    completionRate: jobs ? Math.round((completed / jobs) * 1000) / 10 : null,
    avgTurnaround: taRows.length ? Math.round((taRows.reduce((s, r) => s + r.avgTurnaround, 0) / taRows.length) * 10) / 10 : null,
    avgCostPerJob: jobs ? Math.round(cost / jobs) : null,
    slaCompliance: slaCompliancePct(scopedOrders, nowMs),
    needsImprovement: list.filter((r) => completionRating(r.completionRate) === 'Needs Improvement').length,
  }
}

export const LEADERBOARD_EXPORT_COLS = ['rank', 'technician', 'jobs', 'completed', 'open', 'completionRate', 'avgTurnaround', 'totalCost', 'avgCostPerJob', 'score', 'rating']
export const LEADERBOARD_EXPORT_HEADERS = ['Rank', 'Technician', 'Jobs', 'Completed', 'Open', 'Completion %', 'Avg TAT (days)', 'Total Cost', 'Avg Cost/Job', 'Score', 'Rating']
export function leaderboardExportRows(rows = []) {
  return rows.map((r) => ({
    rank: r.rank, technician: r.technician, jobs: r.jobs, completed: r.completed, open: r.open,
    completionRate: `${r.completionRate}%`, avgTurnaround: r.avgTurnaround == null ? 'N/A' : r.avgTurnaround,
    totalCost: r.totalCost, avgCostPerJob: r.avgCostPerJob, score: r.score, rating: completionRating(r.completionRate),
  }))
}

// ── Competency ───────────────────────────────────────────────────────────────
function groupByUser(rows = []) {
  const m = new Map()
  for (const r of rows || []) {
    if (!r?.user_id) continue
    if (!m.has(r.user_id)) m.set(r.user_id, [])
    m.get(r.user_id).push(r)
  }
  return m
}

/**
 * One competency row per profile in scope (workshop roles by default).
 * Joins the leaderboard by normalised name for the lifecycle score.
 */
export function buildTechnicianRows({ profiles = [], skills = [], certs = [], ranked = [], allRoles = false, search = '', band = 'all' } = {}, nowMs = Date.now()) {
  const skillsByUser = groupByUser(skills)
  const certsByUser = groupByUser(certs)
  const rankedByName = new Map((ranked || []).map((r) => [normName(r.technician), r]))
  const q = String(search).trim().toLowerCase()
  const base = (profiles || []).filter((p) => allRoles || TECH_ROLE_RE.test(p?.role || ''))
  return base
    .filter((p) => !q || profileName(p).toLowerCase().includes(q) || (p.role || '').toLowerCase().includes(q))
    .map((p) => {
      const uSkills = skillsByUser.get(p.id) || []
      const uCerts = certsByUser.get(p.id) || []
      const perf = rankedByName.get(normName(profileName(p))) || null
      const life = lifecycleScore({ completed: perf?.completed || 0, passRate: perf?.completionRate || 0, certCount: uCerts.length })
      const expiring = uCerts.filter((c) => {
        const st = certExpiryStatus(c.expiry_date, nowMs).status
        return st === 'warning' || st === 'expired'
      }).length
      const expert = uSkills.filter((s) => Number(s.level) === 3).length
      return {
        id: p.id,
        profile: p,
        name: profileName(p),
        role: p.role || '',
        site: p.site || '',
        skills: uSkills,
        certs: uCerts,
        skillCount: uSkills.length,
        expertSkills: expert,
        certCount: uCerts.length,
        expiring,
        gapCount: SKILL_CATALOGUE.length - new Set(uSkills.map((s) => s.skill_id)).size,
        perf,
        life,
      }
    })
    .filter((r) => band === 'all' || r.life.band === band)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function technicianKpis(rows = []) {
  const rated = rows.filter((r) => r.life.score != null)
  return {
    people: rows.length,
    assessed: rows.filter((r) => r.skillCount > 0).length,
    certified: rows.filter((r) => r.certCount > 0).length,
    atRisk: rows.filter((r) => r.expiring > 0).length,
    avgLifecycle: rated.length ? Math.round(rated.reduce((s, r) => s + r.life.score, 0) / rated.length) : null,
  }
}

export const TECH_EXPORT_COLS = ['name', 'role', 'site', 'skills', 'expert', 'certs', 'expiring', 'jobs', 'completion', 'lifecycle', 'band']
export const TECH_EXPORT_HEADERS = ['Technician', 'Role', 'Site', 'Skills', 'Expert skills', 'Certifications', 'Expiring certs', 'Jobs', 'Completion %', 'Lifecycle score', 'Band']
export function technicianExportRows(rows = []) {
  return rows.map((r) => ({
    name: r.name, role: r.role || 'N/A', site: r.site || 'N/A', skills: r.skillCount, expert: r.expertSkills,
    certs: r.certCount, expiring: r.expiring, jobs: r.perf ? r.perf.jobs : 'N/A',
    completion: r.perf ? `${r.perf.completionRate}%` : 'N/A',
    lifecycle: r.life.score == null ? 'N/A' : r.life.score, band: LIFECYCLE_BAND_LABELS[r.life.band] || r.life.band,
  }))
}

// ── Skills matrix ────────────────────────────────────────────────────────────
export function matrixRows(skills = [], { search = '', category = 'all' } = {}) {
  const q = String(search).trim().toLowerCase()
  return skillsMatrix(skills).filter((r) =>
    (category === 'all' || r.category === category) && (!q || r.name.toLowerCase().includes(q)))
}

export function matrixKpis(skills = []) {
  const matrix = skillsMatrix(skills)
  const holders = new Set((skills || []).filter((s) => s?.user_id).map((s) => s.user_id))
  const expert = matrix.reduce((a, r) => a + r.l3, 0)
  const covered = new Set(matrix.map((r) => r.skill_id).filter((id) => skillById(id)))
  return {
    skillsTracked: matrix.length,
    assessed: holders.size,
    records: (skills || []).length,
    expert,
    expertShare: (skills || []).length ? Math.round((expert / skills.length) * 1000) / 10 : null,
    uncovered: SKILL_CATALOGUE.filter((s) => !covered.has(s.skill_id)),
  }
}

export const MATRIX_EXPORT_COLS = ['name', 'category', 'l1', 'l2', 'l3', 'total']
export const MATRIX_EXPORT_HEADERS = ['Skill', 'Category', LEVEL_LABELS[1], LEVEL_LABELS[2], LEVEL_LABELS[3], 'Holders']
export function matrixExportRows(rows = []) {
  return rows.map((r) => ({ ...r, category: CATEGORY_LABELS[r.category] || r.category }))
}

// ── Certifications ───────────────────────────────────────────────────────────
export function certRegister(certs = [], profiles = [], nowMs = Date.now()) {
  const nameById = new Map((profiles || []).map((p) => [p.id, profileName(p)]))
  return (certs || []).map((c) => {
    const meta = certExpiryStatus(c.expiry_date, nowMs)
    return {
      ...c,
      technician: nameById.get(c.user_id) || 'Unknown user',
      days: meta.days,
      status: meta.status,
      displayName: c.cert_name || certById(c.cert_id)?.name || c.cert_id || 'Unnamed certification',
    }
  }).sort((a, b) => (a.days == null ? Infinity : a.days) - (b.days == null ? Infinity : b.days))
}

export function filterCerts(rows = [], { search = '', status = 'all' } = {}) {
  const q = String(search).trim().toLowerCase()
  return rows.filter((c) => (status === 'all' || c.status === status)
    && (!q || `${c.technician} ${c.displayName} ${c.issuer || ''} ${c.cert_number || ''}`.toLowerCase().includes(q)))
}

export function certKpis(rows = []) {
  const count = (s) => rows.filter((c) => c.status === s).length
  const dated = rows.filter((c) => c.status !== 'unknown')
  return {
    total: rows.length,
    expired: count('expired'),
    warning: count('warning'),
    valid: count('valid'),
    unknown: count('unknown'),
    compliance: dated.length ? Math.round((count('valid') / dated.length) * 1000) / 10 : null,
  }
}

export const CERT_EXPORT_COLS = ['technician', 'displayName', 'issuer', 'issue_date', 'expiry_date', 'days', 'status', 'cert_number']
export const CERT_EXPORT_HEADERS = ['Technician', 'Certification', 'Issuer', 'Issued', 'Expires', 'Days left', 'Status', 'Number']
export function certExportRows(rows = []) {
  return rows.map((c) => ({
    technician: c.technician, displayName: c.displayName, issuer: c.issuer || 'N/A',
    issue_date: c.issue_date || 'N/A', expiry_date: c.expiry_date || 'N/A',
    days: c.days == null ? 'N/A' : c.days, status: CERT_STATUS_LABELS[c.status] || c.status,
    cert_number: c.cert_number || 'N/A',
  }))
}
