/**
 * checklistWorkspaceView - the pure engine behind the Checklists workspace (the
 * mockup-style "Inspections and observations" panel at the top of /checklists).
 *
 * No I/O. Rows in, view models out. Time is injected (`now`, epoch ms).
 *
 * Three readings this file owns, so the screen never re-derives them:
 *
 *  1. WHERE A SHEET HAS GOT TO. `status` on a submission is written as
 *     'submitted' and never moves; the sign-off lives in `approval_status`
 *     (pending / pending_area_manager / approved / rejected / not_required).
 *     So the workspace buckets on approval_status first and only falls back to
 *     the shared STATUS_BUCKETS reading of `status` when no approval state is
 *     recorded. 'not_required' is a completed sheet that never needed a
 *     signature, which is why the headline is "completed or approved".
 *
 *  2. WHAT ONE LINE SAYS. A line answered from a legend carries marks with a
 *     tone (good / fixed / bad / muted) and a blocking flag (checklistMarks).
 *     Those decide OK / Minor / Issue / N/A. A plain answer with no legend is
 *     only classified when its stored word is unambiguous (Pass, Fail, Not OK);
 *     anything else is "Recorded", never guessed into a verdict.
 *
 *  3. WHAT IS A FINDING. A line whose status is Issue. A corrected-on-site mark
 *     (top-up, repair, swap) is Minor and is NOT counted as a finding.
 *
 * HONEST NULLS: a percentage of nothing is null (N/A), never 0%.
 */
import { statusBucket } from './checklistsAnalytics'
import { submissionSections, templateFromSubmission } from './checklistView'
import { submissionTarget } from './checklistMonthly'
import { approvalProgress } from './checklist/checklistApproval'

const DAY_MS = 24 * 60 * 60 * 1000

/** Display meaning of each line status. `tone` maps to the kit pill classes. */
export const ROW_STATUS = {
  ok: { key: 'ok', label: 'OK', tone: 'good' },
  minor: { key: 'minor', label: 'Minor', tone: 'warn', title: 'Corrected on site' },
  issue: { key: 'issue', label: 'Issue', tone: 'bad' },
  na: { key: 'na', label: 'N/A', tone: 'muted', title: 'Not applicable' },
  recorded: { key: 'recorded', label: 'Recorded', tone: 'info', title: 'A value was recorded; it carries no pass or fail meaning' },
  unanswered: { key: 'unanswered', label: 'Not answered', tone: 'muted' },
}

/** Workspace buckets, in display order. */
export const WORKSPACE_BUCKETS = {
  approved: { key: 'approved', label: 'Approved', tone: 'good' },
  completed: { key: 'completed', label: 'Completed', tone: 'good', title: 'No approval required' },
  pending: { key: 'pending', label: 'Pending approval', tone: 'warn' },
  rejected: { key: 'rejected', label: 'Rejected', tone: 'bad' },
  draft: { key: 'draft', label: 'Draft', tone: 'muted' },
  other: { key: 'other', label: 'Submitted', tone: 'info' },
}

const OK_WORDS = new Set(['ok', 'pass', 'passed', 'good', 'satisfactory', 'fit', 'serviceable'])
const ISSUE_WORDS = new Set([
  'fail', 'failed', 'not ok', 'notok', 'not okay', 'defect', 'defective', 'faulty', 'fault',
  'damaged', 'unsatisfactory', 'unfit', 'unserviceable', 'bad',
])
const NA_WORDS = new Set(['n/a', 'na', 'not applicable'])

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** The workspace bucket of one submission (see note 1 at the top). */
export function workspaceBucket(sub) {
  const a = norm(sub?.approval_status)
  if (a === 'approved') return 'approved'
  if (a === 'rejected') return 'rejected'
  if (a === 'pending' || a === 'pending_area_manager' || a === 'pending_approval') return 'pending'
  if (a === 'not_required') return 'completed'
  const b = statusBucket(sub?.status)
  if (b === 'approved' || b === 'rejected' || b === 'pending' || b === 'draft') return b
  return 'other'
}

/** The moment a submission arrived, as epoch ms, or null. */
export function receivedAt(sub) {
  const t = Date.parse(sub?.submitted_at || sub?.created_at || '')
  return Number.isFinite(t) ? t : null
}

/** Local calendar day key (YYYY-MM-DD) for an epoch ms. */
export function localDayKey(ms) {
  if (ms == null || !Number.isFinite(ms)) return null
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The template to read a submission with: its own frozen snapshot first (what
 * the inspector actually answered), else the live template from the list, else
 * whatever a fully loaded submission carries. Null when nothing is known.
 */
export function templateForSubmission(sub, templates = []) {
  const snap = sub?.template_snapshot
  if (snap && typeof snap === 'object' && Array.isArray(snap.fields) && snap.fields.length) {
    return { ...snap, id: sub?.template_id ?? snap.id ?? null, name: snap.name || sub?.template_name || null }
  }
  const live = (templates || []).find((t) => String(t?.id) === String(sub?.template_id))
  if (live && Array.isArray(live.fields) && live.fields.length) return live
  return templateFromSubmission(sub) || live || null
}

/** OK / Minor / Issue / N/A / Recorded / Not answered for one line. */
export function classifyRow(row) {
  if (!row || !row.answered) return 'unanswered'
  const marks = Array.isArray(row.marks) ? row.marks : []
  if (marks.length) {
    if (marks.some((m) => m?.blocking || m?.tone === 'bad')) return 'issue'
    if (marks.some((m) => m?.tone === 'fixed')) return 'minor'
    if (marks.some((m) => m?.tone === 'good')) return 'ok'
    return 'na'
  }
  const values = Array.isArray(row.value) ? row.value : [row.value]
  // A field with a configured pass rule is judged by it, the same rule the
  // score uses (computeScore): Brakes OK? false, Visible damage? true and
  // Tyre condition Worn all fail here even though no word list names them.
  if (Array.isArray(row.passValues) && row.passValues.length) {
    return values.some((v) => row.passValues.includes(v)) ? 'ok' : 'issue'
  }
  const words = values.map(norm).filter(Boolean)
  if (words.some((w) => ISSUE_WORDS.has(w))) return 'issue'
  if (words.length && words.every((w) => NA_WORDS.has(w))) return 'na'
  if (words.some((w) => OK_WORDS.has(w))) return 'ok'
  return 'recorded'
}

/**
 * The sheet as the middle panel reads it: every section with every line
 * (unanswered lines included, because a blank line on a signed sheet is itself
 * worth seeing), each line classified, and per-section answered/total counts.
 */
export function workspaceSections(sub, template = null) {
  if (!sub) return []
  const secs = submissionSections(sub, { template, includeUnanswered: true })
  return secs.map((s) => {
    const rows = s.rows.map((r) => ({ ...r, status: classifyRow(r) }))
    const answered = rows.filter((r) => r.answered).length
    return {
      id: s.id,
      label: s.label,
      rows,
      answered,
      total: rows.length,
      complete: rows.length > 0 && answered === rows.length,
      issues: rows.filter((r) => r.status === 'issue').length,
    }
  })
}

/** Every Issue line on one submission, tagged with its section. */
export function submissionFindings(sub, template = null) {
  return workspaceSections(sub, template).flatMap((s) =>
    s.rows.filter((r) => r.status === 'issue').map((r) => ({ ...r, section: s.label })))
}

/** Headline figures for the KPI strip. `findingsBySub` is a Map id -> findings[]. */
export function workspaceKpis(subs = [], findingsBySub = new Map()) {
  const counts = { approved: 0, completed: 0, pending: 0, rejected: 0, draft: 0, other: 0 }
  let failedItems = 0
  let withFindings = 0
  for (const s of subs || []) {
    counts[workspaceBucket(s)] += 1
    const f = findingsBySub.get(s?.id) || []
    failedItems += f.length
    if (f.length) withFindings += 1
  }
  const total = (subs || []).length
  const done = counts.approved + counts.completed
  return {
    total,
    done,
    donePct: total > 0 ? Math.round((done / total) * 1000) / 10 : null,
    pending: counts.pending,
    rejected: counts.rejected,
    draft: counts.draft,
    failedItems,
    withFindings,
    counts,
  }
}

/** Tab membership for the submissions list. */
export function listTabCounts(subs = [], now = Date.now()) {
  const today = localDayKey(now)
  let todayN = 0; let pending = 0; let rejected = 0
  for (const s of subs || []) {
    if (localDayKey(receivedAt(s)) === today) todayN += 1
    const b = workspaceBucket(s)
    if (b === 'pending') pending += 1
    if (b === 'rejected') rejected += 1
  }
  return { all: (subs || []).length, today: todayN, pending, rejected }
}

/** Narrow the list by tab ('all'|'today'|'pending'|'rejected') and free text. */
export function filterWorkspaceList(subs = [], { tab = 'all', query = '', now = Date.now(), templates = [] } = {}) {
  const today = localDayKey(now)
  const q = norm(query)
  return (subs || []).filter((s) => {
    if (tab === 'today' && localDayKey(receivedAt(s)) !== today) return false
    if (tab === 'pending' && workspaceBucket(s) !== 'pending') return false
    if (tab === 'rejected' && workspaceBucket(s) !== 'rejected') return false
    if (!q) return true
    const tpl = (templates || []).find((t) => String(t?.id) === String(s?.template_id))
    const target = submissionTarget(s, tpl?.fields)
    return [s?.template_name, s?.title, s?.document_no, target.assetNo, target.site, s?.printed_name]
      .filter(Boolean).some((v) => norm(v).includes(q))
  }).sort((a, b) => (receivedAt(b) ?? -Infinity) - (receivedAt(a) ?? -Infinity))
}

/** Latest findings across submissions, newest first. */
export function recentFindings(subs = [], findingsBySub = new Map(), limit = 8) {
  const out = []
  for (const s of subs || []) {
    const at = receivedAt(s)
    for (const f of findingsBySub.get(s?.id) || []) {
      out.push({
        key: `${s.id}:${f.id}`,
        submissionId: s.id,
        label: f.label,
        section: f.section,
        note: f.note,
        text: f.text,
        assetNo: s.asset_no || null,
        template: s.template_name || s.title || 'Checklist',
        at,
      })
    }
  }
  return out.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity)).slice(0, limit)
}

/** Findings grouped by section label, largest first; the tail folds into "Other". */
export function findingsBySection(subs = [], findingsBySub = new Map(), top = 5) {
  const m = new Map()
  for (const s of subs || []) {
    for (const f of findingsBySub.get(s?.id) || []) {
      const k = String(f.section || 'Responses')
      m.set(k, (m.get(k) || 0) + 1)
    }
  }
  const sorted = [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  if (sorted.length <= top) return sorted
  const head = sorted.slice(0, top)
  const rest = sorted.slice(top).reduce((n, x) => n + x.count, 0)
  return [...head, { label: 'Other sections', count: rest }]
}

/**
 * Submissions per day over the last `days` days (today included), split into
 * done (approved or completed), pending and rejected. Drafts and unknown
 * states are not drawn as a line; they are not part of the approval flow.
 */
export function submissionTrend(subs = [], now = Date.now(), days = 30) {
  const out = []
  const index = new Map()
  for (let i = days - 1; i >= 0; i--) {
    const key = localDayKey(now - i * DAY_MS)
    const row = { day: key, done: 0, pending: 0, rejected: 0 }
    index.set(key, row)
    out.push(row)
  }
  for (const s of subs || []) {
    const row = index.get(localDayKey(receivedAt(s)))
    if (!row) continue
    const b = workspaceBucket(s)
    if (b === 'approved' || b === 'completed') row.done += 1
    else if (b === 'pending') row.pending += 1
    else if (b === 'rejected') row.rejected += 1
  }
  return out
}

/** Every photo on a submission, flattened, with the line it belongs to. */
export function submissionPhotos(sub, sections = []) {
  const labels = new Map()
  for (const s of sections || []) for (const r of s.rows) labels.set(String(r.id), r.label)
  const photos = sub?.photos && typeof sub.photos === 'object' && !Array.isArray(sub.photos) ? sub.photos : {}
  const out = []
  for (const [fieldId, arr] of Object.entries(photos)) {
    if (!Array.isArray(arr)) continue
    arr.forEach((src, i) => {
      if (typeof src === 'string' && src) out.push({ key: `${fieldId}:${i}`, src, fieldId, label: labels.get(String(fieldId)) || null })
    })
  }
  return out
}

/**
 * The record's history: when it arrived, then each approval rung with who and
 * when. A sheet that needed no approval says so rather than drawing an empty
 * ladder that reads as "nobody signed".
 */
export function submissionHistory(sub, template = null) {
  if (!sub) return []
  const events = [{
    key: 'submitted',
    label: 'Submitted',
    name: sub.printed_name ? String(sub.printed_name) : null,
    at: sub.submitted_at || sub.created_at || null,
    state: 'done',
  }]
  const a = norm(sub.approval_status)
  if (a === 'not_required' || !a) {
    events.push({ key: 'no_approval', label: a ? 'No approval required' : 'Approval not recorded', name: null, at: null, state: 'info' })
    return events
  }
  for (const rung of approvalProgress(template, sub)) {
    events.push({
      key: rung.key,
      label: rung.label,
      name: rung.name || null,
      at: rung.at || null,
      state: rung.done ? 'done' : rung.current ? 'current' : 'waiting',
    })
  }
  if (a === 'rejected') {
    events.push({ key: 'rejected', label: 'Rejected', name: sub.approver_name || null, at: sub.approved_at || null, state: 'bad', note: sub.review_note || null })
  } else if (sub.review_note) {
    events.push({ key: 'note', label: 'Review note', name: null, at: null, state: 'info', note: sub.review_note })
  }
  return events
}
