/**
 * tyreCostAudit.js (service) - Tyre Cost Audit over migration 20261112106000.
 *
 * Reads and writes ONLY through the audit objects:
 *   rpc tyre_cost_audit_scan     (dry run summary, or persist findings)
 *   table tyre_cost_audit_findings (read only; RLS: org + country, elevated read)
 *   rpc tyre_cost_audit_decide   (approve / reject; reject needs a reason)
 *   rpc tyre_cost_audit_apply    (Admin / super admin; returns an undo batch)
 *   rpc tyre_cost_correction_undo(batch)
 *
 * Until the migration is applied every call returns `{ installed: false }`
 * instead of throwing, so the screen can say so honestly. Detection is by CODE
 * (isNotProvisioned) with the shared text fallback (isMissingRelation) only for
 * errors that carry no code at all, so a permission denial is never mistaken
 * for "not installed".
 *
 * Money is never summed across currencies here; callers get rows with their
 * own currency.
 */
import { supabase, fetchAllPages, fetchAllOrThrow, ServiceError, isNotProvisioned, isMissingRelation } from './_client'
import { buildPriceIndex } from '../tyreCostAudit'
import { toUserMessage } from '../safeError'
import { sanitizeSearchTerm } from '../searchFilter'

export const NOT_INSTALLED_MESSAGE = 'Tyre Cost Audit is not installed on this database yet'
export const PAGE_SIZE = 100
export const EXPORT_MAX = 20000

export const FINDING_COLS = [
  'id', 'tyre_id', 'country', 'site', 'asset_no', 'serial_no', 'job_card', 'month', 'class',
  'original_cost', 'proposed_cost', 'currency', 'item_code', 'source_line_id', 'confidence', 'reasons',
  'status', 'decided_by', 'decided_at', 'decision_note', 'applied_batch', 'applied_at', 'first_seen', 'last_seen',
].join(',')

// Light projection for KPI and breakdown totals.
const TOTAL_COLS = 'id,country,site,month,class,status,proposed_cost,currency,item_code'

/** True when the failure means the audit objects are not deployed yet. */
export function auditNotInstalled(err) {
  if (!err) return false
  if (isNotProvisioned(err)) return true
  const code = err.code || err.cause?.code
  return !code && isMissingRelation(err)
}

const fail = (err, fallback) => new ServiceError(toUserMessage(err, fallback), err?.code ?? err?.cause?.code, err)
const blank = (v) => v == null || v === '' || v === 'All'
const monthOf = (d) => (d ? String(d).slice(0, 7) : null)

/**
 * Run the audit scan. dryRun true returns the summary and saves nothing.
 * @returns {Promise<{installed:boolean, data?:object}>}
 */
export async function runCostAudit({ country, from, to, dryRun = true } = {}) {
  const { data, error } = await supabase.rpc('tyre_cost_audit_scan', {
    p_country: blank(country) ? null : country,
    p_from: from || '2025-01-01',
    p_to: to || new Date().toISOString().slice(0, 10),
    p_dry_run: dryRun !== false,
  })
  if (error) {
    if (auditNotInstalled(error)) return { installed: false }
    throw fail(error, 'Could not run the tyre cost audit.')
  }
  return { installed: true, data: data || {} }
}

/** Apply the shared filters to a findings query. */
function applyFilters(q, { country, status, cls, search, from, to, site, itemCode, brand, size } = {}) {
  if (!blank(country)) q = q.or(`country.eq.${country},country.is.null`)
  if (!blank(status)) q = q.eq('status', status)
  if (!blank(cls)) q = q.eq('class', cls)
  if (!blank(site)) q = q.eq('site', site)
  if (!blank(itemCode)) q = q.ilike('item_code', `%${sanitizeSearchTerm(itemCode)}%`)
  const fm = monthOf(from)
  const tm = monthOf(to)
  if (fm) q = q.gte('month', fm)
  if (tm) q = q.lte('month', tm)
  if (!blank(brand)) q = q.ilike('tyre.brand', `%${sanitizeSearchTerm(brand)}%`)
  if (!blank(size)) q = q.ilike('tyre.size', `%${sanitizeSearchTerm(size)}%`)
  const s = sanitizeSearchTerm(search)
  if (s) q = q.or(`serial_no.ilike.%${s}%,asset_no.ilike.%${s}%,job_card.ilike.%${s}%,item_code.ilike.%${s}%`)
  return q
}

// Brand/size live on the tyre record; embed it (inner only when filtering on it).
const selectWith = (cols, f = {}) =>
  `${cols},tyre:tyre_records${!blank(f.brand) || !blank(f.size) ? '!inner' : ''}(brand,size)`

/**
 * One page of findings, newest month first, id as the tiebreak.
 * @returns {Promise<{installed:boolean, rows:object[], total:number}>}
 */
export async function listCostFindings({ page = 0, pageSize = PAGE_SIZE, ...filters } = {}) {
  const start = Math.max(0, page) * pageSize
  let q = supabase.from('tyre_cost_audit_findings').select(selectWith(FINDING_COLS, filters), { count: 'exact' })
  q = applyFilters(q, filters)
  const { data, error, count } = await q.order('month', { ascending: false }).order('id').range(start, start + pageSize - 1)
  if (error) {
    if (auditNotInstalled(error)) return { installed: false, rows: [], total: 0 }
    throw fail(error, 'Could not load the cost audit findings.')
  }
  return { installed: true, rows: data || [], total: count ?? (data || []).length }
}

/** Every finding in scope (for totals, breakdowns and Excel), bounded. */
export async function listAllCostFindings(filters = {}, { light = false, max = EXPORT_MAX } = {}) {
  const cols = selectWith(light ? TOTAL_COLS : FINDING_COLS, filters)
  const { data, error, truncated } = await fetchAllPages(
    (a, b) => applyFilters(supabase.from('tyre_cost_audit_findings').select(cols), filters).order('id').range(a, b),
    { max },
  )
  if (error) {
    if (auditNotInstalled(error)) return { installed: false, rows: [], truncated: false }
    throw fail(error, 'Could not load the cost audit findings.')
  }
  return { installed: true, rows: data || [], truncated: !!truncated }
}

/** Approve or reject findings. A rejection needs a reason (also enforced by the RPC). */
export async function decideFindings(ids, decision, note) {
  if (!Array.isArray(ids) || !ids.length) throw new ServiceError('Select at least one finding.')
  if (decision !== 'approved' && decision !== 'rejected') throw new ServiceError('Decision must be approve or reject.')
  if (decision === 'rejected' && !String(note || '').trim()) throw new ServiceError('A rejection needs a reason.')
  const { data, error } = await supabase.rpc('tyre_cost_audit_decide', {
    p_ids: ids, p_decision: decision, p_note: note ? String(note).trim() : null,
  })
  if (error) {
    if (auditNotInstalled(error)) throw new ServiceError(NOT_INSTALLED_MESSAGE, error.code, error)
    throw fail(error, 'Could not record the decision.')
  }
  return data || {}
}

/** Write APPROVED proposals. Returns { applied, batch, undo }. */
export async function applyFindings(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new ServiceError('Select at least one approved finding.')
  const { data, error } = await supabase.rpc('tyre_cost_audit_apply', { p_ids: ids })
  if (error) {
    if (auditNotInstalled(error)) throw new ServiceError(NOT_INSTALLED_MESSAGE, error.code, error)
    throw fail(error, 'Could not apply the corrections. Nothing was changed.')
  }
  return data || {}
}

/** Put one applied batch back exactly as it was. */
export async function undoBatch(batch) {
  if (!batch) throw new ServiceError('Nothing to undo.')
  const { data, error } = await supabase.rpc('tyre_cost_correction_undo', { p_batch: batch })
  if (error) throw fail(error, 'Could not undo that correction batch.')
  return data || {}
}

// ── BLOCK: import preview price index (loadPriceIndex) ──────────────────────────

/** Most months one preview will read; a file spanning more is unusual and bounded. */
export const PRICE_INDEX_MAX_MONTHS = 24
/** Hard stop on rows read per preview (tyre lines only, so far below the table size). */
export const PRICE_INDEX_MAX_ROWS = 20000

const PRICE_LINE_COLS = 'id, country, item_code, event_date, item_description, line_cost, qty_n'

/** 'YYYY-MM' -> [first day, first day of next month) as ISO dates; null when invalid. */
export function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`
  return { from: `${m[1]}-${m[2]}-01`, to: next }
}

/** Stored tyre lines -> the shape buildPriceIndex reads. */
export function toPriceLines(rows = []) {
  return rows.map((r) => ({
    id: r.id, country: r.country, itemCode: r.item_code, date: r.event_date,
    description: r.item_description, value: r.line_cost, qty: r.qty_n,
  }))
}

/**
 * Stored tyre expense lines for the given months of one country (the months present in
 * an uploaded file). Returns the raw lines and the same-month price index built from them.
 * Throws on a failed read so the caller can say the index is unavailable instead of
 * presenting "no price found".
 * @param {{ country:string, months:string[] }} args
 * @returns {Promise<{ lines:object[], index:Map, truncated:boolean, months:string[] }>}
 */
export async function loadPriceIndex({ country, months } = {}) {
  const valid = [...new Set((months || []).filter((m) => monthBounds(m)))].sort().slice(0, PRICE_INDEX_MAX_MONTHS)
  if (!country || !valid.length) return { lines: [], index: buildPriceIndex([]), truncated: false, months: valid }
  const lines = []
  let truncated = false
  for (const m of valid) {
    const b = monthBounds(m)
    const rows = await fetchAllOrThrow((from, to) => supabase
      .from('parts_consumption')
      .select(PRICE_LINE_COLS)
      .eq('country', country)
      .eq('cost_category', 'tyre')
      .gt('line_cost', 0)
      .gt('qty_n', 0)
      .gte('event_date', b.from)
      .lt('event_date', b.to)
      .order('event_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to), { max: PRICE_INDEX_MAX_ROWS })
    if (rows.truncated) truncated = true
    lines.push(...toPriceLines(rows))
    if (lines.length >= PRICE_INDEX_MAX_ROWS) { truncated = true; break }
  }
  return { lines, index: buildPriceIndex(lines), truncated, months: valid }
}

// ── END BLOCK: loadPriceIndex ───────────────────────────────────────────────────
