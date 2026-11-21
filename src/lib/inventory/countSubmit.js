/**
 * Pure helpers for the blind-count submit (AuditCounterView).
 *
 * The server (inv_count_submit) takes item and location IDS, never codes, and
 * answers { accepted, duplicates, rejected: [{client_uuid, reason}] }. It is
 * idempotent per line client_uuid, and the outer request key stores a hash of
 * the whole payload, so a retry must resend the IDENTICAL payload.
 */

const norm = (v) => String(v ?? '').trim().toUpperCase()

/**
 * Resolve a typed location code against the audit's own locations.
 * Blank -> { id: null } (allowed: "found somewhere in this audit").
 */
export function resolveLocationCode(code, locations = []) {
  const c = norm(code)
  if (!c) return { id: null, error: null }
  const hits = (locations || []).filter((l) => norm(l.code) === c)
  if (hits.length === 1) return { id: hits[0].id, error: null }
  return { id: null, error: hits.length ? 'inventory.count.extraLocationAmbiguous' : 'inventory.count.extraLocationUnknown' }
}

/**
 * Pick the one item a typed code names. `candidates` come from lookupCode
 * (exact item_code / barcode match). Prefer the audit's country; refuse when
 * nothing or more than one item remains, so a count is never booked to a guess.
 */
export function pickItem(code, candidates = [], country = null) {
  const c = norm(code)
  if (!c) return { id: null, error: 'inventory.count.extraItemUnknown' }
  let hits = (candidates || []).filter((m) => norm(m.item_code) === c || norm(m.barcode) === c)
  if (country && hits.length > 1) {
    const same = hits.filter((m) => norm(m.country) === norm(country))
    if (same.length) hits = same
  }
  if (hits.length === 1) return { id: hits[0].id, error: null }
  return { id: null, error: hits.length ? 'inventory.count.extraItemAmbiguous' : 'inventory.count.extraItemUnknown' }
}

/** Stable signature of what is about to be sent: same lines -> same request key. */
export function payloadSignature(lines = []) {
  return JSON.stringify((lines || []).map((l) => [
    l.client_uuid, l.location_id || null, l.item_id || null, l.serial_no || null, l.stock_id || null,
    l.confirmed_zero ? 0 : l.counted_qty, !!l.confirmed_zero, l.condition || null, l.remarks || null, !!l.unexpected,
  ]))
}

/**
 * Split the server answer. A line is done when accepted or a duplicate (already
 * stored by an earlier attempt); a rejected line stays on screen with its reason.
 */
export function splitSubmitResult(result, sentLines = []) {
  const done = new Set([...(result?.accepted || []), ...(result?.duplicates || [])].map(String))
  const rejected = new Map()
  for (const r of result?.rejected || []) {
    if (r && r.client_uuid != null) rejected.set(String(r.client_uuid), String(r.reason || ''))
  }
  // A sent line the server neither accepted nor rejected is NOT assumed saved.
  for (const l of sentLines || []) {
    const u = String(l.client_uuid)
    if (!done.has(u) && !rejected.has(u)) rejected.set(u, '')
  }
  return { done, rejected, allDone: rejected.size === 0 }
}
