/**
 * Accident Report Builder — saved layout templates service.
 *
 * CRUD over accident_report_templates (V221): org-isolated RESTRICTIVE RLS +
 * per-user ownership (members manage their own, elevated roles manage any).
 * The `config` column stores the full builder state (ordered blocks + report
 * settings) as JSONB. Explicit column list, missing-relation → [] so the builder
 * degrades to local-only layouts before the migration is applied.
 */
import { supabase, unwrap, ServiceError } from './_client'

const COLS = 'id,name,description,config,created_by,created_at,updated_at'

/** True when the table isn't present yet (pre-migration) — callers degrade to []. */
function isMissingRelation(err) {
  const m = String(err?.message || err?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table') || m === '42p01'
}

/** List saved layouts, newest first. Returns [] if the table isn't migrated yet. */
export async function listTemplates() {
  const { data, error } = await supabase
    .from('accident_report_templates')
    .select(COLS)
    .order('updated_at', { ascending: false })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(error.message, error.code)
  }
  return data ?? []
}

/** Create a layout. `config` is the builder state object. Returns the new row. */
export async function createTemplate({ name, description = null, config }) {
  return unwrap(
    await supabase
      .from('accident_report_templates')
      .insert({ name, description, config })
      .select(COLS)
      .single(),
  )
}

/** Update a layout by id (name / description / config). Returns the updated row. */
export async function updateTemplate(id, patch) {
  return unwrap(
    await supabase
      .from('accident_report_templates')
      .update(patch)
      .eq('id', id)
      .select(COLS)
      .single(),
  )
}

/** Delete a layout by id. */
export async function deleteTemplate(id) {
  const { error } = await supabase.from('accident_report_templates').delete().eq('id', id)
  if (error) throw new ServiceError(error.message, error.code)
}
