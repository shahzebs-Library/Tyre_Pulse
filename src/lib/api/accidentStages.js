/**
 * Supabase boundary for the accident stage ledger (V398).
 *
 * `accident_stage_events` is WRITTEN ONLY by the DEFINER trigger
 * trg_accident_log_stage_event - there is no client insert path and no INSERT
 * policy, so nobody can forge a stage history. This module reads it, and writes
 * only the accident columns a stage's owning team is responsible for.
 *
 * The field-ownership map is the pure engine (src/lib/accidentStages.js); this
 * file never decides which fields belong to whom, it only refuses to write a
 * column that the named stage does not own.
 */
import { supabase, unwrap, applyCountry, isMissingRelation } from './_client'
import { STAGE_FIELDS } from '../accidentStages'

const EVENT_COLS =
  'id,accident_id,country,site,stage,department,entered_at,exited_at,' +
  'entered_by,exited_by,skipped,basis,note'

/**
 * Stage history for ONE case, oldest first.
 * Degrades to [] before the migration so the detail panel renders the ladder
 * from the record alone rather than failing.
 */
export async function listCaseStageEvents(accidentId) {
  if (!accidentId) return []
  try {
    return unwrap(await supabase
      .from('accident_stage_events')
      .select(EVENT_COLS)
      .eq('accident_id', accidentId)
      .order('entered_at', { ascending: true })
      .limit(200)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * The OPEN stage event for many cases at once, plus every skip.
 *
 * This is what the board needs and it is deliberately not "every event ever":
 * a per-team median only needs the visit currently open, and the skip rows are
 * what expose a case that jumped. Fetching the full history of every case would
 * grow without bound for no extra answer.
 */
export async function listOpenStageEvents({ country, limit = 2000 } = {}) {
  try {
    let q = supabase
      .from('accident_stage_events')
      .select(EVENT_COLS)
      .or('exited_at.is.null,skipped.is.true')
      .order('entered_at', { ascending: false })
      .limit(limit)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Save the fields a stage's owning team is responsible for.
 *
 * THE GUARD IS THE POINT: only columns listed under that stage in STAGE_FIELDS
 * are written. Without it this becomes a general-purpose accident writer with a
 * stage name attached, and the Insurance panel could quietly rewrite the repair
 * cost. Anything not owned by the stage is dropped, and the caller is told.
 *
 * @returns {Promise<{ row:object, written:string[], rejected:string[] }>}
 */
export async function saveStageFields(accidentId, stage, values = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  const spec = STAGE_FIELDS[stage]
  if (!spec) throw new Error('That stage is not part of the claim workflow.')

  const owned = new Set([...(spec.required || []), ...(spec.optional || [])].map((f) => f.key))
  const patch = {}
  const rejected = []
  for (const [k, v] of Object.entries(values || {})) {
    if (owned.has(k)) patch[k] = v === '' ? null : v
    else rejected.push(k)
  }
  if (!Object.keys(patch).length) {
    return { row: null, written: [], rejected }
  }

  const row = unwrap(await supabase
    .from('accidents')
    .update(patch)
    .eq('id', accidentId)
    .select('id,workflow_stage,status')
    .single())
  return { row, written: Object.keys(patch), rejected }
}

/**
 * Move a case to another stage. Thin wrapper over the existing
 * setAccidentStage service so there is ONE stage-advance path; the V398 trigger
 * records the transition (and any stages jumped over) either way.
 */
export async function advanceStage(accidentId, stage) {
  const row = unwrap(await supabase
    .from('accidents')
    .update({ workflow_stage: stage })
    .eq('id', accidentId)
    .select('id,workflow_stage,status')
    .single())
  return row
}
