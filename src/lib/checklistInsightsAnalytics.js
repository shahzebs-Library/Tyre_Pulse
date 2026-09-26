/**
 * checklistInsightsAnalytics - pure engine behind /checklist-insights.
 *
 * Every figure the Checklist Insights page renders is derived here from rows
 * the page already fetched (templates, submissions, the compliance monitor and
 * the approval-age monitor). No I/O, and the clock is injected (`now`) so the
 * tests are deterministic.
 *
 * Honesty rules:
 *   - a rate with no denominator is `null` (rendered N/A), never 0 or 100;
 *   - a submission with no readable date is counted in totals but never placed
 *     in a week or a "this month" bucket it cannot be proven to belong to;
 *   - an unassigned site stays labelled "Unassigned", not silently dropped.
 */

export const WEEKS = 10
export const PERIODS = [
  { key: 'all', label: 'All time', days: null },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
]
export const STATUS_KEYS = ['submitted', 'approved', 'rejected', 'draft']
export const STATUS_LABELS = {
  submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', draft: 'Draft',
}

// ── Dates ────────────────────────────────────────────────────────────────────
export function parseDate(v) {
  if (!v) return null
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function submissionDate(s) {
  return parseDate(s?.created_at) || parseDate(s?.submitted_at) || null
}

/** Monday-anchored start of the week containing `date` (local time, clone). */
export function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  d.setHours(0, 0, 0, 0)
  return d
}

export function weekKey(date) {
  const w = weekStart(date)
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`
}

export function pct(n, d) {
  if (!d) return null
  return (n / d) * 100
}

export function statusOf(s) {
  const st = String(s?.status || 'submitted').trim().toLowerCase()
  return STATUS_KEYS.includes(st) ? st : 'submitted'
}

// ── Booleans ─────────────────────────────────────────────────────────────────
export function boolAnswered(v) {
  return v !== null && v !== undefined && v !== ''
}

export function boolIsYes(v) {
  if (v === true) return true
  const s = String(v).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === 'pass' || s === '1' || s === 'ok'
}

// ── Filtering ────────────────────────────────────────────────────────────────
export function siteOf(s) {
  return (s?.site && String(s.site).trim()) || 'Unassigned'
}

/** Distinct site labels present on the submissions, alphabetised. */
export function siteOptions(submissions = []) {
  return [...new Set((submissions || []).filter(Boolean).map(siteOf))].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter submissions by template, status, site, period and free text.
 * @param {Array} submissions
 * @param {{template?:string,status?:string,site?:string,period?:string,search?:string}} f
 * @param {Date} now
 */
export function filterSubmissions(submissions = [], f = {}, now = new Date()) {
  const q = String(f.search || '').trim().toLowerCase()
  const period = PERIODS.find((p) => p.key === f.period)
  const cutoff = period?.days ? new Date(now.getTime() - period.days * 86400000) : null
  return (submissions || []).filter((s) => {
    if (!s) return false
    if (f.template && f.template !== 'all' && String(s.template_id) !== String(f.template)) return false
    if (f.status && f.status !== 'all' && statusOf(s) !== f.status) return false
    if (f.site && f.site !== 'all' && siteOf(s) !== f.site) return false
    if (cutoff) {
      const d = submissionDate(s)
      if (!d || d < cutoff) return false
    }
    if (!q) return true
    const hay = [s.site, s.template_name, s.title, s.asset_no, s.document_no].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export function templateIndex(templates = []) {
  const map = new Map()
  for (const t of templates || []) if (t?.id != null) map.set(t.id, t)
  return map
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
export function computeMetrics(templates = [], subs = [], now = new Date()) {
  const tplById = templateIndex(templates)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  let thisMonth = 0
  let undated = 0
  const counts = { submitted: 0, approved: 0, rejected: 0, draft: 0 }
  let requiresApproval = 0
  let requiresApprovalPassed = 0
  const sites = new Set()
  for (const s of subs) {
    const d = submissionDate(s)
    if (!d) undated++
    else if (d >= monthStart && d <= now) thisMonth++
    const st = statusOf(s)
    counts[st]++
    if (s?.site && String(s.site).trim()) sites.add(String(s.site).trim())
    if (tplById.get(s?.template_id)?.require_approval) {
      requiresApproval++
      if (st === 'approved') requiresApprovalPassed++
    }
  }
  const decided = counts.approved + counts.rejected
  return {
    publishedTemplates: (templates || []).filter((t) => t?.status === 'published').length,
    totalTemplates: (templates || []).length,
    total: subs.length,
    thisMonth,
    undated,
    ...counts,
    decided,
    approvalRate: pct(counts.approved, decided),
    requiresApproval,
    requiresApprovalPassed,
    approvalPassRate: pct(requiresApprovalPassed, requiresApproval),
    activeSites: sites.size,
  }
}

/** Traffic-light tone for a percentage, or `null` when not measurable. */
export function rateTone(v, good = 85, warn = 60) {
  if (v == null) return null
  return v >= good ? 'good' : v >= warn ? 'warn' : 'bad'
}

// ── Series ───────────────────────────────────────────────────────────────────
/** Weekly submission counts for the last `weeks` weeks, oldest first. */
export function weeklySeries(subs = [], now = new Date(), weeks = WEEKS) {
  const axis = []
  for (let i = weeks - 1; i >= 0; i--) {
    const d = weekStart(now)
    d.setDate(d.getDate() - i * 7)
    axis.push(d)
  }
  const counts = new Map(axis.map((d) => [weekKey(d), 0]))
  let dated = 0
  for (const s of subs) {
    const d = submissionDate(s)
    if (!d) continue
    const k = weekKey(d)
    if (counts.has(k)) { counts.set(k, counts.get(k) + 1); dated++ }
  }
  return {
    weeks: axis,
    counts: axis.map((d) => counts.get(weekKey(d)) || 0),
    inWindow: dated,
  }
}

export function bySite(subs = [], limit = 12) {
  const map = new Map()
  for (const s of subs) {
    const site = siteOf(s)
    map.set(site, (map.get(site) || 0) + 1)
  }
  const all = [...map.entries()].map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
  return { rows: all.slice(0, limit), total: all.length }
}

export function byTemplate(subs = [], templates = []) {
  const tplById = templateIndex(templates)
  const map = new Map()
  for (const s of subs) {
    const id = s?.template_id ?? 'unknown'
    let row = map.get(id)
    if (!row) {
      row = {
        id,
        name: s?.template_name || tplById.get(id)?.name || 'Unknown template',
        count: 0, last: null, submitted: 0, approved: 0, rejected: 0, draft: 0,
        requireApproval: !!tplById.get(id)?.require_approval,
      }
      map.set(id, row)
    }
    row.count++
    const d = submissionDate(s)
    if (d && (!row.last || d > row.last)) row.last = d
    row[statusOf(s)]++
  }
  return [...map.values()].map((r) => ({
    ...r,
    approvalRate: pct(r.approved, r.approved + r.rejected),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Yes/No pass rates per boolean question, lowest first.
 * `isBoolField(field)` is injected so the engine does not import the field
 * registry (it stays a pure leaf).
 */
export function boolPassRates(templates = [], subs = [], { template = 'all', isBoolField } = {}) {
  const test = isBoolField || ((f) => f?.type === 'boolean')
  const subsByTpl = new Map()
  for (const s of subs) {
    const id = s?.template_id
    if (!subsByTpl.has(id)) subsByTpl.set(id, [])
    subsByTpl.get(id).push(s)
  }
  const rows = []
  for (const tpl of templates || []) {
    if (template !== 'all' && String(tpl?.id) !== String(template)) continue
    const fields = Array.isArray(tpl?.fields) ? tpl.fields : []
    const boolFields = fields.filter(test)
    if (!boolFields.length) continue
    const tplSubs = subsByTpl.get(tpl.id) || []
    if (!tplSubs.length) continue
    for (const f of boolFields) {
      let responses = 0
      let yes = 0
      for (const s of tplSubs) {
        const v = s?.answers?.[f.id]
        if (!boolAnswered(v)) continue
        responses++
        if (boolIsYes(v)) yes++
      }
      if (responses < 1) continue
      rows.push({
        key: `${tpl.id}:${f.id}`,
        template: tpl.name || 'Untitled',
        question: f.label || 'Yes / No',
        yes,
        no: responses - yes,
        yesPct: (yes / responses) * 100,
        responses,
      })
    }
  }
  return rows.sort((a, b) => a.yesPct - b.yesPct || b.responses - a.responses)
}

// ── Monitors ─────────────────────────────────────────────────────────────────
const numOr0 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }

export function complianceSummary(rows = [], template = 'all') {
  const scoped = (rows || []).filter((r) => template === 'all' || String(r.template_id) === String(template))
  const total = (k) => scoped.reduce((sum, r) => sum + numOr0(r[k]), 0)
  const due = total('due_count')
  const completed = total('completed_count')
  const skipped = total('skipped_count')
  return {
    rows: scoped.map((r) => ({
      key: `${r.template_id}:${r.country}:${r.site}`,
      template: r.template_name || 'Unknown template',
      site: r.site || 'Unassigned',
      country: r.country || '',
      due: numOr0(r.due_count),
      completed: numOr0(r.completed_count),
      overdue: numOr0(r.overdue_count),
      compliancePct: numOrNull(r.compliance_pct),
      evidenceGaps: numOr0(r.evidence_gap_count),
    })),
    due,
    completed,
    overdue: total('overdue_count'),
    evidenceGaps: total('evidence_gap_count'),
    compliancePct: pct(completed, due - skipped),
    onTimePct: pct(total('completed_on_time_count'), completed),
  }
}

export function prettyToken(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

export function approvalAgeSummary(rows = [], template = 'all') {
  const scoped = (rows || []).filter((r) => template === 'all' || String(r.template_id) === String(template))
  const out = scoped.map((r) => ({
    key: `${r.template_id}:${r.country}:${r.site}:${r.approval_stage}`,
    template: r.template_name || 'Unknown template',
    site: r.site || 'Unassigned',
    country: r.country || '',
    stage: prettyToken(r.approval_stage),
    pending: numOr0(r.pending_count),
    oldestHours: numOrNull(r.oldest_age_hours),
    averageHours: numOrNull(r.average_age_hours),
    targetHours: numOrNull(r.target_hours),
    breached: numOr0(r.breached_count),
  }))
  const oldest = out.reduce((m, r) => (r.oldestHours != null && (m == null || r.oldestHours > m) ? r.oldestHours : m), null)
  return {
    rows: out,
    pending: out.reduce((s, r) => s + r.pending, 0),
    breached: out.reduce((s, r) => s + r.breached, 0),
    oldestHours: oldest,
  }
}

// ── Sorting + export ─────────────────────────────────────────────────────────
/** Stable sort of a copy; nulls always sort last whatever the direction. */
export function sortRows(rows = [], get, dir = 'asc') {
  const mul = dir === 'desc' ? -1 : 1
  return (rows || []).map((r, i) => [r, i]).sort(([a, ia], [b, ib]) => {
    const av = get(a); const bv = get(b)
    const an = av == null || av === ''; const bn = bv == null || bv === ''
    if (an && bn) return ia - ib
    if (an) return 1
    if (bn) return -1
    const c = typeof av === 'string' || typeof bv === 'string'
      ? String(av).localeCompare(String(bv))
      : (av < bv ? -1 : av > bv ? 1 : 0)
    return c === 0 ? ia - ib : c * mul
  }).map(([r]) => r)
}

const fmtPctText = (v) => (v == null ? 'N/A' : `${v.toFixed(1)}%`)
const isoDay = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'N/A')

export const TEMPLATE_EXPORT_COLS = ['name', 'count', 'submitted', 'approved', 'rejected', 'draft', 'approvalRate', 'last']
export const TEMPLATE_EXPORT_HEADERS = ['Template', 'Submissions', 'Submitted', 'Approved', 'Rejected', 'Draft', 'Approval rate', 'Last submitted']
export function templateExportRows(rows = []) {
  return rows.map((r) => ({
    name: r.name, count: r.count, submitted: r.submitted, approved: r.approved,
    rejected: r.rejected, draft: r.draft, approvalRate: fmtPctText(r.approvalRate), last: isoDay(r.last),
  }))
}

export const PASS_EXPORT_COLS = ['template', 'question', 'yesPct', 'yes', 'no', 'responses']
export const PASS_EXPORT_HEADERS = ['Template', 'Question', 'Yes %', 'Yes', 'No', 'Responses']
export function passRateExportRows(rows = []) {
  return rows.map((r) => ({
    template: r.template, question: r.question, yesPct: fmtPctText(r.yesPct),
    yes: r.yes, no: r.no, responses: r.responses,
  }))
}
