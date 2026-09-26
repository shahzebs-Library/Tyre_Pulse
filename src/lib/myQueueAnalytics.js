/**
 * myQueueAnalytics - pure engine behind the personal queue on My Workspace.
 *
 * Folds the signed-in person's own work into ONE list of queue items:
 *   - open work orders assigned to them (owner or active assignment),
 *   - approvals waiting on them (only when their role may approve),
 *   - checklist assignments due for their role,
 *   - their own recent inspections and checklist submissions.
 *
 * Nothing here fetches; the service `src/lib/api/myQueue.js` supplies rows.
 * A source that could not be read is reported as `unavailable`, never as zero,
 * so "nothing waiting" and "we could not look" stay different statements.
 */

const DAY = 86400000
export const DUE_SOON_DAYS = 3

const CLOSED_WO = new Set(['completed', 'closed', 'cancelled', 'canceled', 'done'])

/** @returns {boolean} work order status counts as finished */
export function isClosedWorkOrder(status) {
  return CLOSED_WO.has(String(status || '').trim().toLowerCase())
}

function toTime(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Whole days from `now` to `due` (negative = overdue), or null when unknown. */
export function daysUntil(due, now = Date.now()) {
  const t = toTime(due)
  if (t == null) return null
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const d = new Date(t); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - startOfToday.getTime()) / DAY)
}

/** Whole days since `v`, or null. */
export function ageDays(v, now = Date.now()) {
  const t = toTime(v)
  if (t == null) return null
  return Math.max(0, Math.floor((now - t) / DAY))
}

function dueState(days) {
  if (days == null) return 'none'
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_DAYS) return 'due_soon'
  return 'later'
}

export const QUEUE_KINDS = Object.freeze({
  work_order: { label: 'Work order', group: 'work' },
  approval_inspection: { label: 'Inspection approval', group: 'approval' },
  approval_checklist: { label: 'Checklist approval', group: 'approval' },
  checklist_due: { label: 'Checklist due', group: 'due' },
  my_inspection: { label: 'My inspection', group: 'recent' },
  my_checklist: { label: 'My checklist', group: 'recent' },
})

/**
 * Build the queue.
 * @param {object} src
 * @param {Array} [src.workOrders]
 * @param {Array} [src.approvalInspections]
 * @param {Array} [src.approvalChecklists]
 * @param {Array} [src.checklistAssignments]
 * @param {Array} [src.myInspections]
 * @param {Array} [src.myChecklists]
 * @param {number} [now]
 */
export function buildMyQueue(src = {}, now = Date.now()) {
  const items = []
  const seenWo = new Set()
  for (const w of src.workOrders || []) {
    if (!w?.id || seenWo.has(w.id) || isClosedWorkOrder(w.status)) continue
    seenWo.add(w.id)
    const days = daysUntil(w.target_completion, now)
    items.push({
      kind: 'work_order', id: `wo:${w.id}`,
      title: w.work_order_no || 'Work order',
      subtitle: [w.asset_no, w.site, w.work_type].filter(Boolean).join(' | '),
      status: w.status || 'Not recorded', priority: w.priority || null,
      due: w.target_completion || null, dueDays: days, dueState: dueState(days),
      age: ageDays(w.opened_at || w.created_at, now),
      link: '/work-orders',
    })
  }
  for (const r of src.approvalInspections || []) {
    if (!r?.id) continue
    items.push({
      kind: 'approval_inspection', id: `ai:${r.id}`,
      title: r.asset_no ? `Inspection ${r.asset_no}` : 'Inspection',
      subtitle: [r.site, r.inspector].filter(Boolean).join(' | '),
      status: 'Waiting for approval', priority: null,
      due: null, dueDays: null, dueState: 'none',
      age: ageDays(r.created_at, now), link: '/approvals',
    })
  }
  for (const r of src.approvalChecklists || []) {
    if (!r?.id) continue
    items.push({
      kind: 'approval_checklist', id: `ac:${r.id}`,
      title: r.template_name || r.title || 'Checklist',
      subtitle: [r.asset_no, r.site].filter(Boolean).join(' | '),
      status: r.approval_status === 'pending_area_manager' ? 'Waiting for final sign-off' : 'Waiting for approval',
      priority: null, due: null, dueDays: null, dueState: 'none',
      age: ageDays(r.submitted_at, now), link: '/approvals',
    })
  }
  for (const a of src.checklistAssignments || []) {
    if (!a?.id) continue
    const st = String(a.status || '').toLowerCase()
    if (st === 'completed' || st === 'skipped') continue
    const days = daysUntil(a.due_date, now)
    items.push({
      kind: 'checklist_due', id: `cd:${a.id}`,
      title: a.template_name || 'Checklist',
      subtitle: [a.asset_no, a.site].filter(Boolean).join(' | '),
      status: a.status || 'Open', priority: null,
      due: a.due_date || null, dueDays: days, dueState: dueState(days),
      age: ageDays(a.created_at, now), link: '/my-checklists',
    })
  }
  for (const r of src.myInspections || []) {
    if (!r?.id) continue
    items.push({
      kind: 'my_inspection', id: `mi:${r.id}`,
      title: r.document_no || (r.asset_no ? `Inspection ${r.asset_no}` : 'Inspection'),
      subtitle: [r.asset_no, r.site].filter(Boolean).join(' | '),
      status: r.approval_status || r.status || 'Not recorded', priority: null,
      due: null, dueDays: null, dueState: 'none',
      age: ageDays(r.inspection_date || r.created_at, now), link: '/inspections',
    })
  }
  for (const r of src.myChecklists || []) {
    if (!r?.id) continue
    items.push({
      kind: 'my_checklist', id: `mc:${r.id}`,
      title: r.document_no || r.template_name || 'Checklist',
      subtitle: [r.asset_no, r.site].filter(Boolean).join(' | '),
      status: r.approval_status || r.status || 'Not recorded', priority: null,
      due: null, dueDays: null, dueState: 'none',
      age: ageDays(r.submitted_at, now), link: `/checklists/submission/${r.id}`,
    })
  }
  return items
}

/** KPI tiles. A source flagged unavailable yields null, never 0. */
export function queueKpis(items = [], unavailable = {}) {
  const count = (pred) => items.filter(pred).length
  const nul = (key, v) => (unavailable[key] ? null : v)
  return {
    openWork: nul('workOrders', count(i => i.kind === 'work_order')),
    overdue: count(i => i.dueState === 'overdue'),
    dueSoon: count(i => i.dueState === 'due_soon'),
    approvals: unavailable.approvals ? null : count(i => QUEUE_KINDS[i.kind]?.group === 'approval'),
    checklistsDue: nul('checklistAssignments', count(i => i.kind === 'checklist_due')),
    recent: count(i => QUEUE_KINDS[i.kind]?.group === 'recent'),
  }
}

/** Filter by group, due state and free text. */
export function filterQueue(items = [], { group = 'all', due = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return items.filter(i => {
    if (group !== 'all' && QUEUE_KINDS[i.kind]?.group !== group) return false
    if (due !== 'all' && i.dueState !== due) return false
    if (!q) return true
    return [i.title, i.subtitle, i.status, QUEUE_KINDS[i.kind]?.label].join(' ').toLowerCase().includes(q)
  })
}

const DUE_RANK = { overdue: 0, due_soon: 1, later: 2, none: 3 }

/** Sort: 'urgency' (overdue first, then oldest), 'age', 'title'. Never mutates. */
export function sortQueue(items = [], key = 'urgency') {
  const out = [...items]
  if (key === 'title') return out.sort((a, b) => String(a.title).localeCompare(String(b.title)))
  if (key === 'age') return out.sort((a, b) => (b.age ?? -1) - (a.age ?? -1))
  return out.sort((a, b) => {
    const r = DUE_RANK[a.dueState] - DUE_RANK[b.dueState]
    if (r) return r
    if (a.dueDays != null && b.dueDays != null && a.dueDays !== b.dueDays) return a.dueDays - b.dueDays
    return (b.age ?? -1) - (a.age ?? -1)
  })
}

/** Flat rows for Excel / PDF. */
export function queueExportRows(items = []) {
  return items.map(i => ({
    type: QUEUE_KINDS[i.kind]?.label || i.kind,
    title: i.title,
    detail: i.subtitle || 'N/A',
    status: i.status || 'N/A',
    due: i.due ? String(i.due).slice(0, 10) : 'N/A',
    due_state: { overdue: 'Overdue', due_soon: 'Due soon', later: 'Later', none: 'N/A' }[i.dueState],
    age_days: i.age ?? 'N/A',
  }))
}
