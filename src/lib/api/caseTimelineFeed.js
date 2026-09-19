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
import { listEvidence } from './accidentEvidence'
import { buildTimelineFeed, buildParticipants, groupMemberCounts } from '../caseTimelineFeed'

async function settle(promise, fallback) {
  try {
    return await promise
  } catch {
    return fallback
  }
}

/**
 * @param {object} acc - the already-loaded accidents row
 * @returns {Promise<{entries:object[], notifications:object[], participants:object[],
 *   groupCounts:Map<string,number>, evidence:object[]}>}
 *   `groupCounts` = NOTIFY_ROLES group key -> live member count (from the same
 *   profiles read that names actors), so the delivery log can print
 *   "Insurance · 3" from real role membership - never a made-up count.
 *   `evidence` = the case's accident_evidence rows (one bounded per-accident
 *   read; the composer derives "Verified n/n" chips from it).
 */
const EMPTY = { entries: [], notifications: [], participants: [], groupCounts: new Map(), evidence: [] }

export async function loadCaseTimeline(acc) {
  const accidentId = acc?.id
  if (!accidentId) return EMPTY
  const country = acc.country

  const [workstreamEvents, workstreamRows, communications, handovers, slaInstances, claim, profiles, evidence] = await Promise.all([
    settle(listWorkstreamEvents(accidentId, { country }), []),
    settle(listWorkstreams(accidentId, { country }), []),
    settle(listCommunications(accidentId), []),
    settle(listHandoverInspections(accidentId), []),
    settle(listSlaInstances(accidentId), []),
    settle(getInsuranceClaim(accidentId), null),
    settle(listProfiles(), []),
    settle(listEvidence(accidentId), []),
  ])

  const usersById = new Map((profiles || []).map((p) => [p.id, p]))
  const groupCounts = groupMemberCounts(profiles || [])

  const entries = buildTimelineFeed({
    acc, workstreamEvents, communications, handovers, slaInstances, claim, usersById, evidence, groupCounts,
  })
  const participants = buildParticipants({ workstreamRows, communications, handovers, usersById })

  return { entries, notifications: communications, participants, groupCounts, evidence }
}
