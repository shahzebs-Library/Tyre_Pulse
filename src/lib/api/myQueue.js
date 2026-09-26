/**
 * myQueue - reads for the personal queue on My Workspace.
 *
 * Every read is scoped to the signed-in person (owner / assignee / submitter)
 * and additionally bounded by the existing org, country and site RLS. Each
 * source is read independently; one failing source is reported in
 * `unavailable` and never blanks the others. Lists are deliberately short
 * (a personal queue, not a register) and each carries an exact server count so
 * the page can say "showing N of M" instead of implying completeness.
 */
import { supabase, applyCountry } from './_client'
import { listInspectionApprovals, listChecklistApprovals } from './approvalsQueue'
import { isClosedWorkOrder } from '../myQueueAnalytics'

export const QUEUE_LIST_LIMIT = 200
const RECENT_LIMIT = 25

const WO_COLS = 'id,work_order_no,asset_no,site,country,status,priority,work_type,opened_at,created_at,target_completion'
const CLOSED_FILTER = '("Completed","Closed","Cancelled")'

async function myWorkOrders(profileId, country, signal) {
  const owned = applyCountry(
    supabase.from('work_orders').select(WO_COLS, { count: 'exact' })
      .eq('assigned_owner_id', profileId)
      .not('status', 'in', CLOSED_FILTER)
      .order('target_completion', { ascending: true, nullsFirst: false })
      .order('id')
      .limit(QUEUE_LIST_LIMIT),
    country,
  ).abortSignal(signal)
  const assigned = supabase.from('wo_assignments').select('job_id')
    .eq('user_id', profileId).eq('active', true).order('id').limit(QUEUE_LIST_LIMIT)
    .abortSignal(signal)
  const [o, a] = await Promise.all([owned, assigned])
  if (o.error) throw o.error
  let rows = o.data || []
  let total = o.count ?? rows.length
  if (!a.error) {
    const have = new Set(rows.map(r => r.id))
    const ids = [...new Set((a.data || []).map(r => r.job_id).filter(id => id && !have.has(id)))]
    if (ids.length) {
      const extra = await applyCountry(
        supabase.from('work_orders').select(WO_COLS).in('id', ids.slice(0, QUEUE_LIST_LIMIT)).order('id').limit(QUEUE_LIST_LIMIT),
        country,
      ).abortSignal(signal)
      if (extra.error) throw extra.error
      const open = (extra.data || []).filter(r => !isClosedWorkOrder(r.status))
      rows = rows.concat(open)
      total += open.length
    }
  }
  return { rows, total }
}

async function myChecklistAssignments(role, country, signal) {
  if (!role) return { rows: [], total: 0 }
  const res = await applyCountry(
    supabase.from('checklist_assignments')
      .select('id,template_name,asset_no,site,country,assignee_role,due_date,status,created_at', { count: 'exact' })
      .eq('assignee_role', role)
      .not('status', 'in', '("completed","skipped")')
      .order('due_date', { ascending: true })
      .order('id')
      .limit(QUEUE_LIST_LIMIT),
    country,
  ).abortSignal(signal)
  if (res.error) throw res.error
  return { rows: res.data || [], total: res.count ?? (res.data || []).length }
}

async function myInspections(profileId, country, signal) {
  const res = await applyCountry(
    supabase.from('inspections')
      .select('id,document_no,asset_no,site,status,approval_status,inspection_date,created_at', { count: 'exact' })
      .eq('created_by', profileId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(RECENT_LIMIT),
    country,
  ).abortSignal(signal)
  if (res.error) throw res.error
  return { rows: res.data || [], total: res.count ?? (res.data || []).length }
}

async function myChecklists(profileId, country, signal) {
  const res = await applyCountry(
    supabase.from('checklist_submissions')
      .select('id,document_no,template_name,asset_no,site,status,approval_status,submitted_at', { count: 'exact' })
      .eq('submitted_by', profileId)
      .order('submitted_at', { ascending: false })
      .order('id')
      .limit(RECENT_LIMIT),
    country,
  ).abortSignal(signal)
  if (res.error) throw res.error
  return { rows: res.data || [], total: res.count ?? (res.data || []).length }
}

/**
 * Load every queue source for one person.
 * @param {{profileId:string, role?:string, country?:string, canApprove?:boolean, signal?:AbortSignal}} opts
 * @returns {Promise<{sources:object, totals:object, unavailable:object}>}
 */
export async function loadMyQueue({ profileId, role, country, canApprove = false, signal } = {}) {
  if (!profileId) throw new Error('Your profile is not loaded yet.')
  const tasks = {
    workOrders: myWorkOrders(profileId, country, signal),
    checklistAssignments: myChecklistAssignments(role, country, signal),
    myInspections: myInspections(profileId, country, signal),
    myChecklists: myChecklists(profileId, country, signal),
    approvalInspections: canApprove ? listInspectionApprovals({ country }).then(rows => ({ rows, total: rows.length })) : null,
    approvalChecklists: canApprove ? listChecklistApprovals({ country }).then(rows => ({ rows, total: rows.length })) : null,
  }
  const keys = Object.keys(tasks).filter(k => tasks[k])
  const settled = await Promise.allSettled(keys.map(k => tasks[k]))
  const sources = {}; const totals = {}; const unavailable = {}
  settled.forEach((r, i) => {
    const k = keys[i]
    if (r.status === 'fulfilled') { sources[k] = r.value.rows; totals[k] = r.value.total }
    else { sources[k] = []; totals[k] = null; unavailable[k] = true }
  })
  if (unavailable.approvalInspections || unavailable.approvalChecklists) unavailable.approvals = true
  return { sources, totals, unavailable }
}
