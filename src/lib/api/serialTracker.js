import { supabase, applyCountry, fetchAllPages, unwrap, toServiceError } from './_client'
import { escapeLike, sanitizeSearchTerm } from '../searchFilter'
export async function findSerialRecords(serial, { country, columns = '*' } = {}) {
  const key = String(serial || '').trim()
  if (!key) return []
  const result = await fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records').select(columns)
    .ilike('serial_no', escapeLike(key)), country).order('issue_date', { ascending: true }).order('id').range(from, to), { max: 20000 })
  if (result.truncated) throw new Error('This serial has too many records to display completely. Narrow the country selection.')
  return unwrap(result) || []
}

/* ── Serial register (the redesigned page's main table) ─────────────────────
 * One PAGE of tyre records at a time, server-side, with an exact count, so the
 * register never pulls ~10k rows into the browser. A serial is not a unique
 * tyre id (one tyre has one record per fitment), so the register is a list of
 * fitment records and says so. Every read is country scoped with the shared
 * NULL-inclusive applyCountry, exactly like the single serial search above.
 */
const REGISTER_COLS = 'id, serial_no, brand, size, description, asset_no, vehicle_type, site, position, tyre_position, status, issue_date, fitment_date, removal_date, country'

function applyRegisterFilters(q, { search, brand, size, status, site } = {}) {
  const s = sanitizeSearchTerm(search)
  if (s) q = q.or(`serial_no.ilike.%${s}%,asset_no.ilike.%${s}%`)
  if (brand) q = q.eq('brand', brand)
  if (size) q = q.eq('size', size)
  if (status) q = q.eq('status', status)
  if (site) q = q.eq('site', site)
  return q
}

/**
 * @param {{page:number, pageSize:number, search?:string, brand?:string, size?:string,
 *   status?:string, site?:string, country?:string}} opts
 * @returns {Promise<{rows:Array, total:number}>}
 */
export async function listSerialRegister({ page = 0, pageSize = 10, country, ...filters } = {}) {
  let q = supabase.from('tyre_records').select(REGISTER_COLS, { count: 'exact' })
    .order('issue_date', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  q = applyRegisterFilters(q, filters)
  const { data, error, count } = await applyCountry(q, country)
  if (error) throw toServiceError(error, 'Could not load the serial register.')
  return { rows: data || [], total: count ?? 0 }
}

async function headCount(build, country) {
  const { count, error } = await applyCountry(build(supabase.from('tyre_records').select('id', { count: 'exact', head: true })), country)
  if (error) throw toServiceError(error, 'Could not count tyre records.')
  return count ?? 0
}

/**
 * KPI tiles, all exact head-only server counts. `total` = records that carry a
 * serial; `notTracked` = records with NO serial at all (they can never be traced
 * by serial). Installed = status Active, disposed = status Scrapped. There is no
 * stock or repair status on a tyre record, so the page shows those as N/A.
 */
export async function getSerialKpis(country) {
  const [total, installed, removed, disposed, notTracked] = await Promise.all([
    headCount((q) => q.not('serial_no', 'is', null).neq('serial_no', ''), country),
    headCount((q) => q.eq('status', 'Active'), country),
    headCount((q) => q.eq('status', 'Removed'), country),
    headCount((q) => q.eq('status', 'Scrapped'), country),
    headCount((q) => q.or('serial_no.is.null,serial_no.eq.'), country),
  ])
  return { total, installed, removed, disposed, notTracked }
}

/** Distinct tyre sizes for the size filter: one narrow column, paged past the 1000-row cap. */
export async function listSizeOptions(country) {
  const res = await fetchAllPages((from, to) => applyCountry(
    supabase.from('tyre_records').select('id,size').not('size', 'is', null).order('id', { ascending: true }),
    country,
  ).range(from, to), { max: 20000 })
  if (res.error) throw toServiceError(res.error, 'Could not load tyre sizes.')
  const set = new Set()
  for (const r of res.data || []) { const v = String(r.size || '').trim(); if (v) set.add(r.size) }
  return [...set].sort((a, b) => String(a).localeCompare(String(b)))
}
