/**
 * Supabase boundary for the "Case timeline & notifications" page. Loads every
 * real source the pure composer (src/lib/caseTimelineFeed.js) merges, in
 * parallel, each degrading independently (SHIP-BEFORE-MIGRATE, same convention
 * as accidentCase.js) so one missing/unprovisioned table never blanks the
 * whole page.
 *
 * Actor names: accident_case_workstream_events / accident_case_workstreams
 * only carry actor/owner UUIDs, so this loads the org's profiles (RLS already
 * lets any authenticated user read every profile in the org - same as
 * CaseWorkstreamsPanel's own owner-name lookup) and builds one id->profile map
 * shared by the feed composer and the Participants tab.
 */
import { listWorkstreamEvents, listWorkstreams } from './accidentCase'
import { listCommunications } from './accidentCommunications'
import { listHandoverInspections } from './accidentHandover'
import { listSlaInstances } from './accidentSla'
import { getInsuranceClaim } from './accidentInsuranceClaims'
import { listProfiles } from './users'
import { buildTimelineFeed, buildParticipants } from '../caseTimelineFeed'

async function settle(promise, fallback) {
  try {
    return await promise
  } catch {
    return fallback
  }
}

/**
 * @param {object} acc - the already-loaded accidents row
 * @returns {Promise<{entries:object[], notifications:object[], participants:object[]}>}
 */
export async function loadCaseTimeline(acc) {
  const accidentId = acc?.id
  if (!accidentId) return { entries: [], notifications: [], participants: [] }
  const country = acc.country

  const [workstreamEvents, workstreamRows, communications, handovers, slaInstances, claim, profiles] = await Promise.all([
    settle(listWorkstreamEvents(accidentId, { country }), []),
    settle(listWorkstreams(accidentId, { country }), []),
    settle(listCommunications(accidentId), []),
    settle(listHandoverInspections(accidentId), []),
    settle(listSlaInstances(accidentId), []),
    settle(getInsuranceClaim(accidentId), null),
    settle(listProfiles(), []),
  ])

  const usersById = new Map((profiles || []).map((p) => [p.id, p]))

  const entries = buildTimelineFeed({
    acc, workstreamEvents, communications, handovers, slaInstances, claim, usersById,
  })
  const participants = buildParticipants({ workstreamRows, communications, handovers, usersById })

  return { entries, notifications: communications, participants }
}
