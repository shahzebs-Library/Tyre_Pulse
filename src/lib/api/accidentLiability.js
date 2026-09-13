/**
 * Supabase boundary for accident LIABILITY (who was at fault, GCC split) and
 * AUTHORITY REPORTS (police / Najm / Taqdeer) - the "Responsibility and payment"
 * screen. Both tables were built in the same accident-module rebuild as
 * accidentCase.js but were never wired to a UI, so they carry no dedicated write
 * RPC - direct RLS-governed reads/writes, same convention as accidentCase.js's own
 * setWorkstreamStatus/requestClosure (explicit column lists, unwrap() on every
 * write, org/country/site isolation enforced server-side by RLS).
 *
 * SHIP-BEFORE-MIGRATE, same as accidentCase.js: a missing table degrades to an
 * honest empty/null state via isMissingRelation, never a thrown error.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const LIABILITY_COLS =
  'id,accident_id,country,site,liability_type,our_liability_pct,third_party_pct,' +
  'other_party_pct,preventable,severity_classification,immediate_cause,root_cause,' +
  'contributing_factors,driver_violation,unsafe_act,unsafe_condition,weather_condition,' +
  'road_condition,approved,approved_by,approved_at,locked,change_reason,' +
  'supporting_document,created_by,created_at,updated_at'

const AUTHORITY_COLS =
  'id,accident_id,country,site,authority_type,report_no,report_date,report_status,' +
  'no_report_reason,liability_available,liability_pct_our,liability_pct_third,' +
  'storage_ref,notes,created_by,created_at,updated_at'

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** The current liability assessment for one case, or null if none recorded yet
 *  (or the table is not provisioned). */
export async function getLiabilityAssessment(accidentId) {
  if (!accidentId) return null
  return readOrEmpty(
    async () =>
      unwrap(
        await supabase
          .from('accident_liability_assessments')
          .select(LIABILITY_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    null,
  )
}

/**
 * Save (insert or, while unlocked, update) the liability assessment for a case.
 * A LOCKED assessment (approved + locked) is never overwritten silently - the
 * caller must pass `changeReason` to write a NEW row instead, preserving the
 * prior one for audit (matches `locked`/`change_reason` on the table).
 *
 * @param {string} accidentId
 * @param {object} patch column values (see LIABILITY_COLS)
 * @param {{existingId?:string, isLocked?:boolean}} [opts]
 */
export async function saveLiabilityAssessment(accidentId, patch, { existingId, isLocked } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (isLocked && !patch.change_reason) {
    throw new Error('A change reason is required to revise a locked liability assessment.')
  }
  const row = { accident_id: accidentId, ...patch }
  if (existingId && !isLocked) {
    return unwrap(
      await supabase
        .from('accident_liability_assessments')
        .update(row)
        .eq('id', existingId)
        .select(LIABILITY_COLS)
        .single(),
    )
  }
  return unwrap(
    await supabase.from('accident_liability_assessments').insert(row).select(LIABILITY_COLS).single(),
  )
}

/** Approve (and lock) a liability assessment. Locking is what makes a later
 *  edit require a change reason instead of silently overwriting the record. */
export async function approveLiabilityAssessment(id, approvedBy) {
  if (!id) throw new Error('A liability assessment is required.')
  return unwrap(
    await supabase
      .from('accident_liability_assessments')
      .update({ approved: true, approved_by: approvedBy ?? null, approved_at: new Date().toISOString(), locked: true })
      .eq('id', id)
      .select(LIABILITY_COLS)
      .single(),
  )
}

/** Authority reports (police / Najm / Taqdeer) for one case, newest first. */
export async function listAuthorityReports(accidentId) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_authority_reports')
          .select(AUTHORITY_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false }),
      ) || []
    )
  }, [])
}

/**
 * Record or update one authority report (`authority_type` is the natural key
 * per case: police | najm | taqdeer | other). Upserts on (accident_id,
 * authority_type) so re-saving the Najm row never creates a duplicate.
 */
export async function saveAuthorityReport(accidentId, authorityType, patch) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!authorityType) throw new Error('An authority type is required.')
  const row = { accident_id: accidentId, authority_type: authorityType, ...patch }
  return unwrap(
    await supabase
      .from('accident_authority_reports')
      .upsert(row, { onConflict: 'accident_id,authority_type' })
      .select(AUTHORITY_COLS)
      .single(),
  )
}
