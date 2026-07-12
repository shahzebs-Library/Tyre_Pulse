/**
 * Checklist service — custom checklist TEMPLATES and their SUBMISSIONS
 * (V123). Templates are org/country-scoped, versioned, and hold their fields as
 * embedded JSONB. Submissions capture answers + photos + signature and can route
 * through the Universal Approval Engine (entity_type 'checklist_submission').
 * Explicit column lists, null-safe country scoping — mirrors stock.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const TEMPLATE_COLS =
  'id,organisation_id,country,name,description,category,icon,status,version,require_signature,require_approval,scored,pass_threshold,fields,created_by,created_at,updated_at'
const SUBMISSION_COLS =
  'id,template_id,template_name,template_version,country,site,asset_no,title,status,answers,photos,signature_data,printed_name,score_pct,score_passed,submitted_by,submitted_at,created_at,updated_at'

const PHOTO_BUCKET = 'tyre-photos' // shared public media bucket (as inspections/accidents use)

// ── Templates ───────────────────────────────────────────────────────────────

/** List templates (most-recently-updated first), optionally by status/country. */
export async function listTemplates({ country, status, limit = 200 } = {}) {
  let q = supabase.from('checklist_templates').select(TEMPLATE_COLS)
  if (status) q = q.eq('status', status)
  q = applyCountry(q, country)
  return unwrap(await q.order('updated_at', { ascending: false }).limit(limit)) || []
}

export async function getTemplate(id) {
  return unwrap(await supabase.from('checklist_templates').select(TEMPLATE_COLS).eq('id', id).maybeSingle())
}

/** Create a template. `fields` is the embedded field array. Returns the new row. */
export async function createTemplate(values) {
  const payload = {
    name: values.name,
    description: values.description ?? null,
    category: values.category ?? null,
    icon: values.icon ?? null,
    country: values.country ?? null,
    status: values.status ?? 'draft',
    require_signature: !!values.require_signature,
    require_approval: !!values.require_approval,
    scored: !!values.scored,
    pass_threshold: values.pass_threshold ?? null,
    fields: Array.isArray(values.fields) ? values.fields : [],
  }
  return unwrap(await supabase.from('checklist_templates').insert(payload).select(TEMPLATE_COLS).single())
}

/** Patch a template. Bumps version when the field set changes. Returns the row. */
export async function updateTemplate(id, patch) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id
  return unwrap(await supabase.from('checklist_templates').update(clean).eq('id', id).select(TEMPLATE_COLS).single())
}

export async function publishTemplate(id) {
  return updateTemplate(id, { status: 'published' })
}
export async function archiveTemplate(id) {
  return updateTemplate(id, { status: 'archived' })
}

/** Duplicate a template into a new draft ("… (copy)"). Returns the new row. */
export async function duplicateTemplate(id) {
  const src = await getTemplate(id)
  if (!src) throw new Error('Template not found.')
  return createTemplate({
    name: `${src.name} (copy)`,
    description: src.description,
    category: src.category,
    icon: src.icon,
    country: src.country,
    status: 'draft',
    require_signature: src.require_signature,
    require_approval: src.require_approval,
    scored: src.scored,
    pass_threshold: src.pass_threshold,
    fields: src.fields || [],
  })
}

export async function deleteTemplate(id) {
  return unwrap(await supabase.from('checklist_templates').delete().eq('id', id))
}

// ── Submissions ─────────────────────────────────────────────────────────────

/** List submissions (newest first), optionally by template/country. */
export async function listSubmissions({ country, templateId, limit = 200 } = {}) {
  let q = supabase.from('checklist_submissions').select(SUBMISSION_COLS)
  if (templateId) q = q.eq('template_id', templateId)
  q = applyCountry(q, country)
  return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
}

export async function getSubmission(id) {
  return unwrap(await supabase.from('checklist_submissions').select(SUBMISSION_COLS).eq('id', id).maybeSingle())
}

/** Create a submission from a filled template. Returns the new row. */
export async function createSubmission(values) {
  const payload = {
    template_id: values.template_id ?? null,
    template_name: values.template_name ?? null,
    template_version: values.template_version ?? null,
    country: values.country ?? null,
    site: values.site ?? null,
    asset_no: values.asset_no ?? null,
    title: values.title ?? null,
    status: values.status ?? 'submitted',
    answers: values.answers ?? {},
    photos: values.photos ?? {},
    signature_data: values.signature_data ?? null,
    printed_name: values.printed_name ?? null,
    score_pct: values.score_pct ?? null,
    score_passed: values.score_passed ?? null,
  }
  return unwrap(await supabase.from('checklist_submissions').insert(payload).select(SUBMISSION_COLS).single())
}

export async function updateSubmission(id, patch) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id
  return unwrap(await supabase.from('checklist_submissions').update(clean).eq('id', id).select(SUBMISSION_COLS).single())
}

// ── Media ───────────────────────────────────────────────────────────────────

/**
 * Upload one checklist photo to the shared public media bucket and return its
 * public URL. `prefix` groups files (e.g. a submission/field key).
 */
export async function uploadChecklistPhoto(file, { prefix = 'misc' } = {}) {
  if (!file) throw new Error('No file provided.')
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const rand = Math.random().toString(36).slice(2, 8)
  const path = `checklists/${prefix}/${Date.now()}_${rand}.${ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  })
  if (error) throw new Error(error.message || 'Photo upload failed.')
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data?.publicUrl || null
}
