/**
 * Workshop job completions (migration 20261127150000): the evidence a
 * technician hands over when a job is finished on the phone, and the
 * supervisor's pass / return through `decide_job_completion`.
 *
 * Same RPC as the Flutter "Jobs to check" screen, so web and phone apply one
 * rule set: never your own job, one decision only, a reason on every return.
 * Reads go through RLS (supervisors see jobs they may quality-check; the data
 * desk sees returned ones).
 */
import { supabase, ServiceError } from './_client'

export const COMPLETION_QUEUES = Object.freeze({ toCheck: 'submitted', returned: 'returned' })

const COLS =
  'id,job_id,task_id,asset_no,site,kind,work_done,quick_picks,parts_used,' +
  'before_photos,after_photos,km,engine_hours,signature,completed_at,status,' +
  'decision_note,decided_at,decided_by,submitted_by,work_orders(work_order_no,status)'

/** True when the table is not there yet (migration not applied). */
function isMissing(error) {
  const code = String(error?.code || '')
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST200'
}

/**
 * List completions in one queue (`submitted` or `returned`), newest last for
 * the check queue, newest first for the returned queue. Names are joined from
 * profiles best effort. Returns { rows, provisioned }.
 */
export async function listJobCompletions(status = COMPLETION_QUEUES.toCheck) {
  if (!Object.values(COMPLETION_QUEUES).includes(status)) throw new ServiceError('Unknown queue.')
  const { data, error } = await supabase
    .from('work_order_completions')
    .select(COLS)
    .eq('status', status)
    .order(status === 'submitted' ? 'completed_at' : 'decided_at', { ascending: status === 'submitted' })
    .limit(100)
  if (error) {
    if (isMissing(error)) return { rows: [], provisioned: false }
    throw error
  }
  const rows = data || []
  const ids = [...new Set(rows.flatMap((r) => [r.submitted_by, r.decided_by]).filter(Boolean))]
  let names = {}
  if (ids.length) {
    const { data: people } = await supabase.from('profiles').select('id,full_name').in('id', ids)
    names = Object.fromEntries((people || []).filter((p) => p.full_name).map((p) => [p.id, p.full_name]))
  }
  return {
    provisioned: true,
    rows: rows.map((r) => ({
      ...r,
      work_order_no: r.work_orders?.work_order_no || null,
      technician_name: names[r.submitted_by] || null,
      decided_by_name: names[r.decided_by] || null,
    })),
  }
}

function newKey() {
  if (globalThis.crypto?.randomUUID) return `jobcheck_${globalThis.crypto.randomUUID()}`
  return `jobcheck_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Pass or return one completion. Returns { ok, reason, status } exactly as
 * the server answers; a refusal is the server's own sentence.
 */
export async function decideJobCompletion(completionId, decision, note) {
  if (!completionId) throw new ServiceError('A completion is required.')
  if (decision !== 'pass' && decision !== 'return') throw new ServiceError('Choose pass or return.')
  const trimmed = (note || '').trim()
  if (decision === 'return' && trimmed.length < 3) {
    return { ok: false, reason: 'Say why the job is returned.' }
  }
  const { data, error } = await supabase.rpc('decide_job_completion', {
    p_completion_id: completionId,
    p_decision: decision,
    p_note: trimmed || null,
    p_client_uuid: newKey(),
  })
  if (error) throw error
  return parseDecision(data)
}

/** Defensive read of the RPC answer. */
export function parseDecision(answer) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: null, status: null }
  const reason = typeof answer.reason === 'string' && answer.reason.trim() ? answer.reason.trim() : null
  return { ok: answer.ok === true, reason, status: answer.status || null }
}
