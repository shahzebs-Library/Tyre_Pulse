/**
 * Physical inventory registration + company-wide material identification
 * (service layer). Server objects: supabase/migrations/
 * 20261122100000_inv_physical_inventory_master.sql (applied 2026-11-21; was DRAFT until the owner
 * applies it). Until then every read returns `{ status: 'not_provisioned' }`
 * and every write throws INV_NOT_PROVISIONED, so the screen says "Not set up"
 * instead of showing an empty list as if nothing was ever counted.
 *
 * Photos: private bucket `tyre-photos`, path physical_inventory/<org>/...
 * (the bucket's live policies already scope reads to the uploader's company).
 * Each image is resized in the browser, hashed (SHA-256) and attached once:
 * the same bytes on the same record are stored once.
 */
import { supabase, ServiceError, toServiceError, isNotProvisioned, isMissingColumn, fetchAllPages } from './_client'
import { sanitizeSearchTerm, escapeLike } from '../searchFilter'
import { NOT_SET_UP_CODE, NOT_SET_UP_MESSAGE, inventoryRefusalText, newIdempotencyKey, listLocations, loadBalanceSnapshot } from './inventory'
import { resolveStorageUrlMap } from '../storageRefs'
import { photoPath, newClientUuid } from '../inventory/physicalInventory'
import { currentOrgId, isOrgId } from './companyScope'
import { STATED_CLASSES, PENDING_BATCH_STATUSES, quoteFilterValue, skuKey } from '../inventory/materialCatalogView'

export const PHOTO_BUCKET = 'tyre-photos'
const MAX_PHOTO_BYTES = 20 * 1024 * 1024
const notProvisioned = (err) => isNotProvisioned(err) || isMissingColumn(err)
const clamp = (n, lo, hi, d) => Math.min(hi, Math.max(lo, Math.floor(Number(n) || d)))

async function rpc(fn, payload, key) {
  const body = key === false ? payload : { ...payload, idempotency_key: key || newIdempotencyKey() }
  const { data, error } = await supabase.rpc(fn, { p_payload: body })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP_MESSAGE, NOT_SET_UP_CODE, error)
    const refusal = inventoryRefusalText(error)
    if (refusal) throw new ServiceError(refusal, 'INV_REFUSED', error)
    throw toServiceError(error)
  }
  return data
}

async function paged(table, cols, { page = 0, pageSize = 25, order = 'created_at', ascending = false, build } = {}) {
  const size = clamp(pageSize, 1, 200, 25)
  const from = clamp(page, 0, 1e6, 0) * size
  try {
    let q = supabase.from(table).select(cols, { count: 'exact' })
    if (build) q = build(q)
    q = q.order(order, { ascending }).order('id', { ascending: true }).range(from, from + size - 1)
    const { data, error, count } = await q
    if (error) {
      if (notProvisioned(error)) return { status: 'not_provisioned', rows: [], total: 0 }
      throw toServiceError(error)
    }
    return { status: 'ok', rows: data || [], total: count ?? (data || []).length }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], total: 0 }
    throw toServiceError(err)
  }
}

const like = (s) => `%${escapeLike(s)}%`

// ── Sessions ────────────────────────────────────────────────────────────────
export const SESSION_COLS = 'id, reference, country, site, location_id, status, notes, started_by, started_at, closed_at, opening_batch_id'

export function listSessions({ page, pageSize, country, site, status } = {}) {
  return paged('physical_inventory_sessions', SESSION_COLS, {
    page, pageSize, order: 'started_at',
    build: (q) => {
      if (country) q = q.eq('country', country)
      if (site && site !== 'all') q = q.eq('site', String(site).toUpperCase())
      if (status && status !== 'all') q = q.eq('status', status)
      return q
    },
  })
}

export const startSession = ({ country, site, locationId, auditId, notes }, key) =>
  rpc('inv_pi_session_start', { country, site, location_id: locationId || null, audit_id: auditId || null, notes: notes || null }, key)
export const closeSession = ({ sessionId, cancel = false, reason }, key) =>
  rpc('inv_pi_session_close', { session_id: sessionId, cancel, reason: reason || null }, key)
export const prepareOpeningBatch = (sessionId, key) => rpc('inv_pi_to_opening_batch', { session_id: sessionId }, key)

// ── Captures ────────────────────────────────────────────────────────────────
export const CAPTURE_COLS = 'id, session_id, session_reference, country, site, location_id, location_code, location_hint, capture_kind, temp_ref, ' +
  'canonical_id, company_sku, canonical_description, variant_id, part_number, variant_manufacturer, part_classification, item_id, erp_sku, ' +
  'scanned_code, scanned_code_type, entered_refs, quantity, uom, condition, ownership, remarks, duplicate_candidates, identification_status, ' +
  'issuable_identity, mapped_at, mapping_note, captured_by, captured_by_name, captured_at, opening_line_id, photo_count'

/** A capture is idempotent on client_uuid; the same id is the request key so a retry replays. */
export const recordCapture = (payload) => rpc('inv_pi_capture', payload, payload.client_uuid)

export function listCaptures({ page, pageSize, sessionId, status, site, country, search, mine, userId } = {}) {
  const s = sanitizeSearchTerm(search)
  return paged('v_inv_pi_captures', CAPTURE_COLS, {
    page, pageSize, order: 'captured_at',
    build: (q) => {
      if (sessionId) q = q.eq('session_id', sessionId)
      if (status && status !== 'all') q = q.eq('identification_status', status)
      if (site && site !== 'all') q = q.eq('site', String(site).toUpperCase())
      if (country) q = q.eq('country', country)
      if (mine && userId) q = q.eq('captured_by', userId)
      if (s) q = q.or(['temp_ref', 'scanned_code', 'company_sku', 'canonical_description', 'part_number', 'erp_sku', 'location_hint'].map((c) => `${c}.ilike.${like(s)}`).join(','))
      return q
    },
  })
}

export const mapCapture = ({ captureId, decision, canonicalId, variantId, itemId, canonical, variant, notDuplicateReason, note }, key) =>
  rpc('inv_pi_capture_map', {
    capture_id: captureId, decision, canonical_id: canonicalId || null, variant_id: variantId || null, item_id: itemId || null,
    ...(canonical ? { canonical } : {}), ...(variant ? { variant } : {}),
    not_duplicate_reason: notDuplicateReason || null, note: note || null,
  }, key)

// ── Company materials, variants, ERP SKU links ──────────────────────────────
export const CANONICAL_COLS = 'id, company_sku, description, category, base_uom, manufacturer, brand, status, superseded_by, ' +
  'duplicate_candidates, proposed_by, proposed_at, proposed_from_site, approved_by, approved_at, decision_note, updated_at'

export function listMaterials({ page, pageSize, status = 'proposed', search } = {}) {
  const s = sanitizeSearchTerm(search)
  return paged('material_canonical', CANONICAL_COLS, {
    page, pageSize, order: 'proposed_at',
    build: (q) => {
      if (status && status !== 'all') q = q.eq('status', status)
      if (s) q = q.or(`description.ilike.${like(s)},company_sku.ilike.${like(s)}`)
      return q
    },
  })
}

export const VARIANT_COLS = 'id, canonical_id, manufacturer, brand, part_number, part_classification, country_of_manufacture, ' +
  'classification_evidence, status, proposed_by, proposed_at, approved_by, approved_at, decision_note'

export function listVariants({ page, pageSize, status = 'proposed', canonicalId } = {}) {
  return paged('material_variants', VARIANT_COLS, {
    page, pageSize, order: 'proposed_at',
    build: (q) => {
      if (status && status !== 'all') q = q.eq('status', status)
      if (canonicalId) q = q.eq('canonical_id', canonicalId)
      return q
    },
  })
}

export const proposeMaterial = (draft, key) => rpc('inv_material_canonical_propose', draft, key)
export const decideMaterial = ({ canonicalId, decision, note, notDuplicateReason }, key) =>
  rpc('inv_material_canonical_decide', { canonical_id: canonicalId, decision, note: note || null, not_duplicate_reason: notDuplicateReason || null }, key)
/** Decides up to 500 proposed materials in one call; every item still passes the single-item rules. */
export const decideMaterialsBulk = ({ decision, search, limit, note, notDuplicateReason }, key) =>
  rpc('inv_material_canonical_decide_bulk', {
    decision, search: search || null, limit: limit || 500,
    note: note || null, not_duplicate_reason: notDuplicateReason || null,
  }, key)
export const proposeVariant = (draft, key) => rpc('inv_material_variant_propose', draft, key)
export const decideVariant = ({ variantId, decision, note }, key) =>
  rpc('inv_material_variant_decide', { variant_id: variantId, decision, note: note || null }, key)
export const linkErpItem = ({ itemId, canonicalId, variantId, note }, key) =>
  rpc('inv_material_link_item', { item_id: itemId, canonical_id: canonicalId || null, variant_id: variantId || null, note: note || null }, key)

// ── Search, transfer requests ───────────────────────────────────────────────
/** Company-wide search; RLS decides which ERP SKUs and stores the caller sees. */
export async function searchMaterials(query, { limit = 25 } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return { status: 'ok', query: q, results: [] }
  try {
    const data = await rpc('inv_material_search', { query: q, limit }, false)
    return { status: 'ok', query: q, results: data?.results || [] }
  } catch (err) {
    if (err?.code === NOT_SET_UP_CODE) return { status: 'not_provisioned', query: q, results: [] }
    throw err
  }
}

export const requestTransfer = ({ itemId, site, fromSite, qty, reason }, key) =>
  rpc('inv_transfer_request', { item_id: itemId, site, from_site: fromSite, qty, reason }, key)
export const decideTransferRequest = ({ requestId, decision, note }, key) =>
  rpc('inv_transfer_request_decide', { request_id: requestId, decision, note: note || null }, key)

export const TRANSFER_REQUEST_COLS = 'id, country, site, from_site, item_id, qty, reason, status, requested_by, requested_at, decided_at, decision_note, ' +
  'item:material_master(item_code, item_name)'

export async function listTransferRequests({ page, pageSize, status = 'requested', country } = {}) {
  const build = (q) => {
    let x = status && status !== 'all' ? q.eq('status', status) : q
    if (country) x = x.eq('country', country)
    return x
  }
  const opts = { page, pageSize, order: 'requested_at', build }
  try {
    return await paged('inventory_transfer_requests', TRANSFER_REQUEST_COLS, opts)
  } catch (err) {
    // The item embed needs the FK relationship; fall back to the plain columns rather than failing the list.
    if (err?.cause?.code === 'PGRST200' || err?.code === 'PGRST200') {
      return paged('inventory_transfer_requests', TRANSFER_REQUEST_COLS.replace(/, item:material_master\(item_code, item_name\)$/, ''), opts)
    }
    throw err
  }
}

/**
 * Names of the sites that already hold stock or inventory locations in a
 * country: these are the physical stores offered first when a count starts.
 * Best effort: a failed read returns [] and the full site list still works.
 */
export async function listStoreSiteHints(country) {
  if (!country) return []
  const read = async (table) => {
    try {
      const { data, error } = await supabase.from(table).select('site').eq('country', country).not('site', 'is', null).limit(1000)
      return error ? [] : (data || []).map((r) => r.site)
    } catch { return [] }
  }
  const [stock, locs] = await Promise.all([read('stock_records'), read('inventory_locations')])
  return [...new Set([...stock, ...locs].map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))]
}

// ── Corrections ─────────────────────────────────────────────────────────────
export const CORRECTION_COLS = 'id, target_kind, target_id, action, topic, old_value, new_value, evidence, photo_ids, reason, status, ' +
  'requested_by, requested_at, decided_by, decided_at, decision_note'

export function listCorrections({ page, pageSize, status = 'submitted', topic, targetIds } = {}) {
  return paged('material_correction_requests', CORRECTION_COLS, {
    page, pageSize, order: 'requested_at',
    build: (q) => {
      if (status && status !== 'all') q = q.eq('status', status)
      if (topic && topic !== 'all') q = q.eq('topic', topic)
      // One material's corrections: its canonical id and any of its variant ids.
      if (Array.isArray(targetIds) && targetIds.length) q = q.in('target_id', targetIds.filter(Boolean).slice(0, 100))
      return q
    },
  })
}

export async function listCorrectionHistory(requestId) {
  const { data, error } = await supabase.from('material_correction_events').select('id, event, actor_id, at, detail')
    .eq('request_id', requestId).order('id', { ascending: true }).limit(100)
  if (error) {
    if (notProvisioned(error)) return []
    throw toServiceError(error)
  }
  return data || []
}

export const requestCorrection = (draft, key) => rpc('inv_correction_request', draft, key)
export const decideCorrection = ({ requestId, decision, note }, key) =>
  rpc('inv_correction_decide', { request_id: requestId, decision, note: note || null }, key)

// ── Dashboard ───────────────────────────────────────────────────────────────
export async function loadDashboard({ country, site, sessionId } = {}) {
  try {
    const data = await rpc('inv_pi_dashboard', { country: country || null, site: site && site !== 'all' ? site : null, session_id: sessionId || null }, false)
    return { status: 'ok', ...data }
  } catch (err) {
    if (err?.code === NOT_SET_UP_CODE) return { status: 'not_provisioned' }
    throw err
  }
}

// ── Photos ──────────────────────────────────────────────────────────────────
async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Resize to `maxEdge` px JPEG. Falls back to the original file when the browser cannot decode it. */
async function resizeImage(file, maxEdge, quality) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return out || file
  } catch {
    return file
  }
}

export function validatePhoto(file) {
  if (!file || typeof file !== 'object') throw new ServiceError('No image file was provided.', 'INV_PHOTO')
  if (!/^image\/(jpeg|png|webp|heic)$/i.test(file.type || '')) throw new ServiceError('Use a JPEG, PNG, WebP or HEIC photo.', 'INV_PHOTO')
  if (file.size > MAX_PHOTO_BYTES) throw new ServiceError('The photo is larger than 20 MB.', 'INV_PHOTO')
}

/**
 * Upload one photo and link it. `target` = { captureId } | { canonicalId } | { variantId }.
 * Returns { id, duplicate }. Re-running with the same `clientUuid` never stores twice.
 */
export async function uploadPhoto(file, { orgId, sessionId, target = {}, role = 'item', purpose, clientUuid = newClientUuid() } = {}) {
  validatePhoto(file)
  // The company folder comes from the database (app_current_org), the same value the
  // server checks the path against; the signed-in profile does not carry it.
  const org = isOrgId(orgId) ? orgId : await currentOrgId()
  if (!org) throw new ServiceError('Your company could not be determined. Sign in again.', 'INV_PHOTO')
  const full = await resizeImage(file, 1600, 0.72)
  const thumb = await resizeImage(file, 320, 0.6)
  const hash = await sha256Hex(full)
  const path = photoPath(org, sessionId, clientUuid, 'jpg')
  const thumbPath = photoPath(org, sessionId, clientUuid, 'jpg', 'thumb')
  for (const [p, body] of [[path, full], [thumbPath, thumb]]) {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(p, body, { contentType: 'image/jpeg', upsert: false })
    if (error && !/already exists|duplicate/i.test(error.message || '')) throw toServiceError(error, 'The photo could not be uploaded. Try again.')
  }
  return rpc('inv_pi_photo_attach', {
    client_uuid: clientUuid,
    capture_id: target.captureId || null,
    canonical_id: target.canonicalId || null,
    variant_id: target.variantId || null,
    storage_path: path,
    thumb_path: thumbPath,
    photo_role: role,
    purpose: purpose || (target.captureId ? 'count_proof' : 'identification'),
    sha256: hash,
    byte_size: full.size || null,
  }, false)
}

export async function listPhotos({ captureId, canonicalId } = {}) {
  let q = supabase.from('physical_inventory_photos').select('id, capture_id, canonical_id, variant_id, storage_path, thumb_path, photo_role, purpose, uploaded_by, uploaded_at')
  if (captureId) q = q.eq('capture_id', captureId)
  else if (canonicalId) q = q.eq('canonical_id', canonicalId)
  else return []
  const { data, error } = await q.order('uploaded_at', { ascending: true }).limit(50)
  if (error) {
    if (notProvisioned(error)) return []
    throw toServiceError(error)
  }
  const rows = data || []
  const refs = rows.flatMap((r) => [r.storage_path, r.thumb_path].filter(Boolean).map((p) => `tp-storage://${PHOTO_BUCKET}/${p}`))
  const urls = refs.length ? await resolveStorageUrlMap(refs) : {}
  return rows.map((r) => ({
    ...r,
    url: urls[`tp-storage://${PHOTO_BUCKET}/${r.storage_path}`] || null,
    thumbUrl: r.thumb_path ? urls[`tp-storage://${PHOTO_BUCKET}/${r.thumb_path}`] || null : null,
  }))
}

// ── Store 3D layout ─────────────────────────────────────────────────────────
/**
 * Everything the 3D store view needs for ONE store: its locations, the stock
 * balance lines in it and today's physical-inventory captures. Each part
 * degrades on its own (a missing view returns []), and the caller is told.
 */
export async function loadStoreLayoutData({ country, site }) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const scoped = { country: country || null, site }
  const [locs, bal, caps] = await Promise.all([
    listLocations(scoped),
    loadBalanceSnapshot(scoped),
    (async () => {
      try {
        let q = supabase.from('v_inv_pi_captures').select('id, location_id, captured_at, quantity, canonical_description, company_sku')
          .eq('site', String(site || '').toUpperCase()).gte('captured_at', start.toISOString()).order('captured_at', { ascending: false }).limit(1000)
        if (country) q = q.eq('country', country)
        const { data, error } = await q
        if (error) {
          if (notProvisioned(error)) return []
          throw toServiceError(error)
        }
        return data || []
      } catch (err) {
        if (notProvisioned(err)) return []
        throw toServiceError(err)
      }
    })(),
  ])
  return {
    status: locs.status,
    locations: locs.rows || [],
    balances: bal.rows || [],
    captures: caps,
    truncated: !!(locs.truncated || bal.truncated),
  }
}

/**
 * Live updates for the 3D view: stock balance changes (stock_records is in the
 * realtime publication) and physical-inventory captures (delivered only once
 * that table is added to the publication; the view also re-reads every minute).
 * Calls `onChange({ table, locationId })`. Returns an unsubscribe function.
 */
export function subscribeStoreChanges(site, onChange) {
  const s = String(site || '').toUpperCase()
  if (!s || typeof supabase.channel !== 'function') return () => {}
  const ch = supabase.channel(`inv-store-3d-${s}-${Math.random().toString(36).slice(2, 8)}`)
  const hand = (table) => (payload) => {
    const row = payload?.new || payload?.record || {}
    if (row.site && String(row.site).toUpperCase() !== s) return
    onChange({ table, locationId: row.location_id || null })
  }
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'stock_records' }, hand('stock_records'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'physical_inventory_captures' }, hand('physical_inventory_captures'))
    .subscribe()
  return () => { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
}

/** One company material (approval dates, decision note) for the Material Master detail. */
export async function getMaterial(id) {
  if (!id) return null
  const { data, error } = await supabase.from('material_canonical').select(CANONICAL_COLS).eq('id', id).maybeSingle()
  if (error) {
    if (notProvisioned(error)) return null
    throw toServiceError(error)
  }
  return data || null
}

// ── Material Master catalogue (brand, part type, stock) ─────────────────────
// Server-paged list of company materials plus batched lookups for the visible
// page only. Posted stock is read from v_inv_balances (security-invoker view
// over stock_records) matched on item_code = company SKU; pending opening stock
// from opening_balance_lines in draft / submitted batches, matched on the raw
// item code of the line. RLS decides what the caller sees in every read.

export const CATALOG_COLS = `${CANONICAL_COLS}, specs`
const CATALOG_SET_MAX = 20000

const readAll = async (build, max = CATALOG_SET_MAX) => {
  const { data, error, truncated } = await fetchAllPages((from, to) => build().range(from, to), { max })
  if (error) throw error
  return { rows: data || [], truncated: !!truncated }
}

const PART_TYPE_CLASSES = { genuine: ['genuine'], oes: ['oes'], aftermarket: ['aftermarket'], local: ['local'], not_stated: STATED_CLASSES }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function catalogOr({ search, brand, matchIds }) {
  const parts = []
  const s = sanitizeSearchTerm(search)
  if (s) {
    const v = quoteFilterValue(like(s))
    // matchIds: materials the reference search found by OEM / part number / alias.
    const ids = (matchIds || []).filter((id) => UUID_RE.test(String(id))).slice(0, 50)
    const byId = ids.length ? `,id.in.(${ids.join(',')})` : ''
    parts.push(`or(description.ilike.${v},company_sku.ilike.${v},brand.ilike.${v},manufacturer.ilike.${v}${byId})`)
  }
  if (brand && brand !== 'all') {
    const v = quoteFilterValue(brand)
    parts.push(`or(brand.eq.${v},manufacturer.eq.${v},specs->>brand.eq.${v})`)
  }
  if (!parts.length) return null
  return parts.length === 1 ? parts[0].slice(3, -1) : `and(${parts.join(',')})`
}

function applyCatalogBase(q, { status, category, search, brand, matchIds }) {
  if (status && status !== 'all') q = q.eq('status', status)
  if (category && category !== 'all') q = q.eq('category', category)
  const or = catalogOr({ search, brand, matchIds })
  return or ? q.or(or) : q
}

/** Canonical ids carrying a variant of the requested part type (or, for not_stated, any stated type). */
async function partTypeIdSet(partType) {
  const cls = PART_TYPE_CLASSES[partType]
  if (!cls) return null
  const { rows, truncated } = await readAll(() => supabase.from('material_variants').select('canonical_id, id')
    .in('part_classification', cls).in('status', ['proposed', 'active']).order('id', { ascending: true }))
  return { ids: new Set(rows.map((r) => r.canonical_id)), truncated }
}

/** Company SKUs with posted stock on hand, or with opening stock still waiting for approval. */
async function stockSkuSet(stock) {
  if (stock === 'posted') {
    const [bal, links] = await Promise.all([
      readAll(() => supabase.from('v_inv_balances').select('id, item_id, item_code')
        .gt('qty_on_hand', 0).order('id', { ascending: true })),
      readAll(() => supabase.from('material_canonical_items').select('id, canonical_id, item_id').order('id', { ascending: true })),
    ])
    const stocked = new Set(bal.rows.map((r) => r.item_id).filter(Boolean))
    const ids = new Set(links.rows.filter((l) => stocked.has(l.item_id)).map((l) => l.canonical_id))
    return { skus: new Set(bal.rows.map((r) => skuKey(r.item_code))), ids, truncated: bal.truncated || links.truncated }
  }
  if (stock === 'pending') {
    const { rows, truncated } = await readAll(() => supabase.from('opening_balance_lines')
      .select('id, item_code_raw, batch:opening_balance_batches!inner(status)')
      .in('batch.status', PENDING_BATCH_STATUSES).neq('mapping_status', 'excluded').order('id', { ascending: true }), 50000)
    return { skus: new Set(rows.map((r) => skuKey(r.item_code_raw))), truncated }
  }
  return null
}

/**
 * One page of company materials. `partType` (genuine | oes | aftermarket |
 * not_stated) and `stock` (posted | pending) are set filters: when either is
 * on, the matching ids are resolved first (id + SKU columns only) and only the
 * page slice is read in full. `matchIds` (from inv_material_search) widens a
 * text search to OEM / part numbers. `{ status, rows, total, truncated }`.
 */
export async function listMaterialCatalog({ page = 0, pageSize = 25, search, status = 'all', category, brand, partType = 'all', stock = 'all', matchIds } = {}) {
  const size = clamp(pageSize, 1, 100, 25)
  const from = clamp(page, 0, 1e6, 0) * size
  const base = { status, category, search, brand, matchIds }
  try {
    if ((!partType || partType === 'all') && (!stock || stock === 'all')) {
      return await paged('material_canonical', CATALOG_COLS, {
        page, pageSize: size, order: 'company_sku', ascending: true, build: (q) => applyCatalogBase(q, base),
      })
    }
    const [types, skus, candidates] = await Promise.all([
      partType && partType !== 'all' ? partTypeIdSet(partType) : null,
      stock && stock !== 'all' ? stockSkuSet(stock) : null,
      readAll(() => applyCatalogBase(supabase.from('material_canonical').select('id, company_sku'), base)
        .order('company_sku', { ascending: true }).order('id', { ascending: true })),
    ])
    const matched = candidates.rows.filter((r) => {
      if (types) {
        const has = types.ids.has(r.id)
        if (partType === 'not_stated' ? has : !has) return false
      }
      if (skus && !skus.skus.has(skuKey(r.company_sku)) && !skus.ids?.has(r.id)) return false
      return true
    })
    const truncated = candidates.truncated || !!types?.truncated || !!skus?.truncated
    const slice = matched.slice(from, from + size).map((r) => r.id)
    if (!slice.length) return { status: 'ok', rows: [], total: matched.length, truncated }
    const { data, error } = await supabase.from('material_canonical').select(CATALOG_COLS).in('id', slice)
    if (error) throw error
    const order = new Map(slice.map((id, i) => [id, i]))
    const rows = (data || []).sort((a, b) => order.get(a.id) - order.get(b.id))
    return { status: 'ok', rows, total: matched.length, truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], total: 0, truncated: false }
    throw toServiceError(err)
  }
}

const settle = async (fn) => {
  try {
    return await fn()
  } catch {
    return null
  }
}

/**
 * Batched lookups for one page of materials (at most 100). Each part is read
 * with `.in(...)` over the page's ids or SKUs only; a part that fails comes
 * back null so the screen prints N/A instead of a false zero.
 */
export async function loadMaterialCatalogDetail(materials) {
  const ids = [...new Set((materials || []).map((m) => m?.id).filter(Boolean))].slice(0, 100)
  const skus = [...new Set((materials || []).map((m) => (m?.company_sku ? String(m.company_sku).trim() : '')).filter(Boolean))].slice(0, 100)
  const none = { variants: [], aliases: [], balances: [], openingLines: [] }
  if (!ids.length) return none
  // Canonical -> country ERP item links (material_canonical_items): stock can sit
  // under an ERP code that differs from the company SKU.
  const links = await settle(async () => (await readAll(() => supabase.from('material_canonical_items')
    .select('id, canonical_id, item_id').in('canonical_id', ids).order('id', { ascending: true }), 5000)).rows)
  const linkedItemIds = [...new Set((links || []).map((l) => l.item_id).filter(Boolean))].slice(0, 300)
  const [variants, aliases, balances, openingLines] = await Promise.all([
    settle(async () => (await readAll(() => supabase.from('material_variants')
      .select('id, canonical_id, manufacturer, brand, part_number, part_classification, country_of_manufacture, classification_evidence, status')
      .in('canonical_id', ids).order('id', { ascending: true }), 5000)).rows),
    settle(async () => (await readAll(() => supabase.from('material_aliases')
      .select('id, canonical_id, alias_type, value, manufacturer, ref_status, verified')
      .in('canonical_id', ids).eq('alias_type', 'oem').order('id', { ascending: true }), 5000)).rows),
    (skus.length || linkedItemIds.length) ? settle(async () => {
      const ors = []
      if (skus.length) ors.push(`item_code.in.(${skus.map((k) => `"${k.replace(/"/g, '')}"`).join(',')})`)
      if (linkedItemIds.length) ors.push(`item_id.in.(${linkedItemIds.join(',')})`)
      const rows = (await readAll(() => supabase.from('v_inv_balances')
        .select('id, item_id, item_code, site, country, location_code, condition, qty_on_hand, qty_reserved, uom')
        .or(ors.join(',')).order('id', { ascending: true }), 5000)).rows
      const canonByItem = new Map((links || []).map((l) => [l.item_id, l.canonical_id]))
      return rows.map((r) => ({ ...r, canonical_id: canonByItem.get(r.item_id) ?? null }))
    }) : [],
    skus.length ? settle(async () => (await readAll(() => supabase.from('opening_balance_lines')
      .select('id, batch_id, item_code_raw, qty, uom, location_code_raw, batch:opening_balance_batches!inner(status, site, country, reference)')
      .in('item_code_raw', skus).in('batch.status', PENDING_BATCH_STATUSES).neq('mapping_status', 'excluded').order('id', { ascending: true }), 5000)).rows) : [],
  ])
  return { variants, aliases, balances, openingLines }
}

/** Brand, manufacturer and category columns only, for the filter dropdowns. */
export async function loadMaterialCatalogFacets() {
  try {
    const { rows, truncated } = await readAll(() => supabase.from('material_canonical')
      .select('id, category, brand, manufacturer, spec_brand:specs->>brand').order('id', { ascending: true }))
    return { status: 'ok', rows, truncated }
  } catch (err) {
    if (notProvisioned(err)) return { status: 'not_provisioned', rows: [], truncated: false }
    throw toServiceError(err)
  }
}
