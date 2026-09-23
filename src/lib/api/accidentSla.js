/**
 * Supabase boundary for accident SLA timers - the "Open Xd / Next SLA / Due in"
 * chips on the case header and the pause/resume controls behind a stalled
 * workstream. Reads are direct (accident_sla_instances/_definitions carry the
 * live-computed due_at/warning_at/escalation_at, nothing to recompute
 * client-side). Writes go through the RPCs (verified live: accident_sla_start
 * returns the count of timers it created - 0 when one is already running for
 * that workstream, which is not an error; accident_sla_pause/_resume return
 * void and both require app_is_elevated(), no capability alternative).
 *
 * SHIP-BEFORE-MIGRATE, same as accidentCase.js: reads degrade to an honest
 * empty state via isMissingRelation.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const INSTANCE_COLS =
  'id,accident_id,country,site,sla_key,sla_definition_id,name,workstream_key,owner_id,' +
  'team,start_at,due_at,target_minutes,warning_at,escalation_at,escalation_level,state,' +
  'paused,total_paused_minutes,completed_at,breached,breach_minutes,created_at'

/** Pause reason tokens (accident_sla_pause_events CHECK, verified live). */
export const PAUSE_REASONS = [
  'waiting_authority_report', 'waiting_driver', 'waiting_third_party', 'waiting_insurer',
  'waiting_surveyor', 'waiting_management_approval', 'waiting_quotation', 'waiting_po',
  'waiting_parts', 'waiting_workshop_capacity', 'vehicle_unavailable', 'legal_hold',
  'weather_delay', 'site_access_restriction', 'other',
]

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** Every SLA timer on a case (running/paused/completed/breached), newest first. */
export async function listSlaInstances(accidentId) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_sla_instances')
          .select(INSTANCE_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false }),
      ) || []
    )
  }, [])
}

/**
 * The SLA the case header chips should show: the running timer with the
 * SOONEST due_at, or null when nothing is running. Client-side pick over
 * listSlaInstances() rather than a second query - the case detail page already
 * loads the list for the timeline.
 */
export function nextDueInstance(instances) {
  const running = (instances || []).filter((i) => i.state === 'running' && i.due_at)
  if (!running.length) return null
  return running.reduce((soonest, i) => (new Date(i.due_at) < new Date(soonest.due_at) ? i : soonest))
}

/** Start every active SLA definition matching a workstream (idempotent - a
 *  workstream that already has a live timer is skipped, not duplicated).
 *  Returns the number of NEW timers created. */
export async function startWorkstreamSla(accidentId, workstreamKey) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!workstreamKey) throw new Error('A workstream is required.')
  return unwrap(
    await supabase.rpc('accident_sla_start', { p_accident_id: accidentId, p_workstream_key: workstreamKey }),
  )
}

/** Pause a running SLA timer. `expectedResumeAt` is required by the server -
 *  a pause with no expected return date is not evidence of anything. */
export async function pauseSla(instanceId, { reason, expectedResumeAt, comments } = {}) {
  if (!instanceId) throw new Error('An SLA timer is required.')
  if (!PAUSE_REASONS.includes(reason)) throw new Error(`Invalid pause reason "${reason}".`)
  if (!expectedResumeAt) throw new Error('An expected resume date is required to pause an SLA timer.')
  unwrap(
    await supabase.rpc('accident_sla_pause', {
      p_instance_id: instanceId,
      p_reason: reason,
      p_expected_resume_at: expectedResumeAt,
      p_comments: comments ?? null,
    }),
  )
}

/** Resume a paused SLA timer (shifts every future target forward by the paused
 *  duration so the elapsed clock excludes the pause). */
export async function resumeSla(instanceId, comments) {
  if (!instanceId) throw new Error('An SLA timer is required.')
  unwrap(await supabase.rpc('accident_sla_resume', { p_instance_id: instanceId, p_comments: comments ?? null }))
}
