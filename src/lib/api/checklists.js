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

const PHOTO_BUCKET = 'tyre-photos' // shared media bucket (private — served via signed URLs)
const SIGNED_URL_TTL_SECONDS = 60 * 60

// Extract the object path within PHOTO_BUCKET from a stored photo value, which
// may be a tp-storage ref, a Supabase public/sign URL, or a bare path.
function checklistPhotoPath(value) {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('tp-storage://')) {
    const rest = value.slice('tp-storage://'.length)
    const i = rest.indexOf('/')
    if (i <= 0) return null
    return rest.slice(0, i) === PHOTO_BUCKET ? rest.slice(i + 1) : null
  }
  const marker = `/${PHOTO_BUCKET}/`
  const idx = value.indexOf(marker)
  if (idx !== -1) return decodeURIComponent(value.slice(idx + marker.length).split('?')[0])
  if (!/^(https?:|data:|blob:)/.test(value)) return value.replace(/^\/+/, '')
  return null
}

/**
 * Resolve a stored checklist photo value to a short-lived signed URL that
 * renders in the browser and PDF. The bucket is private, so bare public URLs
 * 403; this converts them (and legacy/ref forms) into a working signed URL.
 * Best-effort: returns the original value if signing fails.
 */
export async function signChecklistPhotoUrl(value) {
  if (typeof value !== 'string' || !value) return value
  if (value.startsWith('data:') || value.startsWith('blob:')) return value
  const path = checklistPhotoPath(value)
  if (!path) return value
  try {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    return data?.signedUrl || value
  } catch { return value }
}

/** Sign every URL in a submission's { fieldId: [url, …] } photos map. */
async function signPhotosMap(photos) {
  if (!photos || typeof photos !== 'object') return photos
  const out = {}
  await Promise.all(Object.entries(photos).map(async ([k, arr]) => {
    out[k] = Array.isArray(arr) ? await Promise.all(arr.map((u) => signChecklistPhotoUrl(u))) : arr
  }))
  return out
}

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
  const row = unwrap(await supabase.from('checklist_submissions').select(SUBMISSION_COLS).eq('id', id).maybeSingle())
  // Attach the template's field definitions so the detail page / PDF can render
  // human labels, section grouping, and conditional visibility instead of raw
  // answer keys. Best-effort: a submission still renders if the template is gone.
  if (row && row.template_id) {
    try {
      const tpl = unwrap(await supabase.from('checklist_templates').select('fields').eq('id', row.template_id).maybeSingle())
      if (tpl && Array.isArray(tpl.fields)) row.template_fields = tpl.fields
    } catch { /* template lookup is non-fatal */ }
  }
  // Sign photo URLs so the private bucket renders in the page + PDF.
  if (row && row.photos && typeof row.photos === 'object') {
    try { row.photos = await signPhotosMap(row.photos) } catch { /* leave as-is */ }
  }
  return row
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
