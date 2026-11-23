/**
 * Pure rules for the stock flow forms (issue, return, transfer). No I/O.
 *
 * The server stays the authority: every posting goes through an inv_* RPC that
 * refuses a shortage, a wrong scope or a missing permission. These helpers only
 * decide what the form SENDS (so an issue to a job card is recorded as one) and
 * what it WARNS about before the user presses the button.
 */

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A positive quantity, or null. */
export function positiveQty(v) {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}

/**
 * Document fields for an issue / return / reservation.
 *
 * A job card number given in the form is recorded as the SOURCE DOCUMENT
 * (source_doc_type 'job_card', source_doc_id = the number) as well as the
 * reference. Before this, an issue sent source_doc_type 'issue' with no id, so
 * nothing linked the movement to the job card it was issued against.
 */
export function issueDocFields(doc) {
  const d = String(doc ?? '').trim()
  if (!d) return { sourceDocType: null, sourceDocId: null, referenceNo: null }
  return { sourceDocType: 'job_card', sourceDocId: d, referenceNo: d }
}

/** Free stock on a balance line: on hand minus reserved, never below zero. */
export function availableQty(stock) {
  if (!stock) return null
  const onHand = num(stock.qty_on_hand)
  if (onHand === null) return null
  const reserved = num(stock.qty_reserved) || 0
  return Math.max(0, onHand - reserved)
}

/**
 * Would this issue be refused for shortage? Consuming the caller's own
 * reservation draws on reserved stock, so that part is added back.
 * Returns null when it fits or cannot be judged, else `{ requested, available }`.
 */
export function issueShortfall({ stock, qty, reservedForMe = 0 } = {}) {
  const want = positiveQty(qty)
  const free = availableQty(stock)
  if (want === null || free === null) return null
  const canUse = free + Math.max(0, num(reservedForMe) || 0)
  return want > canUse ? { requested: want, available: canUse } : null
}

/**
 * Transfer receive lines worth sending. A line left at 0 is SKIPPED, not sent:
 * the server refuses a zero quantity on any line, which used to fail the whole
 * receipt when one line of several had not arrived yet.
 */
export function receivableLines(lines = []) {
  return (lines || []).filter((l) => l && l.line_id && positiveQty(l.received_qty) !== null)
}

/** A received quantity above what is still in transit. */
export function overReceived(lines = []) {
  return (lines || []).filter((l) => {
    const got = positiveQty(l?.received_qty)
    const left = num(l?.outstanding)
    return got !== null && left !== null && got > left
  })
}

const norm = (s) => String(s ?? '').trim().toUpperCase()

/** True when the profile's site scope is unrestricted. */
export function seesAllSites(sites) {
  if (!Array.isArray(sites) || sites.length === 0) return false
  return sites.some((s) => ['ALL', '*'].includes(norm(s)))
}

/**
 * The server keeps in-transit stock at the DESTINATION site, and every leg is
 * checked against the poster's site scope. So a person scoped to some sites
 * cannot dispatch to a site outside that scope (the in-transit leg is refused,
 * nothing posts), nor return such a transfer to its source. Warn before sending.
 *
 * @param {{site?:string}} from  source location
 * @param {{site?:string}} to    destination location
 * @param {{sites?:string[], isAdmin?:boolean}} who
 * @returns {boolean} true when the server is expected to refuse
 */
export function crossSiteOutOfScope(from, to, { sites, isAdmin = false } = {}) {
  if (isAdmin || !from || !to) return false
  const a = norm(from.site)
  const b = norm(to.site)
  if (!a || !b || a === b) return false
  if (seesAllSites(sites)) return false
  const scope = new Set((sites || []).map(norm))
  return !scope.has(b)
}
