/**
 * Supabase boundary for the accident WORKSHOP DAMAGE ASSESSMENT report and, in
 * the same file, the per-region "mark damage" data that report is built from
 * (stored inside `damage_areas` jsonb - see PROJECT_MEMORY / the accident-case
 * plan for why this rides on the existing column instead of a new table).
 *
 * No dedicated write RPC exists for this table (unlike claims/repair below), so
 * this is a direct RLS-governed read/write, same convention as
 * accidentLiability.js / accidentHandover.js. SHIP-BEFORE-MIGRATE: a missing
 * table degrades to an honest empty/null state, never a thrown error.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const ASSESSMENT_COLS =
  'id,accident_id,country,site,assessor_id,assessor_name,assessed_at,damage_areas,' +
  'visible_damage,hidden_damage,estimated_labour_hours,estimated_parts_cost,' +
  'estimated_total_cost,recommended_route,recommended_offroad,estimated_downtime_days,' +
  'specialist_required,total_loss_possible,assessment_status,approved_by,approved_at,' +
  'created_by,created_at,updated_at'

/**
 * `recommended_route` tokens (accident_damage_assessments CHECK - verified live,
 * identical vocabulary to accident_repair_orders.repair_route so the assessment's
 * recommendation and the repair order it feeds always speak the same language).
 */
export const REPAIR_ROUTES = [
  'internal', 'external', 'insurer_approved', 'dealer', 'specialist',
  'temporary', 'replacement', 'total_loss', 'disposal', 'under_review', 'none',
]

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** The latest damage assessment for one case, or null if none recorded yet. */
export async function getDamageAssessment(accidentId) {
  if (!accidentId) return null
  return readOrEmpty(
    async () =>
      unwrap(
        await supabase
          .from('accident_damage_assessments')
          .select(ASSESSMENT_COLS)
          .eq('accident_id', accidentId)
          .order('assessed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    null,
  )
}

/**
 * Save (insert or update while still `assessment_status='draft'`) the damage
 * assessment for a case. Once submitted/approved the caller should insert a
 * new row rather than edit an already-routed assessment, so the history of
 * what was actually approved is never rewritten.
 *
 * @param {string} accidentId
 * @param {object} patch column values (see ASSESSMENT_COLS); `recommended_route`
 *   must be one of REPAIR_ROUTES when supplied.
 * @param {{existingId?:string, editable?:boolean}} [opts]
 */
export async function saveDamageAssessment(accidentId, patch, { existingId, editable = true } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (patch.recommended_route && !REPAIR_ROUTES.includes(patch.recommended_route)) {
    throw new Error(`Invalid repair route "${patch.recommended_route}".`)
  }
  const row = { accident_id: accidentId, ...patch }
  if (existingId && editable) {
    return unwrap(
      await supabase
        .from('accident_damage_assessments')
        .update(row)
        .eq('id', existingId)
        .select(ASSESSMENT_COLS)
        .single(),
    )
  }
  return unwrap(
    await supabase.from('accident_damage_assessments').insert(row).select(ASSESSMENT_COLS).single(),
  )
}

/** Submit an assessment (locks it for editing and records the route decision). */
export async function submitDamageAssessment(id) {
  if (!id) throw new Error('An assessment is required.')
  return unwrap(
    await supabase
      .from('accident_damage_assessments')
      .update({ assessment_status: 'submitted' })
      .eq('id', id)
      .select(ASSESSMENT_COLS)
      .single(),
  )
}

// ── damage marks (the per-region "Mark vehicle/equipment damage" tool) ────────
// Stored as damage_areas: [{ view, region_key, component_label, damage_type,
// severity, photo_refs: [], note }]. This is the ONE assessment's damage_areas
// array - a case with no assessment yet has nowhere to hold a mark, so callers
// must create a draft assessment first (saveDamageAssessment with no patch).

/** Append (or replace, by `region_key`+`view`) one marked area on an assessment's
 *  damage_areas array. Read-modify-write on the client because damage_areas is
 *  a single jsonb column, not a child table - callers should not call this
 *  concurrently for the same assessment. */
export async function upsertDamageMark(assessmentId, currentAreas, mark) {
  if (!assessmentId) throw new Error('A damage assessment is required.')
  if (!mark?.view || !mark?.region_key) throw new Error('A view and region are required to mark damage.')
  const areas = Array.isArray(currentAreas) ? currentAreas : []
  const idx = areas.findIndex((a) => a.view === mark.view && a.region_key === mark.region_key)
  const next = idx >= 0 ? areas.map((a, i) => (i === idx ? { ...a, ...mark } : a)) : [...areas, mark]
  return unwrap(
    await supabase
      .from('accident_damage_assessments')
      .update({ damage_areas: next })
      .eq('id', assessmentId)
      .select(ASSESSMENT_COLS)
      .single(),
  )
}

/** Remove one marked area from an assessment's damage_areas array. */
export async function removeDamageMark(assessmentId, currentAreas, view, regionKey) {
  if (!assessmentId) throw new Error('A damage assessment is required.')
  const areas = Array.isArray(currentAreas) ? currentAreas : []
  const next = areas.filter((a) => !(a.view === view && a.region_key === regionKey))
  return unwrap(
    await supabase
      .from('accident_damage_assessments')
      .update({ damage_areas: next })
      .eq('id', assessmentId)
      .select(ASSESSMENT_COLS)
      .single(),
  )
}
