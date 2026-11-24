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
 * The server keeps in-transit stock at the DESTINATION site, and (before WP5,
 * migration 20261124091000) every leg is checked against the poster's site scope.
 * So a person scoped to some sites cannot dispatch to a site outside that scope
 * (the in-transit leg is refused, nothing posts). Warn before sending.
 *
 * Once WP5 is applied the dispatch is allowed (only the source must be in scope,
 * the receiver needs the destination, a return needs the source); pass
 * `transitExempt: true` then and this returns false.
 *
 * @param {{site?:string}} from  source location
 * @param {{site?:string}} to    destination location
 * @param {{sites?:string[], isAdmin?:boolean, transitExempt?:boolean}} who
 * @returns {boolean} true when the server is expected to refuse
 */
export function crossSiteOutOfScope(from, to, { sites, isAdmin = false, transitExempt = false } = {}) {
  if (isAdmin || transitExempt || !from || !to) return false
  const a = norm(from.site)
  const b = norm(to.site)
  if (!a || !b || a === b) return false
  if (seesAllSites(sites)) return false
  const scope = new Set((sites || []).map(norm))
  return !scope.has(b)
}

/**
 * A return to stock must name the job card (or document) the material was issued
 * against: the server bounds a return by what that document took from the stock
 * line, and values it at the issued cost (never a guess). True when the form has
 * nothing to send.
 */
export function returnNeedsDocument(doc) {
  return !issueDocFields(doc).sourceDocId
}

/**
 * The balance lines a material issue slip line can come from: the slip's site
 * and the line's item code, most available first. Rows come from v_inv_balances.
 *
 * @param {Array<object>} balances
 * @param {{site?:string, itemCode?:string}} where
 */
export function slipStockOptions(balances = [], { site, itemCode } = {}) {
  const s = norm(site)
  const c = norm(itemCode)
  return (Array.isArray(balances) ? balances : [])
    .filter((b) => b && b.id && (!c || norm(b.item_code) === c) && (!s || norm(b.site) === s))
    .map((b) => ({ ...b, available: availableQty(b) }))
    .sort((a, b) => ((b.available ?? -1) - (a.available ?? -1))
      || String(a.location_code ?? '').localeCompare(String(b.location_code ?? '')))
}

/**
 * Pre-select the stock line for a slip line, or null when the choice is not
 * obvious. An issue takes the line with the most free stock that covers the
 * quantity. A return goes back to the line it was issued from, so it is picked
 * only when there is exactly one candidate; otherwise the person chooses (the
 * server refuses a return the line never issued).
 *
 * @returns {object|null}
 */
export function pickSlipStockLine(balances, { site, itemCode, qty, docType = 'MIS' } = {}) {
  const opts = slipStockOptions(balances, { site, itemCode })
  if (opts.length === 0) return null
  if (String(docType || '').toUpperCase() === 'MRT') return opts.length === 1 ? opts[0] : null
  const q = positiveQty(qty)
  const fit = opts.filter((o) => q === null || (o.available ?? 0) >= q)
  return fit[0] || null
}
