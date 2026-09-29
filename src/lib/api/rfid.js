/**
 * RFID service: RFID Registry tags (V132). Register passive/RAIN RFID tags,
 * map them to tyres (by serial) and assets, and resolve a scanned tag to its
 * mapping. RLS enforces org isolation; this layer keeps an explicit column
 * list, null-safe country scoping and canonical tag-id normalisation, mirroring
 * support.js / tyreAgeCompliance.js. Tag-id normalisation lives in the pure
 * `src/lib/rfid.js` so the service and UI agree on identity.
 */
import { supabase, unwrap, applyCountry, isMissingRelation } from './_client'
import { normalizeTagId, RFID_STATUSES } from '../rfid'

export const COLS =
  'id,organisation_id,country,tag_id,tyre_serial,asset_no,site,status,' +
  'last_scanned_at,notes,created_by,created_at,updated_at'

export { RFID_STATUSES }


/**
 * List registry tags (newest first). Optional status + country filters.
 * Returns [] (rather than throwing) when the table has not been migrated yet,
 * so the page can render its "apply migration" empty state.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listTags({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('rfid_tags').select(COLS)
    if (status && RFID_STATUSES.includes(status)) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTag(id) {
  return unwrap(await supabase.from('rfid_tags').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Register a new tag. Validates and canonicalises the tag id (required); maps
 * to a tyre serial / asset when supplied. Status defaults to a sensible value
 * derived from whether a mapping was provided.
 */
export async function createTag(values = {}) {
  const tagId = normalizeTagId(values.tag_id)
  if (!tagId) throw new Error('A tag ID is required.')

  const tyreSerial = values.tyre_serial ? String(values.tyre_serial).trim() : null
  const assetNo = values.asset_no ? String(values.asset_no).trim() : null
  const hasMapping = Boolean(tyreSerial || assetNo)
  const status = RFID_STATUSES.includes(values.status)
    ? values.status
    : (hasMapping ? 'active' : 'unassigned')

  const payload = {
    tag_id: tagId.slice(0, 128),
    tyre_serial: tyreSerial ? tyreSerial.slice(0, 128) : null,
    asset_no: assetNo ? assetNo.slice(0, 128) : null,
    site: values.site ? String(values.site).slice(0, 128) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 2000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('rfid_tags').insert(payload).select(COLS).single())
}

/** Patch a tag (re-map, change status, edit notes). Immutable fields stripped. */
export async function updateTag(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.organisation_id
  delete clean.created_by
  if (clean.tag_id != null) clean.tag_id = normalizeTagId(clean.tag_id).slice(0, 128)
  if (clean.tyre_serial != null) clean.tyre_serial = clean.tyre_serial ? String(clean.tyre_serial).trim().slice(0, 128) : null
  if (clean.asset_no != null) clean.asset_no = clean.asset_no ? String(clean.asset_no).trim().slice(0, 128) : null
  if (clean.status != null && !RFID_STATUSES.includes(clean.status)) delete clean.status
  return unwrap(await supabase.from('rfid_tags').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteTag(id) {
  return unwrap(await supabase.from('rfid_tags').delete().eq('id', id))
}

/**
 * Scan lookup: resolve a scanned tag id to its registry row. Normalises the
 * input so scans match regardless of case/whitespace, and stamps
 * `last_scanned_at` (best-effort) so the registry reflects live activity.
 * Returns the matched row, or null when the tag is unknown.
 * @param {string} tagId
 * @param {{ country?:string, touch?:boolean }} [opts]
 */
export async function findByTag(tagId, { country, touch = true } = {}) {
  const normalized = normalizeTagId(tagId)
  if (!normalized) return null
  let q = supabase.from('rfid_tags').select(COLS).eq('tag_id', normalized)
  q = applyCountry(q, country)
  const row = unwrap(await q.limit(1).maybeSingle())
  if (row && touch) {
    try {
      const updated = unwrap(
        await supabase
          .from('rfid_tags')
          .update({ last_scanned_at: new Date().toISOString() })
          .eq('id', row.id)
          .select(COLS)
          .single(),
      )
      return updated || row
    } catch {
      return row
    }
  }
  return row
}

// ── Tag history (rfid_tag_events, written by a database trigger) ─────────────
export const EVENT_COLS =
  'id,country,tag_row_id,tag_id,action,from_asset_no,to_asset_no,from_tyre_serial,to_tyre_serial,' +
  'from_status,to_status,from_site,to_site,actor_name,created_at'

/**
 * Page through tag history, newest first. Throws on a failed read (the page
 * shows error + Retry); returns [] only when the table is not provisioned.
 * @param {{ country?:string, tagRowId?:string, max?:number }} [opts]
 */
export async function listTagEvents({ country, tagRowId, max = 20000 } = {}) {
  const out = []
  const size = 1000
  try {
    for (let from = 0; from < max; from += size) {
      let q = supabase.from('rfid_tag_events').select(EVENT_COLS)
      if (tagRowId) q = q.eq('tag_row_id', tagRowId)
      q = applyCountry(q, country)
      const rows = unwrap(await q.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + size - 1)) || []
      out.push(...rows)
      if (rows.length < size) return { rows: out, truncated: false }
    }
    return { rows: out, truncated: true }
  } catch (err) {
    if (isMissingRelation(err)) return { rows: [], truncated: false, missing: true }
    throw err
  }
}

/** Map a tag to an asset or a tyre serial (clears the other side). */
export async function assignTag(id, { assetNo = null, tyreSerial = null, site } = {}) {
  const a = assetNo ? String(assetNo).trim() : ''
  const s = tyreSerial ? String(tyreSerial).trim() : ''
  if (!a && !s) throw new Error('Enter an asset number or a tyre serial to assign the tag to.')
  const patch = { asset_no: a || null, tyre_serial: s || null, status: 'active' }
  if (site !== undefined) patch.site = site ? String(site).trim() : null
  return unwrap(await supabase.from('rfid_tags').update(patch).eq('id', id).select(COLS).single())
}

/** Remove the mapping; the tag stays registered as unassigned. */
export async function unassignTag(id) {
  return unwrap(await supabase.from('rfid_tags').update({ asset_no: null, tyre_serial: null, status: 'unassigned' }).eq('id', id).select(COLS).single())
}

/** Retire a tag (damaged / removed from use). The mapping is kept for history. */
export async function retireTag(id) {
  return unwrap(await supabase.from('rfid_tags').update({ status: 'retired' }).eq('id', id).select(COLS).single())
}

/** Bring a retired tag back: active when still mapped, otherwise unassigned. */
export async function reactivateTag(row) {
  const mapped = Boolean(row?.asset_no || row?.tyre_serial)
  return unwrap(await supabase.from('rfid_tags').update({ status: mapped ? 'active' : 'unassigned' }).eq('id', row.id).select(COLS).single())
}
