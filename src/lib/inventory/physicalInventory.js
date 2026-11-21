/**
 * Physical inventory registration and identification - pure rules (no I/O).
 *
 * Mirrors the migration supabase/migrations/
 * 20261122100000_inv_physical_inventory_master.sql. The database is the
 * boundary; these helpers only decide what the screen offers and how it reads.
 *
 * Vocabulary:
 *   canonical  = company-wide material (replacement group / company SKU), no stock
 *   variant    = a physical make of it (manufacturer + part number), classified
 *                genuine / oes / aftermarket / unknown
 *   ERP SKU    = the country material_master row; stock and cost live there
 *   capture    = evidence of what was found on a shelf; never posts stock
 */

export const CONDITIONS = ['new', 'used', 'refurbished', 'repairable', 'damaged', 'scrap', 'unknown']
export const OWNERSHIPS = ['owned', 'consignment', 'supplier', 'customer', 'unknown']
export const CLASSIFICATIONS = ['genuine', 'oes', 'aftermarket', 'unknown']
export const CODE_TYPES = ['barcode', 'company_sku', 'erp_sku', 'oem', 'aftermarket', 'manufacturer', 'description', 'label']
export const CAPTURE_KINDS = ['identified', 'proposed_new', 'unidentified']
export const PHOTO_ROLES = ['item', 'label', 'location', 'packaging', 'damage', 'other']
export const PHOTO_PURPOSES = ['identification', 'count_proof']
export const REFERENCE_TYPES = ['oem', 'aftermarket', 'company_sku', 'barcode', 'alternative', 'superseded', 'erp_legacy']
export const CORRECTION_ACTIONS = ['field_update', 'add_reference', 'retire_reference', 'duplicate']

/** Fields a correction may change, per target (server list in inv_correction_request). */
export const CORRECTABLE_FIELDS = Object.freeze({
  canonical: ['company_sku', 'description', 'category', 'base_uom', 'manufacturer', 'brand'],
  variant: ['manufacturer', 'brand', 'part_number', 'part_classification', 'country_of_manufacture'],
})

/** Topic for a field (dashboard / filters). */
export function topicForField(field) {
  return ({ company_sku: 'company_sku', base_uom: 'uom', part_classification: 'classification' })[field] || field
}

/** Same rule as SQL material_ref_norm(): upper case, letters and digits only. */
export function normRef(value) {
  const s = String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return s || null
}

/** A label printed by Tyre Pulse for a location (TP:LOC:<uuid>). */
export function parseLocationLabel(code) {
  const s = String(code || '').trim()
  const m = /^TP:LOC:([0-9a-f-]{36})$/i.exec(s)
  return m ? m[1].toLowerCase() : null
}

/**
 * Best guess of what a scanned / typed code is, used only to pre-select the
 * "code type" chip. The person can always change it; nothing is decided here.
 */
export function guessCodeType(code) {
  const s = String(code || '').trim()
  if (!s) return null
  if (parseLocationLabel(s)) return 'label'
  if (/^\d{8,14}$/.test(s)) return 'barcode'
  if (/^GC[-_ ]/i.test(s)) return 'company_sku'
  if (/\s{1}[a-z]/i.test(s) && s.split(/\s+/).length >= 3) return 'description'
  return 'oem'
}

/** Split search results' variants into genuine / OES / aftermarket / unknown groups. */
export function groupVariants(result) {
  const groups = { genuine: [], oes: [], aftermarket: [], unknown: [] }
  for (const v of result?.variants || []) {
    const k = CLASSIFICATIONS.includes(v.classification) ? v.classification : 'unknown'
    groups[k].push(v)
  }
  return groups
}

/** Sum availability rows (per site) into one line. Null stays null, never 0. */
export function sumAvailability(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const keys = ['available', 'reserved', 'in_transit', 'damaged', 'quarantined']
  const out = Object.fromEntries(keys.map((k) => [k, 0]))
  for (const r of rows) for (const k of keys) out[k] += Number(r?.[k]) || 0
  return out
}

/** Sites other than `site` that hold available stock of this result (transfer suggestion). */
export function transferSources(result, site) {
  const here = String(site || '').toUpperCase()
  const bySite = new Map()
  const rows = [...(result?.availability_unassigned || []), ...(result?.variants || []).flatMap((v) => v.availability || [])]
  for (const r of rows) {
    if (!r?.site || String(r.site).toUpperCase() === here) continue
    bySite.set(r.site, (bySite.get(r.site) || 0) + (Number(r.available) || 0))
  }
  return [...bySite.entries()].filter(([, n]) => n > 0).map(([s, n]) => ({ site: s, available: n }))
    .sort((a, b) => b.available - a.available)
}

/** The quick-capture form -> inv_pi_capture payload. Returns { payload } or { error }. */
export function buildCapturePayload(form, opts = {}) {
  const { sessionId, clientUuid, deviceId = 'web' } = opts
  const qty = Number(String(form?.quantity ?? '').replace(',', '.'))
  if (!sessionId) return { error: 'session' }
  if (form?.quantity === '' || form?.quantity == null || !Number.isFinite(qty) || qty < 0) return { error: 'quantity' }
  const refs = {}
  for (const k of ['company_sku', 'erp_sku', 'oem', 'aftermarket', 'manufacturer', 'brand', 'description']) {
    const v = String(form?.refs?.[k] ?? '').trim()
    if (v) refs[k] = v
  }
  const picked = form?.picked || null
  const kind = picked ? 'identified' : (refs.description || refs.oem || refs.aftermarket || refs.company_sku ? 'proposed_new' : 'unidentified')
  return {
    payload: {
      session_id: sessionId,
      client_uuid: clientUuid,
      kind,
      canonical_id: picked?.canonical_id || null,
      variant_id: picked?.variant_id || null,
      item_id: picked?.item_id || null,
      location_id: form?.location_id || null,
      location_hint: String(form?.location_hint || '').trim() || null,
      scanned_code: String(form?.scanned_code || '').trim() || null,
      scanned_code_type: form?.scanned_code ? (form?.scanned_code_type || guessCodeType(form.scanned_code)) : null,
      refs,
      quantity: qty,
      uom: String(form?.uom || '').trim() || null,
      condition: CONDITIONS.includes(form?.condition) ? form.condition : 'unknown',
      ownership: OWNERSHIPS.includes(form?.ownership) ? form.ownership : 'owned',
      remarks: String(form?.remarks || '').trim() || null,
      device_id: deviceId,
      captured_at: opts.capturedAt || new Date().toISOString(),
    },
  }
}

/**
 * The payload for the next save attempt. Once a payload was sent for a
 * client_uuid it is FROZEN: a retry after a timeout or error sends exactly the
 * same body (same captured_at), so the server treats it as a replay and never
 * as a different request. A new payload is built only when nothing is frozen.
 * Returns { frozen, payload } or { error }.
 */
export function captureAttempt(frozen, form, opts = {}) {
  if (frozen?.payload) return { frozen, payload: frozen.payload }
  const built = buildCapturePayload(form, opts)
  if (built.error) return built
  return { frozen: { payload: built.payload }, payload: built.payload }
}

/** Old vs new rows for the side-by-side correction view. */
export function correctionDiff(oldValue, newValue) {
  const o = oldValue || {}
  const n = newValue || {}
  return Object.keys(n).map((field) => ({
    field,
    before: o[field] ?? null,
    after: n[field] ?? null,
    changed: JSON.stringify(o[field] ?? null) !== JSON.stringify(n[field] ?? null),
  }))
}

/** Tone of an identification status pill. */
export function identificationTone(status) {
  return ({ identified: 'good', mapped: 'good', pending_review: 'warn', rejected: 'muted' })[status] || 'muted'
}

/** Classification tone: genuine and OES are never shown green unless verified evidence exists server-side. */
export function classificationTone(cls) {
  return ({ genuine: 'info', oes: 'info', aftermarket: 'warn', unknown: 'muted' })[cls] || 'muted'
}

/** The management dashboard payload -> ordered tiles. Missing figures stay null. */
export function dashboardTiles(d) {
  if (!d) return []
  const n = (v) => (v === null || v === undefined ? null : Number(v))
  return [
    { key: 'captures', value: n(d.captures) },
    { key: 'identified', value: n(d.identified) },
    { key: 'pending_review', value: n(d.pending_review), tone: n(d.pending_review) > 0 ? 'warn' : null },
    { key: 'missing_company_sku', value: n(d.missing_company_sku) },
    { key: 'missing_erp_sku', value: n(d.missing_erp_sku) },
    { key: 'ambiguous_erp_sku', value: n(d.ambiguous_erp_sku), tone: n(d.ambiguous_erp_sku) > 0 ? 'warn' : null },
    { key: 'ownership_needs_decision', value: n(d.ownership_needs_decision), tone: n(d.ownership_needs_decision) > 0 ? 'warn' : null },
    { key: 'missing_oem', value: n(d.missing_oem) },
    { key: 'missing_aftermarket', value: n(d.missing_aftermarket) },
    { key: 'duplicate_candidates', value: n(d.duplicate_candidates), tone: n(d.duplicate_candidates) > 0 ? 'warn' : null },
    { key: 'pending_corrections', value: n(d.pending_corrections) },
    { key: 'pending_materials', value: n(d.pending_materials) },
  ]
}

/** Identification progress 0..100, or null when nothing was captured. */
export function identificationProgress(d) {
  const total = Number(d?.captures) || 0
  if (!total) return null
  return Math.round(((Number(d.identified) || 0) / total) * 100)
}

/** Flat rows for the Excel / PDF export of the dashboard. */
export function dashboardExportRows(d, labelOf = (k) => k) {
  if (!d) return []
  const rows = dashboardTiles(d).map((x) => ({ section: 'summary', name: labelOf(x.key), value: x.value }))
  for (const [k, v] of Object.entries(d.classification || {})) rows.push({ section: 'classification', name: k, value: v })
  for (const [k, v] of Object.entries(d.condition || {})) rows.push({ section: 'condition', name: k, value: v })
  for (const [k, v] of Object.entries(d.valuation || {})) rows.push({ section: 'valuation', name: k, value: v })
  for (const [k, v] of Object.entries(d.approval || {})) rows.push({ section: 'approval', name: k, value: v })
  for (const e of d.by_employee || []) rows.push({ section: 'employee', name: e.full_name || e.user_id, value: e.captures, extra: e.identified })
  for (const l of d.by_location || []) rows.push({ section: 'location', name: `${l.site} / ${l.location}`, value: l.captures, extra: l.pending })
  return rows
}

/** Storage path for a physical-inventory photo: always under the company folder. */
export function photoPath(orgId, sessionId, clientUuid, ext = 'jpg', variant = '') {
  if (!orgId || !clientUuid) return null
  const safeExt = /^(jpg|jpeg|png|webp)$/i.test(ext) ? ext.toLowerCase() : 'jpg'
  return `physical_inventory/${orgId}/${sessionId || 'material'}/${clientUuid}${variant ? `-${variant}` : ''}.${safeExt}`
}

/** Fresh client id for a capture or photo (idempotent retries). */
export function newClientUuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${h()}${h()}-${h()}-4${h().slice(1)}-8${h().slice(1)}-${h()}${h()}${h()}`
}

/** Site types that are physical stores (V109 vocabulary in src/lib/api/sites.js). */
export const STORE_SITE_TYPES = ['warehouse', 'depot']

/**
 * The stores offered as large one-tap buttons when a count starts. Nothing new
 * is created: these are the existing `sites` rows. A site is a store when its
 * type says so, or when it already holds stock or inventory locations
 * (`hints`, upper-cased site names). Every other active site stays reachable
 * from the full list, so nobody is ever blocked from counting somewhere.
 */
export function storeChoices(sites, hints = []) {
  const hinted = new Set([...(hints || [])].map((h) => String(h || '').trim().toUpperCase()).filter(Boolean))
  const seen = new Set()
  const primary = []
  const others = []
  for (const s of sites || []) {
    const name = String(s?.name || '').trim()
    const key = name.toUpperCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    const isStore = STORE_SITE_TYPES.includes(String(s?.site_type || '').toLowerCase()) || hinted.has(key)
    ;(isStore ? primary : others).push(name)
  }
  const byName = (a, b) => a.localeCompare(b)
  return { primary: primary.sort(byName), others: others.sort(byName) }
}

/** Large +/- quantity buttons: never below zero, keeps decimals, blank counts as 0. */
export function stepQuantity(value, delta) {
  const raw = String(value ?? '').trim().replace(',', '.')
  const n = raw === '' ? 0 : Number(raw)
  if (!Number.isFinite(n)) return String(value ?? '')
  const next = Math.max(0, Math.round((n + delta) * 1000) / 1000)
  return String(next)
}

/** A scanned TP:LOC: label -> the matching location row (or null). */
export function locationFromScan(code, locations) {
  const id = parseLocationLabel(code)
  if (!id) return null
  return (locations || []).find((l) => String(l?.id || '').toLowerCase() === id) || null
}

/** Transfer request rows the current user may act on (decide = not the requester; cancel = the requester). */
export function transferActions(row, userId) {
  if (!row || row.status !== 'requested') return { decide: false, cancel: false }
  const own = !!userId && row.requested_by === userId
  return { decide: !own, cancel: own }
}
