/**
 * materialIssue.js - client boundary for the Store Material Issue (MIS) module.
 *
 * TWO SOURCES, AND THE HISTORICAL ONE IS THE PRIMARY VALUE
 * -------------------------------------------------------
 * 1. THE SLIPS THAT ALREADY EXIST. `parts_consumption.issue_number` has carried
 *    the store's own document number the whole time - 83,580 slips across
 *    209,536 lines, every one linked to exactly one job card. Nothing had ever
 *    surfaced them. `listSlipsFromConsumption` reads that register, so this
 *    module is genuinely useful on a database that has NOT run V609.
 *
 * 2. SLIPS RAISED IN APP. `material_issues` / `material_issue_lines` (V609) add
 *    the ability to RAISE a slip rather than only read history. That migration
 *    is authored separately and IS NOT APPLIED YET, so every call against those
 *    tables degrades through the shared `isMissingRelation` helper to an honest
 *    "not provisioned" state instead of an error.
 *
 * ROW CAPS ARE NOT OPTIONAL HERE. `parts_consumption` is one of the policed
 * massive tables (216k rows). Every read below is bounded server-side by country
 * and date window, paged with `fetchAllPages`, ordered on a UNIQUE tiebreak
 * (`id`), and carries a `max` ceiling whose `truncated` flag the page states out
 * loud. A silently truncated register is worse than a slow one.
 *
 * Pure logic lives in `src/lib/materialIssue.js`; this file only talks to the
 * database.
 *
 * @module api/materialIssue
 */
import { supabase, fetchAllPages, isMissingRelation, isNotProvisioned, isMissingColumn, ServiceError, toServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { groupLinesIntoSlips } from '../materialIssue'

/**
 * The columns the slip register needs. Least-privilege: no `select('*')`, and
 * every column here is consumed by the engine or rendered.
 */
const LINE_COLS = [
  'id', 'issue_number', 'work_order_no', 'event_date', 'txn_date',
  'asset_code', 'asset_description', 'asset_type', 'site', 'store_code', 'cost_center',
  'item_code', 'item_description', 'qty', 'uom', 'unit_cost',
  'line_cost', 'tyre_cost', 'spare_cost', 'oil_cost', 'cost_category',
  'currency', 'country', 'source_system', 'source_row',
].join(', ')

/** Default ceiling for one register read. ~26k lines a year, so a 12-month
 *  window sits comfortably inside this and a wider one reports truncation. */
export const DEFAULT_LINE_MAX = 60000

/** A slip has ~2.5 lines; 500 is a real bound well under the 1,000 server cap. */
const SLIP_LINE_LIMIT = 500

/**
 * Job cards offered in the raise-a-slip picker. A LITERAL constant, not a
 * caller-supplied number: `work_orders` is a policed massive table, so the bound
 * has to be one a reader (and the row-cap guard) can prove is under the server's
 * 1,000-row cap. This is a picker, not a register.
 */
const JOB_CARD_LIMIT = 200

/** Header columns for a slip raised in app (V609). */
const ISSUE_COLS = 'id, issue_number, doc_type, work_order_no, asset_no, site, '
  + 'store_code, issued_to, issued_by, issued_by_name, issued_at, status, notes, '
  + 'country, client_uuid, created_at'

/** Line columns for a slip raised in app (V609). */
const ISSUE_LINE_BASE_COLS = 'id, issue_id, line_no, item_code, item_description, qty, '
  + 'uom, unit_cost, line_cost, category'
/** WP5 (20261124091000) adds the balance a line comes from and its posting. */
const ISSUE_LINE_COLS = `${ISSUE_LINE_BASE_COLS}, stock_id, movement_id`

/** Balance lines offered per slip line (v_inv_balances is RLS-scoped). */
const SLIP_STOCK_COLS = 'id, item_code, description, site, country, location_code, condition, qty_on_hand, qty_reserved, uom'
const SLIP_STOCK_LIMIT = 50

/** Strip the characters that would change the meaning of a PostgREST `or` filter. */
function sanitizeSearch(term) {
  return String(term || '').replace(/[,()\\%]/g, '').trim().slice(0, 80)
}

/* ------------------------------------------------------------------ *
 * 1. The slips that already exist, inside parts_consumption           *
 * ------------------------------------------------------------------ */

/** Coverage uses the same RLS-protected source as the register, without
 * downloading historical lines or relying on administrator import history. */
export async function getMaterialIssueCoverage({ country } = {}) {
  const boundary = (ascending) => {
    let q = supabase.from('parts_consumption').select('event_date')
      .not('issue_number', 'is', null).not('event_date', 'is', null)
      .order('event_date', { ascending }).order('id', { ascending }).limit(1)
    if (country && country !== 'All') q = q.eq('country', country)
    return q
  }
  const [first, last] = await Promise.all([boundary(true), boundary(false)])
  if (first.error || last.error) throw toServiceError(first.error || last.error, 'Could not read uploaded MIS history.')
  return { first: first.data?.[0]?.event_date || null, last: last.data?.[0]?.event_date || null }
}

/**
 * The real store document register, folded out of the expense lines.
 *
 * Bounded three ways so a 216k-row table can never be read whole into a browser:
 * server-side country scope, a server-side date window, and a `max` ceiling on
 * the paged read. `truncated` is returned rather than swallowed so the page can
 * say the view is capped instead of quietly showing a partial register as if it
 * were complete.
 *
 * @param {object} [opts]
 * @param {string} [opts.country] one country, or 'All'
 * @param {string} [opts.from]    ISO day, inclusive
 * @param {string} [opts.to]      ISO day, inclusive
 * @param {string} [opts.site]
 * @param {string} [opts.search]  matches slip number, job card or item text
 * @param {number} [opts.max]
 * @returns {Promise<{slips:Array, lines:Array, truncated:boolean, unslipped:number}>}
 */
export async function listSlipsFromConsumption(opts = {}) {
  const { country, from, to, site, store, search, max = DEFAULT_LINE_MAX } = opts

  const build = (fromIdx, toIdx) => {
    let q = supabase
      .from('parts_consumption')
      .select(LINE_COLS)
      .not('issue_number', 'is', null)
      .order('event_date', { ascending: false })
      // `id` is the unique tiebreak. Paging on event_date alone would drop or
      // repeat rows at a page boundary, because a store issues many slips a day.
      .order('id', { ascending: false })
      .range(fromIdx, toIdx)
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('event_date', from)
    if (to) q = q.lte('event_date', to)
    if (site && site !== 'All') q = q.eq('site', site)
    if (store && store !== 'All') q = q.eq('store_code', store)
    const s = sanitizeSearch(search)
    if (s) {
      q = q.or(
        `issue_number.ilike.%${s}%,work_order_no.ilike.%${s}%,`
        + `item_code.ilike.%${s}%,item_description.ilike.%${s}%,asset_code.ilike.%${s}%`,
      )
    }
    return q
  }

  const [pageResult, unslipped] = await Promise.all([
    fetchAllPages(build, { max }),
    countUnslippedLines({ country, from, to, site, store }),
  ])
  const { data, error, truncated } = pageResult
  if (error) {
    if (isMissingRelation(error)) {
      return { slips: [], lines: [], truncated: false, unslipped: null, missing: true }
    }
    throw new ServiceError(toUserMessage(error, 'Could not load the material issue register.'), error?.code, error)
  }
  const rows = Array.isArray(data) ? data : []
  return {
    slips: groupLinesIntoSlips(rows),
    lines: rows,
    truncated: Boolean(truncated),
    // COUNTED SEPARATELY, and this is the point: the read above filters null
    // slip numbers out server-side, so counting them in `rows` would always be
    // zero and would read as "we checked and found none" when we never looked.
    // A head count answers over the WHOLE window, not just the capped read.
    unslipped,
    missing: false,
  }
}

/**
 * Expense lines in this window that carry NO slip number, so belong to no
 * document. Measured live as zero, which is exactly why a non-zero result is
 * worth surfacing rather than assuming.
 *
 * A head-only exact count: no rows cross the wire, and the answer covers the
 * whole window rather than the capped read. Returns null - not 0 - when the
 * count cannot be taken, because "we could not look" and "there are none" are
 * different claims.
 *
 * @returns {Promise<number|null>}
 */
export async function countUnslippedLines({ country, from, to, site, store } = {}) {
  try {
    let q = supabase
      .from('parts_consumption')
      .select('id', { count: 'exact', head: true })
      .is('issue_number', null)
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('event_date', from)
    if (to) q = q.lte('event_date', to)
    if (site && site !== 'All') q = q.eq('site', site)
    if (store && store !== 'All') q = q.eq('store_code', store)
    const { count, error } = await q
    if (error) return null
    return Number.isFinite(count) ? count : null
  } catch {
    return null
  }
}

/**
 * The lines behind ONE historical slip.
 *
 * `country` is required, not optional: `GC/MIS/...` is issued by both KSA and
 * UAE, so a lookup on the number alone would merge two countries' documents.
 * Bounded by an explicit limit that is provably under the server's row cap.
 *
 * @param {string} issueNumber
 * @param {string} country
 * @returns {Promise<Array<object>>} throws a sanitised ServiceError when the
 *   read fails - an unreadable slip must not render as a slip with no lines.
 */
export async function getSlipLines(issueNumber, country) {
  const num = String(issueNumber || '').trim()
  if (!num) return []
  let q = supabase
    .from('parts_consumption')
    .select(LINE_COLS)
    .eq('issue_number', num)
    .order('id', { ascending: true })
    .limit(SLIP_LINE_LIMIT)
  if (country && country !== 'All') q = q.eq('country', country)
  const { data, error } = await q
  if (error) throw toServiceError(error, 'Could not read the lines of this slip.')
  return Array.isArray(data) ? data : []
}

/* ------------------------------------------------------------------ *
 * 2. Slips raised in app (V609) - degrade when not provisioned        *
 * ------------------------------------------------------------------ */

/**
 * True when the V609 tables exist on this database. Used to decide whether the
 * "Raise an issue" tab can work at all, so the page states the reason rather
 * than offering a form that cannot save.
 * @returns {Promise<boolean>}
 */
export async function materialIssuesProvisioned() {
  try {
    const { error } = await supabase
      .from('material_issues')
      .select('id', { count: 'exact', head: true })
    // Any error means the form cannot save - the table is absent, or it exists
    // and this user may not write it. Either way the honest answer is the same:
    // do not offer a form that will fail. The page states which case it is from
    // the reason it renders, never by guessing here.
    return !error
  } catch {
    return false
  }
}

/**
 * Slips raised in app.
 * @param {{country?:string, status?:string, from?:string, to?:string, limit?:number}} [opts]
 * @returns {Promise<{rows:Array, missing:boolean}>}
 */
export async function listMaterialIssues(opts = {}) {
  const { country, status, from, to, limit = 500 } = opts
  try {
    let q = supabase
      .from('material_issues')
      .select(ISSUE_COLS)
      .order('issued_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 500, 900)))
    if (country && country !== 'All') q = q.eq('country', country)
    if (status && status !== 'All') q = q.eq('status', status)
    if (from) q = q.gte('issued_at', from)
    if (to) q = q.lte('issued_at', to)
    const { data, error } = await q
    if (error) {
      // Only a genuinely undeployed table is "missing". A permission or network
      // failure used to be reported as missing too, which told the reader the
      // feature was not installed when it simply could not be read.
      if (isNotProvisioned(error)) return { rows: [], missing: true }
      throw toServiceError(error, 'Could not load the slips raised in this app.')
    }
    return { rows: Array.isArray(data) ? data : [], missing: false }
  } catch (err) {
    if (isNotProvisioned(err)) return { rows: [], missing: true }
    throw toServiceError(err, 'Could not load the slips raised in this app.')
  }
}

/**
 * The lines of one in-app slip.
 * @param {string} issueId
 * @returns {Promise<Array<object>>}
 */
export async function listMaterialIssueLines(issueId) {
  if (!issueId) return []
  try {
    const read = (cols) => supabase
      .from('material_issue_lines')
      .select(cols)
      .eq('issue_id', issueId)
      .order('line_no', { ascending: true })
      .limit(SLIP_LINE_LIMIT)
    let { data, error } = await read(ISSUE_LINE_COLS)
    // Before WP5 the stock_id / movement_id columns do not exist; PostgREST fails
    // the whole read on an unknown column, so retry with the base list.
    if (error && isMissingColumn(error)) ({ data, error } = await read(ISSUE_LINE_BASE_COLS))
    if (error) {
      if (isNotProvisioned(error)) return []
      throw toServiceError(error, 'Could not read the lines of this slip.')
    }
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (isNotProvisioned(err)) return []
    throw toServiceError(err, 'Could not read the lines of this slip.')
  }
}

/**
 * Drop keys whose value is blank.
 *
 * NOT COSMETIC. Several V609 columns are `NOT NULL DEFAULT <x>` (qty, unit_cost,
 * doc_type, status, issued_at), and a column default DOES NOT APPLY when the
 * client sends an explicit null - it applies only when the key is ABSENT. This
 * repo has already shipped that exact bug twice: an explicit null `opened_at`
 * aborted whole work-order import batches. So a blank field is omitted, never
 * nulled.
 */
function omitBlank(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue
    out[k] = v
  }
  return out
}

/**
 * Save a slip and its lines.
 *
 * THE SLIP NUMBER IS MINTED BY THE DATABASE, not here. `next_material_issue_no`
 * is revoked from `authenticated` (service_role only) precisely so a browser
 * cannot hand out a sequence, and a BEFORE INSERT trigger fills `issue_number`
 * when it arrives blank. So this never asks for a number; it reads back the one
 * the server assigned.
 *
 * `line_cost` IS NEVER SENT: it is a STORED GENERATED column that applies the
 * sign from `doc_type`, which is what makes a return always credit. Nor is a
 * line's `doc_type` - a trigger force-stamps it from the header, so a client
 * value would be ignored anyway.
 *
 * The header is written first, then its lines, and a line failure DELETES the
 * orphaned header rather than leaving a slip with no items - a half-saved
 * document reads as a real issue that took nothing off the shelf. There is no
 * client-side transaction here, so this is the honest compensation.
 *
 * @param {object} header
 * @param {Array<object>} lines
 * @returns {Promise<{ok:boolean, id?:string, issue_number?:string, reason?:string}>}
 */
export async function createMaterialIssue(header = {}, lines = []) {
  const payload = omitBlank({
    doc_type: String(header.doc_type || 'MIS').toUpperCase(),
    work_order_no: header.work_order_no,
    asset_no: header.asset_no,
    site: header.site,
    store_code: header.store_code,
    issued_to: header.issued_to,
    issued_by_name: header.issued_by_name,
    issued_at: header.issued_at,
    status: header.status || 'issued',
    notes: header.notes,
    country: header.country,
    client_uuid: header.client_uuid,
  })

  let created
  try {
    const { data, error } = await supabase
      .from('material_issues')
      .insert(payload)
      .select(ISSUE_COLS)
      .single()
    if (error) {
      if (isMissingRelation(error)) return { ok: false, reason: 'not_provisioned' }
      throw new ServiceError(toUserMessage(error, 'Could not save that slip.'), error?.code, error)
    }
    created = data
  } catch (err) {
    if (isMissingRelation(err)) return { ok: false, reason: 'not_provisioned' }
    throw err
  }

  const body = (Array.isArray(lines) ? lines : [])
    .filter((l) => l && (l.item_code || l.item_description))
    .map((l, i) => omitBlank({
      issue_id: created.id,
      line_no: i + 1,
      item_code: l.item_code,
      item_description: l.item_description,
      // qty must be > 0 and unit_cost >= 0 (both CHECKed, both NOT NULL with a
      // default). An unpriced line simply omits unit_cost and takes the 0.
      qty: l.qty === '' || l.qty == null ? undefined : Number(l.qty),
      uom: l.uom,
      unit_cost: l.unit_cost === '' || l.unit_cost == null ? undefined : Number(l.unit_cost),
      category: l.category,
      // Only sent when the caller chose a balance (posting mode, WP5 applied):
      // before WP5 the column does not exist and the insert would be refused.
      stock_id: l.stock_id,
    }))

  if (body.length) {
    const { error } = await supabase.from('material_issue_lines').insert(body)
    if (error) {
      // Roll the header back so no slip exists with zero items.
      await supabase.from('material_issues').delete().eq('id', created.id)
      throw new ServiceError(toUserMessage(error, 'Could not save the items on that slip.'), error?.code, error)
    }
  }

  return { ok: true, id: created.id, issue_number: created.issue_number }
}

/**
 * Move a slip between statuses (draft / issued / cancelled).
 * @param {string} id
 * @param {string} status
 */
export async function setIssueStatus(id, status) {
  if (!id) return { ok: false, reason: 'no_id' }
  try {
    const { error } = await supabase
      .from('material_issues')
      .update({ status: String(status || '').toLowerCase() })
      .eq('id', id)
    if (error) {
      if (isMissingRelation(error)) return { ok: false, reason: 'not_provisioned' }
      throw new ServiceError(toUserMessage(error, 'Could not update that slip.'), error?.code, error)
    }
    return { ok: true }
  } catch (err) {
    if (isMissingRelation(err)) return { ok: false, reason: 'not_provisioned' }
    throw err
  }
}

/* ------------------------------------------------------------------ *
 * 3. Summary - server aggregate preferred                             *
 * ------------------------------------------------------------------ */

/**
 * Ask the server to aggregate the register.
 *
 * PREFERRED over a client rollup: aggregating 209,536 rows belongs in the
 * database, not the browser. Returns `{ ok:false }` when the RPC is absent so
 * the page falls back to summarising the bounded rows it already fetched, and
 * SAYS that the fallback is a capped view.
 *
 * @param {{country?:string, from?:string, to?:string}} [opts]
 * @returns {Promise<{ok:boolean, data:object|null}>}
 */
export async function getIssueSummary({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_material_issue_summary', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error) return { ok: false, data: null }
    if (!data) return { ok: false, data: null }
    return { ok: true, data }
  } catch {
    return { ok: false, data: null }
  }
}

/* ------------------------------------------------------------------ *
 * 4. Pickers for raising a slip                                       *
 * ------------------------------------------------------------------ */

/**
 * Open job cards a slip can be issued against.
 *
 * Bounded by a real limit well under the server cap - this is a picker, not a
 * register, so the newest few hundred cards is the useful set and a wider read
 * would be paying for rows nobody scrolls to.
 *
 * @param {{country?:string, search?:string}} [opts]
 */
export async function listIssuableJobCards({ country, search } = {}) {
  try {
    let q = supabase
      .from('work_orders')
      .select('id, work_order_no, asset_no, site, status, opened_at, description')
      .order('opened_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(JOB_CARD_LIMIT)
    if (country && country !== 'All') q = q.eq('country', country)
    const s = sanitizeSearch(search)
    if (s) q = q.or(`work_order_no.ilike.%${s}%,asset_no.ilike.%${s}%`)
    const { data, error } = await q
    if (error) throw toServiceError(error, 'Could not load job cards.')
    return Array.isArray(data) ? data : []
  } catch (err) {
    // A failed read must not render as "No job card matches that".
    throw toServiceError(err, 'Could not load job cards.')
  }
}

/* ------------------------------------------------------------------ *
 * 5. Posting a slip to stock (WP5, migration 20261124091000)          *
 * ------------------------------------------------------------------ */

let postingAvailableCache = null

/** Sentences raised by inv_issue_slip / _inv_post that are safe to show verbatim. */
const SLIP_SERVER_SENTENCE = /^(Line [0-9?]+: |Only \d|Only an issued slip|This slip |A return |Stock permission "issue"|Slip not found|Not authorised)/

/**
 * Does `inv_issue_slip` exist on this database? Asked once per session.
 *
 * Probed with an empty payload: an existing function answers with its own
 * refusal (issue_id is required, or no "issue" permission), a missing one with
 * PGRST202 / 42883. Only the missing-function codes mean "not available"; any
 * other answer proves the function is there, and the server still decides
 * whether this person may post.
 *
 * @returns {Promise<boolean>}
 */
export async function issueSlipPostingAvailable({ refresh = false } = {}) {
  if (postingAvailableCache !== null && !refresh) return postingAvailableCache
  try {
    const { error } = await supabase.rpc('inv_issue_slip', { p_payload: {} })
    postingAvailableCache = !(error && isNotProvisioned(error))
  } catch (err) {
    postingAvailableCache = !isNotProvisioned(err)
  }
  return postingAvailableCache
}

/** Test hook: forget the cached probe. */
export function resetIssueSlipPostingProbe() { postingAvailableCache = null }

/**
 * Post every unposted line of one ISSUED slip to the stock ledger, atomically.
 * MIS takes stock off the shelf, MRT puts it back (bounded by what the job card
 * took from that stock line). Posting the same slip twice moves nothing twice.
 *
 * Never throws for a business refusal: returns `{ ok:false, reason }` so the page
 * can say the slip is saved but stock did not move.
 *
 * @param {string} issueId
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, posted?:number, already?:number, lines?:Array}>}
 */
export async function postMaterialIssueSlip(issueId) {
  if (!issueId) return { ok: false, reason: 'no_id', message: 'No slip to post.' }
  let data
  let error
  try {
    ({ data, error } = await supabase.rpc('inv_issue_slip', { p_payload: { issue_id: issueId } }))
  } catch (err) {
    error = err
  }
  if (error) {
    if (isNotProvisioned(error)) {
      postingAvailableCache = false
      return { ok: false, reason: 'not_available' }
    }
    const code = String(error.code || error.cause?.code || '')
    // The posting function raises plain sentences written for the storekeeper
    // (which line, which quantity, which rule). Those are shown as they are; any
    // other text goes through the sanitiser so no database internals leak.
    const raw = String(error.message || '')
    const message = SLIP_SERVER_SENTENCE.test(raw) && raw.length < 300
      ? raw
      : toUserMessage(error, 'Could not post that slip to stock.')
    return { ok: false, reason: code === '23514' ? 'shortage' : code === '42501' ? 'forbidden' : 'refused', message, code }
  }
  return {
    ok: true,
    posted: Number(data?.posted_lines) || 0,
    already: Number(data?.already_posted) || 0,
    lines: Array.isArray(data?.lines) ? data.lines : [],
    issueNumber: data?.issue_number || null,
  }
}

/**
 * The stock lines one slip line can be posted against: same country, the slip's
 * site and the item code. Bounded (a picker, not a register). RLS scopes the
 * view to the reader's countries and sites.
 *
 * @param {{country?:string, site?:string, itemCode?:string}} opts
 * @returns {Promise<Array<object>>} throws a sanitised error when unreadable
 */
export async function listSlipStockLines({ country, site, itemCode } = {}) {
  const code = String(itemCode || '').trim()
  if (!code) return []
  let q = supabase
    .from('v_inv_balances')
    .select(SLIP_STOCK_COLS)
    .eq('item_code', code)
    .order('qty_on_hand', { ascending: false })
    .order('id', { ascending: true })
    .limit(SLIP_STOCK_LIMIT)
  if (country && country !== 'All') q = q.eq('country', country)
  const s = String(site || '').trim()
  if (s) q = q.eq('site', s.toUpperCase())
  const { data, error } = await q
  if (error) {
    if (isNotProvisioned(error)) return []
    // A failed read must not read as "no stock for this item".
    throw toServiceError(error, 'Could not read the stock lines for this item.')
  }
  return Array.isArray(data) ? data : []
}
