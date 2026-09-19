/**
 * Supabase boundary for `accident_case_communications` - the "Notification
 * delivery log" panel on the case timeline. No dedicated write RPC exists;
 * automated deliveries (email/in-app notices the workflow engine sends) are
 * expected to be inserted by that backend pipeline, not by this client layer.
 * The one write this module exposes is a MANUAL log entry (e.g. "called the
 * vendor"), which RLS allows directly - same convention as accidentLiability.js/
 * accidentHandover.js. SHIP-BEFORE-MIGRATE: a missing table degrades to [].
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const COMMS_COLS =
  'id,accident_id,country,site,channel,direction,subject,body,from_party,to_party,' +
  'external_party_type,reply_token,message_id,attachments,workstream_key,related_task_id,' +
  'occurred_at,author_id,author_name,created_at'

/** Channel/direction tokens (accident_case_communications CHECK, verified live). */
export const COMMS_CHANNELS = ['in_app', 'email_out', 'email_in', 'comment', 'call', 'external_portal']
export const COMMS_DIRECTIONS = ['outbound', 'inbound', 'internal']

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** The communications/delivery log for one case, newest first. */
export async function listCommunications(accidentId, { limit = 200 } = {}) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_case_communications')
          .select(COMMS_COLS)
          .eq('accident_id', accidentId)
          .order('occurred_at', { ascending: false })
          .limit(limit),
      ) || []
    )
  }, [])
}

/** Log a manual communication (a phone call, an in-person note) against a case. */
export async function logCommunication(accidentId, { channel, direction, subject, body, toParty, authorName, workstreamKey } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!COMMS_CHANNELS.includes(channel)) throw new Error(`Invalid channel "${channel}".`)
  if (!COMMS_DIRECTIONS.includes(direction)) throw new Error(`Invalid direction "${direction}".`)
  const row = {
    accident_id: accidentId,
    channel,
    direction,
    subject: subject ?? null,
    body: body ?? null,
    to_party: toParty ?? null,
    author_name: authorName ?? null,
    workstream_key: workstreamKey ?? null,
    occurred_at: new Date().toISOString(),
  }
  return unwrap(await supabase.from('accident_case_communications').insert(row).select(COMMS_COLS).single())
}
