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
import { supabase, fetchAllPages, isMissingRelation } from './_client'
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
  'currency', 'country',
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
const ISSUE_LINE_COLS = 'id, issue_id, line_no, item_code, item_description, qty, '
  + 'uom, unit_cost, line_cost, category'

/** Strip the characters that would change the meaning of a PostgREST `or` filter. */
function sanitizeSearch(term) {
  return String(term || '').replace(/[,()\\%]/g, '').trim().slice(0, 80)
}

/* ------------------------------------------------------------------ *
 * 1. The slips that already exist, inside parts_consumption           *
 * ------------------------------------------------------------------ */

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
  const { country, from, to, site, search, max = DEFAULT_LINE_MAX } = opts

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
    const s = sanitizeSearch(search)
    if (s) {
      q = q.or(
        `issue_number.ilike.%${s}%,work_order_no.ilike.%${s}%,`
        + `item_code.ilike.%${s}%,item_description.ilike.%${s}%,asset_code.ilike.%${s}%`,
      )
    }
    return q
  }

  const { data, error, truncated } = await fetchAllPages(build, { max })
  if (error) {
    if (isMissingRelation(error)) {
      return { slips: [], lines: [], truncated: false, unslipped: null, missing: true }
    }
    throw new Error(toUserMessage(error, 'Could not load the material issue register.'))
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
    unslipped: await countUnslippedLines({ country, from, to, site }),
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
export async function countUnslippedLines({ country, from, to, site } = {}) {
  try {
    let q = supabase
      .from('parts_consumption')
      .select('id', { count: 'exact', head: true })
      .is('issue_number', null)
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('event_date', from)
    if (to) q = q.lte('event_date', to)
    if (site && site !== 'All') q = q.eq('site', site)
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
 * @returns {Promise<Array<object>>} [] when unreadable
 */
export async function getSlipLines(issueNumber, country) {
  const num = String(issueNumber || '').trim()
  if (!num) return []
  try {
    let q = supabase
      .from('parts_consumption')
      .select(LINE_COLS)
      .eq('issue_number', num)
      .order('id', { ascending: true })
      .limit(SLIP_LINE_LIMIT)
    if (country && country !== 'All') q = q.eq('country', country)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
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
    if (error) return { rows: [], missing: isMissingRelation(error) }
    return { rows: Array.isArray(data) ? data : [], missing: false }
  } catch {
    return { rows: [], missing: true }
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
    const { data, error } = await supabase
      .from('material_issue_lines')
      .select(ISSUE_LINE_COLS)
      .eq('issue_id', issueId)
      .order('line_no', { ascending: true })
      .limit(SLIP_LINE_LIMIT)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
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
      throw new Error(toUserMessage(error, 'Could not save that slip.'))
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
    }))

  if (body.length) {
    const { error } = await supabase.from('material_issue_lines').insert(body)
    if (error) {
      // Roll the header back so no slip exists with zero items.
      await supabase.from('material_issues').delete().eq('id', created.id)
      throw new Error(toUserMessage(error, 'Could not save the items on that slip.'))
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
      throw new Error(toUserMessage(error, 'Could not update that slip.'))
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
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
