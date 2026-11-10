/**
 * Data access for expert labelling of AI tyre photos (evaluation data only).
 *
 * Reads completed AI jobs + their inspections under RLS, and reads/writes the reviewer's own rows
 * in ai_tyre_expert_labels (migration 20261112104000). Job review state is NOT touched here: that
 * stays with the ai-tyre-inspection edge function. Provenance on a label is re-stamped by the DB.
 */
import { supabase, fetchAllOrThrow, isNotProvisioned, toServiceError } from './_client'

const JOB_COLS = 'id,inspection_id,tyre_position,photo_ref,status,analysis,model_version,prompt_version,review_status,created_at'
const INSPECTION_COLS = 'id,asset_no,vehicle_type,site,inspection_date,tyre_conditions'
const LABEL_COLS = 'id,job_id,inspection_id,tyre_position,photo_ref,model_version,prompt_version,reviewer_id,assessable,ai_defect_verdicts,missed_defects,expected_defects,inspector_condition,tyre_serial,group_key,split,note,created_at,updated_at'
const MAX_JOBS = 20000
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n))

/** Completed AI jobs with their inspection: [{ job, inspection }]. */
export async function listLabellingCandidates() {
  const jobs = await fetchAllOrThrow((from, to) => supabase.from('ai_tyre_inspection_jobs')
    .select(JOB_COLS).eq('status', 'completed').order('created_at', { ascending: true }).order('id').range(from, to), { max: MAX_JOBS })
  const ids = Array.from(new Set(jobs.map((j) => j.inspection_id).filter(Boolean)))
  const inspections = new Map()
  for (const part of chunk(ids, 100)) {
    const rows = await fetchAllOrThrow((from, to) => supabase.from('inspections')
      .select(INSPECTION_COLS).in('id', part).order('id').range(from, to), { max: 1000 })
    rows.forEach((r) => inspections.set(r.id, r))
  }
  return {
    candidates: jobs.map((job) => ({ job, inspection: inspections.get(job.inspection_id) || null })),
    truncated: !!jobs.truncated,
  }
}

/** All labels visible to the reviewer. provisioned=false when the migration has not been applied. */
export async function listExpertLabels() {
  try {
    const rows = await fetchAllOrThrow((from, to) => supabase.from('ai_tyre_expert_labels')
      .select(LABEL_COLS).order('created_at', { ascending: true }).order('id').range(from, to), { max: MAX_JOBS * 2 })
    return { rows, provisioned: true, truncated: !!rows.truncated }
  } catch (err) {
    if (isNotProvisioned(err) || isNotProvisioned(err?.cause)) return { rows: [], provisioned: false, truncated: false }
    throw err
  }
}

/** Insert or replace the caller's own label for one photo (unique per job + reviewer). */
export async function saveExpertLabel(payload) {
  const { data, error } = await supabase.from('ai_tyre_expert_labels')
    .upsert(payload, { onConflict: 'job_id,reviewer_id' }).select(LABEL_COLS).single()
  if (error) throw toServiceError(error, 'Could not save the label')
  return data
}

export async function deleteExpertLabel(id) {
  const { error } = await supabase.from('ai_tyre_expert_labels').delete().eq('id', id)
  if (error) throw toServiceError(error, 'Could not delete the label')
}

/** Display names for reviewer ids (Map id -> name). Falls back to the id when unreadable. */
export async function reviewerNames(ids) {
  const names = new Map()
  const keys = Array.from(new Set((ids || []).filter(Boolean)))
  for (const part of chunk(keys, 100)) {
    try {
      const rows = await fetchAllOrThrow((from, to) => supabase.from('profiles')
        .select('id,full_name,username').in('id', part).order('id').range(from, to), { max: 1000 })
      rows.forEach((p) => names.set(p.id, p.full_name || p.username || p.id))
    } catch { /* names are cosmetic; ids still identify the reviewer */ }
  }
  return names
}
