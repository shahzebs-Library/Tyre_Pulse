/**
 * sanyDelayPenalty - the standalone KSA repair-delay penalty ledger (V464).
 *
 * Business rule: any vehicle sent to a SANY workshop whose repair ran longer than
 * 5 days is charged a penalty of 43 SAR per hour of total repair downtime, which the
 * company then DEDUCTS from the SANY invoice. This is a SEPARATE figure - it never
 * feeds Cost per M3 (that uses the SANY invoice gross). The ledger lets a user pull
 * job-card candidates (repairs over N days), confirm the ones sent to SANY, and save
 * a penalty row (downtime hours x 43). penalty_amount is a generated column.
 *
 * Every read degrades to an empty-but-shaped value on a missing relation / RPC error
 * so a not-yet-migrated org shows an honest empty state, never a throw.
 */
import { supabase } from './_client'

export const DEFAULT_RATE_PER_HOUR = 43
export const DEFAULT_MIN_DAYS = 5

const COLS = 'id, country, region, site, asset_no, work_order_no, period_date, repair_start, repair_end, downtime_hours, rate_per_hour, penalty_amount, currency, sany_invoice_no, status, source, notes, created_at'

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Month start (YYYY-MM-01) from any date-ish value, or null. */
function monthOf(v) {
  if (!v) return null
  const s = String(v)
  const m = s.match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-01` : null
}

/**
 * List penalty rows for a country + period window.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export async function listDelayPenalties({ country, from, to } = {}) {
  try {
    let q = supabase.from('sany_delay_penalties').select(COLS).order('period_date', { ascending: false }).order('created_at', { ascending: false })
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('period_date', from)
    if (to) q = q.lte('period_date', to)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** Job-card candidates: repairs whose downtime exceeded p_min_days (RPC, DEFINER). */
export async function getDelayCandidates({ country = 'KSA', from, to, minDays = DEFAULT_MIN_DAYS } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_sany_delay_candidates', {
      p_country: country && country !== 'All' ? country : 'KSA',
      p_from: from || null,
      p_to: to || null,
      p_min_days: minDays || DEFAULT_MIN_DAYS,
    })
    if (error || !data || data.ok === false) return { ok: false, candidates: [] }
    return { ok: true, candidates: Array.isArray(data.candidates) ? data.candidates : [], rate_per_hour: data.rate_per_hour ?? DEFAULT_RATE_PER_HOUR, min_days: data.min_days ?? DEFAULT_MIN_DAYS }
  } catch {
    return { ok: false, candidates: [] }
  }
}

/** Insert one penalty row. Returns { ok, id } | { ok:false, error }. */
export async function createDelayPenalty(row) {
  try {
    const payload = sanitize(row)
    const { data, error } = await supabase.from('sany_delay_penalties').insert(payload).select('id').single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Insert many penalty rows (from confirmed candidates). Returns { inserted, failed }. */
export async function createDelayPenalties(rows = []) {
  const payload = (Array.isArray(rows) ? rows : []).map(sanitize).filter(Boolean)
  if (!payload.length) return { inserted: 0, failed: 0 }
  try {
    const { data, error } = await supabase.from('sany_delay_penalties').insert(payload).select('id')
    if (error) return { inserted: 0, failed: payload.length, error: error.message }
    return { inserted: (data || []).length, failed: payload.length - (data || []).length }
  } catch (e) {
    return { inserted: 0, failed: payload.length, error: e?.message || String(e) }
  }
}

/** Update a penalty row (status, sany_invoice_no, notes, hours, ...). */
export async function updateDelayPenalty(id, patch) {
  try {
    const { error } = await supabase.from('sany_delay_penalties').update(sanitize(patch)).eq('id', id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Delete a penalty row. */
export async function deleteDelayPenalty(id) {
  try {
    const { error } = await supabase.from('sany_delay_penalties').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Build a penalty row from a job-card candidate (downtime hours x 43). */
export function penaltyFromCandidate(c, { rate = DEFAULT_RATE_PER_HOUR, country = 'KSA' } = {}) {
  const hours = num(c?.downtime_hours) ?? 0
  return {
    country,
    site: c?.site ?? null,
    asset_no: c?.asset_no ?? null,
    work_order_no: c?.work_order_no ?? null,
    repair_start: c?.production_out_at ?? null,
    repair_end: c?.production_in_at ?? null,
    downtime_hours: hours,
    rate_per_hour: rate,
    period_date: monthOf(c?.production_out_at) || monthOf(c?.production_in_at),
    currency: 'SAR',
    status: 'draft',
    source: 'job_card',
  }
}

/** Totals for the KPI strip. Pure. */
export function summarizeDelayPenalties(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((s, r) => s + (num(r.penalty_amount) ?? 0), 0)
  const hours = list.reduce((s, r) => s + (num(r.downtime_hours) ?? 0), 0)
  const byStatus = { draft: 0, deducted: 0, waived: 0 }
  for (const r of list) {
    const st = r.status && byStatus[r.status] != null ? r.status : 'draft'
    byStatus[st] += num(r.penalty_amount) ?? 0
  }
  const toDeduct = list.filter((r) => r.status !== 'waived').reduce((s, r) => s + (num(r.penalty_amount) ?? 0), 0)
  return { total, hours, count: list.length, byStatus, toDeduct }
}

const WRITABLE = new Set([
  'country', 'region', 'site', 'asset_no', 'work_order_no', 'period_date',
  'repair_start', 'repair_end', 'downtime_hours', 'rate_per_hour', 'currency',
  'sany_invoice_no', 'status', 'source', 'notes',
])

/** Keep only writable columns; coerce numerics; drop the generated penalty_amount. */
function sanitize(row) {
  if (!row || typeof row !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (!WRITABLE.has(k)) continue
    if (k === 'downtime_hours' || k === 'rate_per_hour') out[k] = num(v)
    else out[k] = v === '' ? null : v
  }
  if (out.rate_per_hour == null && 'rate_per_hour' in out) out.rate_per_hour = DEFAULT_RATE_PER_HOUR
  return out
}
