import { supabase, unwrap, ServiceError, isNotProvisioned } from './_client'
import { NOT_INSTALLED } from './workforceAssignments'

/**
 * Server-side team analytics (workforce_team_analytics). Every figure is aggregated in Postgres over
 * the COMPLETE set of assignments the caller may see (RLS decides), never a tally of one loaded page.
 * Window = assignments created in [from, to] (YYYY-MM-DD, inclusive; null = open).
 */
export async function getTeamAnalytics({ from = null, to = null, site = null } = {}) {
  if (from && to && from > to) throw new ServiceError('The start date must be on or before the end date')
  try {
    return unwrap(await supabase.rpc('workforce_team_analytics', {
      p_from: from || null, p_to: to || null, p_site: String(site || '').trim() || null,
    }))
  } catch (e) {
    if (isNotProvisioned(e)) throw new ServiceError(NOT_INSTALLED, e.code, e)
    throw e
  }
}

/** One employee's assignments in chronological order with every transition event. */
export async function getEmployeeTimeline(profileId, { from = null, to = null } = {}) {
  if (!profileId) throw new ServiceError('Employee required')
  try {
    return unwrap(await supabase.rpc('workforce_employee_timeline', {
      p_profile: profileId, p_from: from || null, p_to: to || null,
    }))
  } catch (e) {
    if (isNotProvisioned(e)) throw new ServiceError(NOT_INSTALLED, e.code, e)
    throw e
  }
}
