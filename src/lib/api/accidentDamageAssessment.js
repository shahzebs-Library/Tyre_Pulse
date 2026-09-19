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
import { supabase, unwrap, isMissingRelation, isMissingColumn } from './_client'
import { parsePhoneMarks, mergeMarks } from '../vehicleDamageViews'

const BASE_COLS =
  'id,accident_id,country,site,assessor_id,assessor_name,assessed_at,damage_areas,' +
  'visible_damage,hidden_damage,estimated_labour_hours,estimated_parts_cost,' +
  'estimated_total_cost,recommended_route,recommended_offroad,estimated_downtime_days,' +
  'specialist_required,total_loss_possible,assessment_status,approved_by,approved_at,' +
  'created_by,created_at,updated_at'

/**
 * Columns added by supabase/migrations/20260916130000_accident_mock_field_parity.sql
 * (mock M5: safe to move, recovery required, labour cost split, parts
 * availability counters, route reason). NOT applied live yet - every read
 * tries the full list first and falls back to BASE_COLS on a missing-column
 * error, and every write strips these keys and retries on the same error, so
 * the panel works today and simply gains the fields the moment the migration
 * lands. Nothing is fabricated in the fallback: the fields read as absent.
 */
export const PARITY_COLS = [
  'safe_to_move', 'recovery_required', 'estimated_labour_cost',
  'parts_available_count', 'parts_special_order_count', 'route_reason',
]
const ASSESSMENT_COLS = BASE_COLS + ',' + PARITY_COLS.join(',')

/** Remembered once a missing-column error is seen, so later calls skip the failing attempt. */
let parityColsMissing = false
const stripParity = (row) => {
  const out = { ...row }
  for (const k of PARITY_COLS) delete out[k]
  return out
}
/** Run `fn(cols, row)`; on a missing-column error retry once without the parity columns. */
async function withParityFallback(fn, row) {
  if (!parityColsMissing) {
    try {
      return await fn(ASSESSMENT_COLS, row)
    } catch (err) {
      if (!isMissingColumn(err)) throw err
      parityColsMissing = true
    }
  }
  return fn(BASE_COLS, row ? stripParity(row) : row)
}
/** True once the live table has been seen WITHOUT the parity columns. */
export function parityColumnsUnavailable() { return parityColsMissing }
/** Test hook: forget the remembered fallback state. */
export function _resetParityFallback() { parityColsMissing = false }

/**
 * `recommended_route` tokens (accident_damage_assessments CHECK - verified live,
 * identical vocabulary to accident_repair_orders.repair_route so the assessment's
 * recommendation and the repair order it feeds always speak the same language).
 */
export const REPAIR_ROUTES = [
  'internal', 'external', 'on_site', 'insurer_approved', 'dealer', 'specialist',
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
    () => withParityFallback(async (cols) =>
      unwrap(
        await supabase
          .from('accident_damage_assessments')
          .select(cols)
          .eq('accident_id', accidentId)
          .order('assessed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      )),
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
  return withParityFallback(async (cols, r) => {
    if (existingId && editable) {
      return unwrap(
        await supabase
          .from('accident_damage_assessments')
          .update(r)
          .eq('id', existingId)
          .select(cols)
          .single(),
      )
    }
    return unwrap(
      await supabase.from('accident_damage_assessments').insert(r).select(cols).single(),
    )
  }, row)
}

/** Submit an assessment (locks it for editing and records the route decision). */
export async function submitDamageAssessment(id) {
  if (!id) throw new Error('An assessment is required.')
  return withParityFallback(async (cols) =>
    unwrap(
      await supabase
        .from('accident_damage_assessments')
        .update({ assessment_status: 'submitted' })
        .eq('id', id)
        .select(cols)
        .single(),
    ))
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
  return writeDamageAreas(assessmentId, next)
}

/** Persist a whole replacement damage_areas array (shared by the mark writers
 *  and the assessment tab's per-row Action select). */
export async function writeDamageAreas(assessmentId, areas) {
  if (!assessmentId) throw new Error('A damage assessment is required.')
  return withParityFallback(async (cols) =>
    unwrap(
      await supabase
        .from('accident_damage_assessments')
        .update({ damage_areas: Array.isArray(areas) ? areas : [] })
        .eq('id', assessmentId)
        .select(cols)
        .single(),
    ))
}

/**
 * Read every damage mark for a case from BOTH sources: the assessment's
 * damage_areas (authoritative, written by the web) and the Flutter app's
 * accidents.damage_description JSON {"version":2,"marks":[...]} (read-only
 * fallback so a mark made on the phone appears on web). Never throws for the
 * phone half - a free-text damage_description or a missing column simply
 * contributes no marks. Merge rule: mergeMarks (assessment wins per identity).
 *
 * @returns {Promise<{assessment: object|null, marks: object[], counts: {assessment:number, mobile:number}}>}
 */
export async function readMarks(accidentId) {
  if (!accidentId) return { assessment: null, marks: [], counts: { assessment: 0, mobile: 0 } }
  const assessment = await getDamageAssessment(accidentId)
  let phone = []
  try {
    const row = await readOrEmpty(
      async () =>
        unwrap(
          await supabase.from('accidents').select('damage_description').eq('id', accidentId).maybeSingle(),
        ),
      null,
    )
    phone = parsePhoneMarks(row?.damage_description)
  } catch {
    phone = [] // the phone source is a convenience, never a reason to fail the tab
  }
  const marks = mergeMarks(assessment?.damage_areas, phone)
  return {
    assessment,
    marks,
    counts: {
      assessment: marks.filter((m) => m.source === 'assessment').length,
      mobile: marks.filter((m) => m.source === 'mobile').length,
    },
  }
}

/** Remove one marked area from an assessment's damage_areas array. */
export async function removeDamageMark(assessmentId, currentAreas, view, regionKey) {
  if (!assessmentId) throw new Error('A damage assessment is required.')
  const areas = Array.isArray(currentAreas) ? currentAreas : []
  const next = areas.filter((a) => !(a.view === view && a.region_key === regionKey))
  return writeDamageAreas(assessmentId, next)
}

// ── repair order parity columns (mock M5 section 4) ──────────────────────────
// accident_repair_orders gains vendor_city / expected_duration_days /
// quotation_status in the parity migration. The existing upsert RPC
// (accidentRepairOrders.js) does not take them, so they are written by a
// direct RLS-governed UPDATE here. Returns the patched columns, or null when
// the table does not carry them yet (the caller says so; nothing is invented).
const ORDER_PARITY_COLS = ['vendor_city', 'expected_duration_days', 'quotation_status']
let orderParityMissing = false

export async function patchRepairOrderParity(repairOrderId, patch) {
  if (!repairOrderId) return null
  const row = {}
  for (const k of ORDER_PARITY_COLS) if (patch && k in patch) row[k] = patch[k]
  if (Object.keys(row).length === 0 || orderParityMissing) return null
  try {
    return unwrap(
      await supabase
        .from('accident_repair_orders')
        .update(row)
        .eq('id', repairOrderId)
        .select('id,' + ORDER_PARITY_COLS.join(','))
        .single(),
    )
  } catch (err) {
    if (isMissingColumn(err)) { orderParityMissing = true; return null }
    throw err
  }
}
