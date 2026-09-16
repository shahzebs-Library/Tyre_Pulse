/**
 * Supabase boundary for accident LIABILITY (who was at fault, GCC split, who
 * pays, third-party details) and AUTHORITY REPORTS (police / Najm / Taqdeer) -
 * the "Responsibility and payment" screen. Both tables were built in the same
 * accident-module rebuild as accidentCase.js but were never wired to a UI, so
 * they carry no dedicated write RPC - direct RLS-governed reads/writes, same
 * convention as accidentCase.js's own setWorkstreamStatus/requestClosure
 * (explicit column lists, unwrap() on every write, org/country/site isolation
 * enforced server-side by RLS).
 *
 * SHIP-BEFORE-MIGRATE, same as accidentCase.js: a missing table degrades to an
 * honest empty/null state via isMissingRelation, never a thrown error.
 *
 * COLUMN FALLBACK (2026-09-16): the mock-parity migration
 * (supabase/migrations/20260916130000_accident_mock_field_parity.sql) adds the
 * PARITY columns below to accident_liability_assessments. It is authored but
 * NOT applied live. PostgREST fails the WHOLE request on an unknown column, so
 * every read/write here first tries the full list and, when isMissingColumn()
 * says the parity columns do not exist yet, falls back to the BASE list and
 * reports `parityProvisioned: false` so the panel can say so honestly instead
 * of failing.
 */
import { supabase, unwrap, isMissingRelation, isMissingColumn } from './_client'

const LIABILITY_BASE_COLS =
  'id,accident_id,country,site,liability_type,our_liability_pct,third_party_pct,' +
  'other_party_pct,preventable,severity_classification,immediate_cause,root_cause,' +
  'contributing_factors,driver_violation,unsafe_act,unsafe_condition,weather_condition,' +
  'road_condition,approved,approved_by,approved_at,locked,change_reason,' +
  'supporting_document,created_by,created_at,updated_at'

/** Columns added by the 2026-09-16 parity migration (may be absent live). */
export const LIABILITY_PARITY_FIELDS = Object.freeze([
  'payer', 'responsible_company', 'recovery_required',
  'third_party_plate', 'third_party_driver', 'third_party_phone', 'third_party_insurer',
  'taqdeer_required', 'field_audit',
])

const LIABILITY_COLS = `${LIABILITY_BASE_COLS},${LIABILITY_PARITY_FIELDS.join(',')}`

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

/** Strip the parity columns from a write payload (used when they are not provisioned). */
export function stripParityFields(patch) {
  const out = { ...(patch || {}) }
  for (const k of LIABILITY_PARITY_FIELDS) delete out[k]
  return out
}

/**
 * Run `fn(cols, parity)` with the full column list; if the parity columns are
 * missing live, run it again with the base list. Returns
 * `{ result, parityProvisioned }`.
 */
async function withColumnFallback(fn) {
  try {
    return { result: await fn(LIABILITY_COLS, true), parityProvisioned: true }
  } catch (err) {
    if (!isMissingColumn(err)) throw err
    return { result: await fn(LIABILITY_BASE_COLS, false), parityProvisioned: false }
  }
}

/**
 * The current liability assessment for one case plus whether the parity
 * columns are provisioned. `assessment` is null when none recorded yet (or the
 * table is not provisioned).
 * @returns {Promise<{assessment: object|null, parityProvisioned: boolean}>}
 */
export async function getLiabilityAssessmentWithMeta(accidentId) {
  if (!accidentId) return { assessment: null, parityProvisioned: true }
  return readOrEmpty(async () => {
    const { result, parityProvisioned } = await withColumnFallback(async (cols) =>
      unwrap(
        await supabase
          .from('accident_liability_assessments')
          .select(cols)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    )
    return { assessment: result || null, parityProvisioned }
  }, { assessment: null, parityProvisioned: true })
}

/** The current liability assessment for one case, or null if none recorded yet
 *  (or the table is not provisioned). */
export async function getLiabilityAssessment(accidentId) {
  const { assessment } = await getLiabilityAssessmentWithMeta(accidentId)
  return assessment
}

/**
 * Save (insert or, while unlocked, update) the liability assessment for a case.
 * A LOCKED assessment (approved + locked) is never overwritten silently - the
 * caller must pass `changeReason` to write a NEW row instead, preserving the
 * prior one for audit (matches `locked`/`change_reason` on the table).
 *
 * When the parity columns are not provisioned the write is retried WITHOUT
 * them; the returned row then carries `_parityProvisioned: false` so the caller
 * knows those values were not stored.
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
  const { result, parityProvisioned } = await withColumnFallback(async (cols, parity) => {
    const row = { accident_id: accidentId, ...(parity ? patch : stripParityFields(patch)) }
    if (existingId && !isLocked) {
      return unwrap(
        await supabase
          .from('accident_liability_assessments')
          .update(row)
          .eq('id', existingId)
          .select(cols)
          .single(),
      )
    }
    return unwrap(await supabase.from('accident_liability_assessments').insert(row).select(cols).single())
  })
  return parityProvisioned ? result : { ...result, _parityProvisioned: false }
}

/** Approve (and lock) a liability assessment. Locking is what makes a later
 *  edit require a change reason instead of silently overwriting the record. */
export async function approveLiabilityAssessment(id, approvedBy) {
  if (!id) throw new Error('A liability assessment is required.')
  const { result } = await withColumnFallback(async (cols) =>
    unwrap(
      await supabase
        .from('accident_liability_assessments')
        .update({ approved: true, approved_by: approvedBy ?? null, approved_at: new Date().toISOString(), locked: true })
        .eq('id', id)
        .select(cols)
        .single(),
    ),
  )
  return result
}

/** Pure: merge one field's audit entry into a field_audit map (never mutates). */
export function mergeFieldAudit(fieldAudit, fieldKey, entry) {
  const base = fieldAudit && typeof fieldAudit === 'object' ? fieldAudit : {}
  return { ...base, [fieldKey]: { ...(base[fieldKey] || {}), ...(entry || {}) } }
}

/**
 * Persist a merged `field_audit` map ({field_key:{recorded_by, recorded_at,
 * verification, verified_by, verified_at}}) on the case's liability assessment.
 * Inserts the assessment row when none exists yet. Requires the parity
 * migration; a missing column surfaces as an isMissingColumn error for the
 * caller to render as "not provisioned yet".
 *
 * @param {string} accidentId
 * @param {{existingId?:string, fieldAudit:object}} args
 */
export async function saveFieldAudit(accidentId, { existingId, fieldAudit }) {
  if (!accidentId) throw new Error('An incident is required.')
  const audit = fieldAudit && typeof fieldAudit === 'object' ? fieldAudit : {}
  if (existingId) {
    return unwrap(
      await supabase
        .from('accident_liability_assessments')
        .update({ field_audit: audit })
        .eq('id', existingId)
        .select(LIABILITY_COLS)
        .single(),
    )
  }
  return unwrap(
    await supabase
      .from('accident_liability_assessments')
      .insert({ accident_id: accidentId, field_audit: audit })
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
