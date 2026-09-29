/**
 * Tyre specification CATALOGUE service (table `tyre_spec_catalog`, migration
 * 20260929090000 PART B). One row = one brand + pattern + size product with its
 * load, speed, dimension and inflation data, its images/documents (storage refs
 * in the private `tyre-photos` bucket) and an approval status.
 *
 * This is SEPARATE from `tyre_specifications` (src/lib/api/tyreSpecs.js), which
 * stays the fitment RULES per vehicle type + position.
 *
 * Server rules (enforced by trigger + RLS, not by this module): any approved
 * user may create or edit a spec; only Admin/Manager/Director or a super admin
 * may set or change `approval_status` (others get errcode 42501); approver and
 * approval time are stamped server-side, so this module never sends them.
 *
 * Every read throws a sanitised ServiceError on failure, except a table that is
 * not provisioned, which degrades to [] (honest empty state).
 */
import { brandKey, matchSpec } from '../tyreSpecView'
import { supabase, fetchAllPages, applyCountry, toServiceError, isMissingRelation, unwrap } from './_client'

export const CATALOG_COLS =
  'id, organisation_id, country, brand, pattern, size, width_mm, aspect_ratio, rim_in, tyre_type, '
  + 'load_index_single, load_index_dual, speed_rating, ply_rating, tube_type, application, description, '
  + 'tread_depth_new_mm, tread_depth_min_mm, overall_diameter_mm, section_width_mm, recommended_rim, '
  + 'max_load_single_kg, max_load_dual_kg, inflation_single_kpa, inflation_dual_kpa, weight_kg, '
  + 'suitable_for, images, documents, approval_status, approved_by, approved_at, approval_note, '
  + 'source_url, source_note, created_by, created_at, updated_at'

export const EVENT_COLS = 'id, spec_id, action, from_status, to_status, note, actor_name, at'

export const APPROVAL_STATUSES = ['approved', 'pending', 'not_approved']
export const CATALOG_TYRE_TYPES = ['steer', 'drive', 'trailer', 'off_road', 'other']
export const TUBE_TYPES = ['tubeless', 'tube']

const TEXT_FIELDS = ['brand', 'pattern', 'size', 'speed_rating', 'ply_rating', 'application', 'description', 'recommended_rim', 'approval_note', 'country', 'source_url', 'source_note']
const NUM_FIELDS = [
  'width_mm', 'aspect_ratio', 'rim_in', 'tread_depth_new_mm', 'tread_depth_min_mm', 'overall_diameter_mm',
  'section_width_mm', 'max_load_single_kg', 'max_load_dual_kg', 'inflation_single_kpa', 'inflation_dual_kpa', 'weight_kg',
]
const INT_FIELDS = ['load_index_single', 'load_index_dual']

const numOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const textOrNull = (v) => {
  const s = String(v ?? '').trim()
  return s ? s : null
}
const fileList = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((f) => f && typeof f.path === 'string' && f.path)
  .map((f) => ({
    path: f.path, name: String(f.name || ''), type: String(f.type || ''),
    size: numOrNull(f.size), uploaded_at: f.uploaded_at || null,
  }))

/**
 * Whitelist a form into a writable row. Only keys PRESENT in the form are
 * written (so a status-only update never blanks other columns). Server-owned
 * columns (id, organisation_id, approved_by, approved_at, created_*, updated_at)
 * are never sent.
 */
export function catalogPayload(form = {}) {
  const out = {}
  const has = (k) => Object.prototype.hasOwnProperty.call(form, k)
  for (const k of TEXT_FIELDS) if (has(k)) out[k] = textOrNull(form[k])
  for (const k of NUM_FIELDS) if (has(k)) out[k] = numOrNull(form[k])
  for (const k of INT_FIELDS) if (has(k)) {
    const n = numOrNull(form[k]); out[k] = n == null ? null : Math.round(n)
  }
  if (has('tyre_type')) out.tyre_type = CATALOG_TYRE_TYPES.includes(form.tyre_type) ? form.tyre_type : null
  if (has('tube_type')) out.tube_type = TUBE_TYPES.includes(form.tube_type) ? form.tube_type : null
  if (has('approval_status') && APPROVAL_STATUSES.includes(form.approval_status)) out.approval_status = form.approval_status
  if (has('suitable_for')) {
    out.suitable_for = (Array.isArray(form.suitable_for) ? form.suitable_for : [])
      .map((x) => String(x ?? '').trim()).filter(Boolean)
  }
  if (has('images')) out.images = fileList(form.images)
  if (has('documents')) out.documents = fileList(form.documents)
  return out
}

/** List catalogue specs (NULL-inclusive country scope), paged past 1,000 rows. */
export async function listCatalog({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = applyCountry(supabase.from('tyre_spec_catalog').select(CATALOG_COLS), country)
    return q.order('brand', { ascending: true }).order('pattern', { ascending: true }).order('id', { ascending: true }).range(from, to)
  }, { max: 20000 })
  if (error) {
    if (isMissingRelation(error)) return []
    throw toServiceError(error, 'Could not load the tyre specification catalogue.')
  }
  return data || []
}

export async function getCatalogSpec(id) {
  return unwrap(await supabase.from('tyre_spec_catalog').select(CATALOG_COLS).eq('id', id).maybeSingle())
}

export async function createCatalogSpec(form) {
  const res = await supabase.from('tyre_spec_catalog').insert(catalogPayload(form)).select(CATALOG_COLS).single()
  if (res.error) throw toServiceError(res.error, 'Could not save the specification.')
  return res.data
}

export async function updateCatalogSpec(id, patch) {
  const res = await supabase.from('tyre_spec_catalog').update(catalogPayload(patch)).eq('id', id).select(CATALOG_COLS).single()
  if (res.error) throw toServiceError(res.error, 'Could not update the specification.')
  return res.data
}

/** Approve / reject / return to pending. Server stamps approver + time. */
export function setCatalogStatus(id, status, note) {
  const patch = { approval_status: status }
  if (note !== undefined) patch.approval_note = note
  return updateCatalogSpec(id, patch)
}

export async function deleteCatalogSpec(id) {
  const res = await supabase.from('tyre_spec_catalog').delete().eq('id', id)
  if (res.error) throw toServiceError(res.error, 'Could not delete the specification.')
  return true
}

/** Approval history of one spec, newest first. */
export async function listCatalogEvents(specId) {
  if (!specId) return []
  const res = await supabase.from('tyre_spec_catalog_events').select(EVENT_COLS)
    .eq('spec_id', specId).order('at', { ascending: false }).order('id', { ascending: true }).limit(500)
  if (res.error) {
    if (isMissingRelation(res.error)) return []
    throw toServiceError(res.error, 'Could not load the approval history.')
  }
  return res.data || []
}

// ── Files ────────────────────────────────────────────────────────────────────
export const FILE_BUCKET = 'tyre-photos'
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }

export function validateCatalogFile(file) {
  if (!file || typeof file !== 'object') throw new Error('No file was provided.')
  if (!MIME_EXT[file.type]) throw new Error('Only JPG, PNG or PDF files are allowed.')
  if (Number(file.size) > MAX_FILE_BYTES) throw new Error('Each file must be 10 MB or smaller.')
  return MIME_EXT[file.type]
}

export function safeFileName(name, ext) {
  const base = String(name || 'file').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${base || 'file'}.${ext}`
}

/**
 * Upload one file under <organisation_id>/spec-catalog/<spec id>/ and return
 * the entry stored in `images` / `documents`.
 */
export async function uploadCatalogFile({ orgId, specId, file }) {
  const ext = validateCatalogFile(file)
  if (!orgId || !specId) throw new Error('Save the specification before adding files.')
  const path = `${orgId}/spec-catalog/${specId}/${Date.now()}-${safeFileName(file.name, ext)}`
  const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type, cacheControl: '3600',
  })
  if (error) throw toServiceError(error, 'File upload failed.')
  return { path, name: String(file.name || ''), type: file.type, size: Number(file.size) || null, uploaded_at: new Date().toISOString() }
}

/** The tp-storage:// ref the shared signed-URL resolver understands. */
export const fileRef = (entry) => (entry?.path ? `tp-storage://${FILE_BUCKET}/${entry.path}` : null)

// ── Shared lookup (passport, records, value advisor, fleet coverage) ─────────

/**
 * The fleet brand + size mix (one row per country + brand + size with its tyre
 * count), from RPC get_tyre_brand_size_mix. RLS scopes it; a country argument
 * only narrows. Throws on failure; [] only when the RPC is not provisioned.
 */
export async function listFleetBrandSizeMix({ country } = {}) {
  const { data, error } = await supabase.rpc('get_tyre_brand_size_mix', { p_country: country || null })
  if (error) {
    if (isMissingRelation(error)) return []
    throw toServiceError(error, 'Could not load the fleet brand and size mix.')
  }
  return data || []
}

// Short-lived cache so a page that looks up many tyres reads the catalogue once.
const SPEC_CACHE_MS = 5 * 60 * 1000
let specCache = { at: 0, rows: null, pending: null }

/** Drop the cached catalogue (call after a catalogue write). */
export function invalidateSpecCache() { specCache = { at: 0, rows: null, pending: null } }

async function cachedCatalog() {
  if (specCache.rows && Date.now() - specCache.at < SPEC_CACHE_MS) return specCache.rows
  if (specCache.pending) return specCache.pending
  specCache.pending = listCatalog({})
    .then((rows) => { specCache = { at: Date.now(), rows, pending: null }; return rows })
    .catch((e) => { specCache.pending = null; throw e })
  return specCache.pending
}

/**
 * The best catalogue spec for a tyre, or null when the catalogue holds none.
 * Brand spelling is folded (DOUBLE COIN = DOUBLECOIN), size ignores spacing.
 * Preference: approved first, then the exact pattern, then the same country.
 * Any page that needs a tyre's published data (tread depth, load, speed, ply,
 * source) should call this rather than re-reading the table.
 */
export async function getSpecFor(brand, size, pattern, { country } = {}) {
  if (!brandKey(brand) || !size) return null
  const rows = await cachedCatalog()
  return matchSpec(rows, { brand, size, pattern, country })
}
