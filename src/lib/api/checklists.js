/**
 * Checklist service — custom checklist TEMPLATES and their SUBMISSIONS
 * (V123). Templates are org/country-scoped, versioned, and hold their fields as
 * embedded JSONB. Submissions capture answers + photos + signature and can route
 * through the Universal Approval Engine (entity_type 'checklist_submission').
 * Explicit column lists, null-safe country scoping — mirrors stock.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

// name_i18n / description_i18n / option_sets carry the template's translations:
// the checklist is read on the floor by mechanics who read Arabic, Hindi or
// Urdu, and option_sets holds the shared answer legend a whole sheet points at.
const TEMPLATE_COLS =
  'id,organisation_id,country,name,description,category,icon,status,version,require_signature,require_approval,scored,pass_threshold,fields,created_by,created_at,updated_at,'
  + 'name_i18n,description_i18n,option_sets,'
  // Who the checklist is FOR (V591, text[] of profiles.role Title Case values).
  // NULL or empty = every role, which is what all pre-V591 templates carry, so a
  // reader that omitted this column would render every checklist as untargeted.
  // This is TARGETING, not a security boundary - see src/lib/checklist/checklistRoles.js.
  + 'assignee_roles,'
  // V594. require_area_manager says a supervisor sign-off is NOT the end;
  // doc_prefix mints the sheet's document number at insert; min_interval_days is
  // the advisory recurrence rule. Omitting them made every template read as
  // single-stage and un-numbered, which is the opposite of what two of them are.
  + 'require_area_manager,doc_prefix,min_interval_days'
// Approval columns (V212) are part of the row a reader needs: a checklist that
// was rejected, or is still waiting for a signature, reads very differently from
// one that was accepted, and leaving them out made every submission look final.
const SUBMISSION_COLS =
  'id,template_id,template_name,template_version,country,site,asset_no,title,status,answers,photos,signature_data,printed_name,score_pct,score_passed,submitted_by,submitted_at,created_at,updated_at,'
  + 'approval_status,approver_name,approved_at,review_note,locked,'
  // `signatures` holds EVERY captured signature keyed by field id (a workshop
  // sheet is signed by three trades); `signature_data` stays the primary
  // sign-off so everything already reading it is unchanged. `notes` is the
  // per-line remark. Both sit beside `answers` rather than inside it, because
  // `answers` is rendered as a table in the viewer, the PDF and Excel, where a
  // base64 image prints as a wall of characters.
  + 'signatures,notes,'
  // The FINAL approver's drawn signature. It has existed since V212 and was
  // never selected, so every approval rendered as unsigned - a sign-off that
  // looks like it was never given.
  + 'approver_signature,'
  // V594 two-stage sign-off. `document_no` is the sheet's reference, minted
  // server-side at insert; the supervisor_* group is the FIRST rung, and
  // approver_* is now the FINAL one (the area manager on a two-stage sheet).
  + 'document_no,supervisor_name,supervisor_signature,supervisor_by,supervisor_at'

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

/**
 * Normalise a role-target selection for storage.
 *
 * Trims, drops blanks, de-duplicates case-insensitively (a list holding both
 * 'Mechanic' and 'mechanic' targets one role twice and reads as two), and
 * returns NULL - never [] - when nothing survives. NULL and [] behave the same
 * to every reader, but only NULL says the template was never narrowed, and that
 * is the state all six pre-V591 templates are in.
 */
export function normaliseAssigneeRoles(value) {
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const out = []
  for (const raw of value) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.length ? out : null
}

/**
 * A document-number prefix as it is stored: upper case, no spaces or punctuation
 * beyond a hyphen, blank -> NULL. NULL is meaningful - it says this template does
 * not carry a document number at all, which is the state four of the six live
 * templates are in.
 */
export function normaliseDocPrefix(value) {
  const s = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return s ? s.slice(0, 12) : null
}

/**
 * The recurrence rule in whole days, or NULL when there is none.
 *
 * Zero and a negative are NULL rather than 0, because `min_interval_days = 0`
 * would read as a rule that is always satisfied while meaning "no rule was set" -
 * two different statements that must not share a stored value.
 */
export function normaliseMinIntervalDays(value) {
  if (value == null || value === '') return null
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3650) : null
}

/** Create a template. `fields` is the embedded field array. Returns the new row. */
export async function createTemplate(values) {
  const payload = {
    name: values.name,
    description: values.description ?? null,
    category: values.category ?? null,
    icon: values.icon ?? null,
    country: values.country ?? null,
    // An empty selection is written as NULL, never [], so the column keeps saying
    // honestly "this was never narrowed" rather than "narrowed to nobody".
    assignee_roles: normaliseAssigneeRoles(values.assignee_roles),
    status: values.status ?? 'draft',
    require_signature: !!values.require_signature,
    require_approval: !!values.require_approval,
    scored: !!values.scored,
    pass_threshold: values.pass_threshold ?? null,
    // Two-stage sign-off, the document-number prefix and the recurrence rule.
    // Each default matches the column default exactly, so a caller that says
    // nothing about them creates the same template it did before V594.
    require_area_manager: !!values.require_area_manager,
    doc_prefix: normaliseDocPrefix(values.doc_prefix),
    min_interval_days: normaliseMinIntervalDays(values.min_interval_days),
    fields: Array.isArray(values.fields) ? values.fields : [],
    name_i18n: values.name_i18n ?? {},
    description_i18n: values.description_i18n ?? {},
    option_sets: values.option_sets ?? {},
  }
  return unwrap(await supabase.from('checklist_templates').insert(payload).select(TEMPLATE_COLS).single())
}

/** Patch a template. Bumps version when the field set changes. Returns the row. */
export async function updateTemplate(id, patch) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id
  // Only normalise when the caller actually sent the key: a patch that does not
  // mention targeting (publish, archive) must leave the stored value alone.
  if ('assignee_roles' in clean) clean.assignee_roles = normaliseAssigneeRoles(clean.assignee_roles)
  // Same rule for the V594 settings: normalise ONLY what the caller sent, so
  // publishTemplate / archiveTemplate cannot blank a prefix or a recurrence rule
  // on their way past.
  if ('require_area_manager' in clean) clean.require_area_manager = !!clean.require_area_manager
  if ('doc_prefix' in clean) clean.doc_prefix = normaliseDocPrefix(clean.doc_prefix)
  if ('min_interval_days' in clean) clean.min_interval_days = normaliseMinIntervalDays(clean.min_interval_days)
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
    // A copy that quietly loses its role targeting is not a copy of the
    // checklist anyone approved - same reasoning as the translations below.
    assignee_roles: src.assignee_roles ?? null,
    status: 'draft',
    require_signature: src.require_signature,
    require_approval: src.require_approval,
    scored: src.scored,
    pass_threshold: src.pass_threshold,
    require_area_manager: !!src.require_area_manager,
    min_interval_days: src.min_interval_days ?? null,
    // The PREFIX is deliberately NOT copied. Document numbers are counted per
    // (prefix, asset, year), so a copy sharing its parent's prefix would file
    // two different forms into one reference series and nobody reading
    // WDC-TM514-2026-0007 could tell which sheet it is. The copy is a draft; its
    // owner gives it a prefix of its own.
    doc_prefix: null,
    fields: src.fields || [],
    // Carry the translations across: a copy that silently loses its Arabic,
    // Hindi and Urdu is not a copy of the checklist anyone approved.
    name_i18n: src.name_i18n || {},
    description_i18n: src.description_i18n || {},
    option_sets: src.option_sets || {},
  })
}

export async function deleteTemplate(id) {
  return unwrap(await supabase.from('checklist_templates').delete().eq('id', id))
}

// ── Submissions ─────────────────────────────────────────────────────────────

/** List submissions (newest first), optionally by template/country. */
/**
 * Submissions for a template.
 *
 * `assetNo`, `from` and `to` bound the read SERVER-side, and on the monthly
 * grid that is not an optimisation - it is the difference between a true report
 * and a false one. Filtering a capped list in the browser means the rows past
 * the cap never arrive, and a day whose submission did not arrive is drawn as a
 * day nobody checked: the report inventing the very gap it exists to find. A
 * month is at most 31 days of submissions, so bounded it cannot reach the cap.
 */
export async function listSubmissions({ country, templateId, assetNo, from, to, limit = 200 } = {}) {
  let q = supabase.from('checklist_submissions').select(SUBMISSION_COLS)
  if (templateId) q = q.eq('template_id', templateId)
  if (assetNo) q = q.eq('asset_no', assetNo)
  // created_at is a timestamp, so an inclusive end date has to reach the end of
  // that day - `lte` on the bare date would silently drop everything submitted
  // after midnight on the last day of the month.
  if (from) q = q.gte('created_at', `${String(from).slice(0, 10)}T00:00:00.000Z`)
  if (to) q = q.lte('created_at', `${String(to).slice(0, 10)}T23:59:59.999Z`)
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
      const tpl = unwrap(await supabase.from('checklist_templates')
        .select('fields,option_sets,name_i18n,description_i18n,require_area_manager,doc_prefix,min_interval_days')
        .eq('id', row.template_id).maybeSingle())
      if (tpl && Array.isArray(tpl.fields)) row.template_fields = tpl.fields
      // The approval RULES travel with the submission too. Without them a reader
      // cannot tell a two-stage sheet from a one-stage one, so a supervisor
      // signature and a final approval would render as the same event - exactly
      // the confusion V594 exists to remove.
      if (tpl) row.template_settings = {
        require_area_manager: !!tpl.require_area_manager,
        doc_prefix: tpl.doc_prefix ?? null,
        min_interval_days: tpl.min_interval_days ?? null,
      }
      // The shared option sets + template translations travel with the fields so
      // a reader can render the stored (English) answers in the reader's own
      // language without a second fetch.
      if (tpl) row.template_i18n = {
        option_sets: tpl.option_sets || {},
        name_i18n: tpl.name_i18n || {},
        description_i18n: tpl.description_i18n || {},
      }
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
    // Every captured signature, keyed by field id, exactly as `photos` is.
    signatures: values.signatures ?? {},
    // One remark per line, keyed by field id: the paper Remarks column.
    notes: values.notes ?? {},
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
