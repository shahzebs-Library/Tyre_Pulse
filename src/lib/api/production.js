/**
 * production - the single seam between the unit-aware Cost Intelligence surface
 * (CostCenter "Cost per unit" section) and Supabase (table `production_logs`,
 * V276). Production is the running output in cubic metres (m3) for volume assets
 * (concrete pumps, water treatment, etc), recorded LOCATION-WISE (per site,
 * optionally per asset) so a cost-per-m3 metric can be computed for a date range.
 *
 * Keeps an explicit least-privilege column list and null-safe country scoping,
 * mirroring washRecords.js / odometerLogs.js. RLS enforces org isolation +
 * country + site scope; this layer never trusts client input blindly.
 *
 * Before the migration is applied every read degrades to [] / 0 so the page can
 * surface an "apply MIGRATIONS_V276_PRODUCTION_LOGS.sql" hint instead of throwing.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

export const COLS =
  'id,organisation_id,country,site,asset_no,period_date,m3,source,notes,' +
  'created_by,created_at,updated_at'

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const m = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    m.includes('relation')
  )
}

/** Coerce a value to a finite number or null (empty string / null / NaN -> null). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Trim + slice a text value, or null when empty. */
function textOrNull(v, max = 200) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** Normalise a date-ish value to YYYY-MM-DD (or null). */
function asDate(v) {
  if (!v) return null
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * List production rows (newest period first). All filters optional. Country
 * scoped (null-safe). Returns [] when the table is missing so the UI can prompt
 * for the migration rather than erroring.
 * @param {{ country?:string, site?:string, from?:string, to?:string, limit?:number }} [opts]
 */
export async function listProduction({ country, site, from, to, limit = 20000 } = {}) {
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from('production_logs').select(COLS)
    q = applyCountry(q, country)
    if (site && site !== 'All') q = q.eq('site', site)
    if (from) q = q.gte('period_date', asDate(from))
    if (to) q = q.lte('period_date', asDate(to))
    return q
      .order('period_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: limit })
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Whitelist + coerce a create/update payload against the production_logs schema. */
function buildPayload(values = {}) {
  return {
    site: textOrNull(values.site, 120),
    asset_no: textOrNull(values.asset_no, 120),
    period_date: asDate(values.period_date),
    m3: numOrNull(values.m3),
    source: textOrNull(values.source, 120),
    notes: textOrNull(values.notes, 4000),
    country: values.country ?? null,
  }
}

/** Create a production row. `site`, `period_date` and a numeric `m3` are required. */
export async function createProduction(values = {}) {
  const payload = buildPayload(values)
  if (!payload.site) throw new Error('A site is required.')
  if (!payload.period_date) throw new Error('A period date is required.')
  if (payload.m3 == null) throw new Error('A numeric production value (m3) is required.')
  if (payload.m3 < 0) throw new Error('Production (m3) cannot be negative.')
  return unwrap(await supabase.from('production_logs').insert(payload).select(COLS).single())
}

/**
 * Create many production rows in chunks.
 *
 * The import used to call createProduction once PER ROW, so a 10,000 row m3
 * file was 10,000 sequential round trips - roughly 27 minutes on a normal
 * connection, and far worse on a weak one. Chunking sends the same rows in 40
 * requests instead.
 *
 * Validation stays per row and is done BEFORE any insert, so one bad row is
 * reported by its own line number rather than failing a whole chunk. The insert
 * deliberately omits .select(): asking the server to echo 250 rows back doubles
 * the payload for data the caller does not read.
 *
 * @param {Array<object>} rows
 * @param {{ chunk?:number, onProgress?:(done:number,total:number)=>void }} [opts]
 * @returns {Promise<{ saved:number, failures:string[] }>}
 */
export async function createProductionBulk(rows = [], { chunk = 250, onProgress } = {}) {
  const valid = []
  const failures = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const payload = buildPayload(r)
    const label = r?.source_row != null ? `Row ${r.source_row}` : `Site ${payload.site || '?'}`
    if (!payload.site) { failures.push(`${label}: a site is required.`); continue }
    if (!payload.period_date) { failures.push(`${label}: a period date is required.`); continue }
    if (payload.m3 == null) { failures.push(`${label}: a numeric production value (m3) is required.`); continue }
    if (payload.m3 < 0) { failures.push(`${label}: production (m3) cannot be negative.`); continue }
    valid.push(payload)
  }

  let saved = 0
  for (let i = 0; i < valid.length; i += chunk) {
    const slice = valid.slice(i, i + chunk)
    const { error } = await supabase.from('production_logs').insert(slice)
    if (error) {
      // Report the range rather than pretending a single row failed - the
      // server rejected the batch and does not say which member caused it.
      const first = i + 1
      const last = i + slice.length
      failures.push(`Rows ${first} to ${last}: ${error.message || 'save failed'}`)
    } else {
      saved += slice.length
    }
    onProgress?.(Math.min(i + slice.length, valid.length), valid.length)
  }
  return { saved, failures }
}

/** Patch a production row. Only keys present in the patch are sent. */
export async function updateProduction(id, patch = {}) {
  if (!id) throw new Error('A record id is required.')
  const clean = buildPayload(patch)
  const out = {}
  for (const k of Object.keys(clean)) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = clean[k]
  }
  if (Object.prototype.hasOwnProperty.call(out, 'm3')) {
    if (out.m3 == null) throw new Error('A numeric production value (m3) is required.')
    if (out.m3 < 0) throw new Error('Production (m3) cannot be negative.')
  }
  if (Object.prototype.hasOwnProperty.call(out, 'site') && !out.site) {
    throw new Error('A site is required.')
  }
  if (!('country' in patch)) delete out.country
  return unwrap(await supabase.from('production_logs').update(out).eq('id', id).select(COLS).single())
}

/** Delete a production row by id. */
export async function deleteProduction(id) {
  if (!id) throw new Error('A record id is required.')
  return unwrap(await supabase.from('production_logs').delete().eq('id', id))
}

/**
 * Sum production (m3) in a range for the given filters. Returns 0 when the table
 * is missing or no rows match (honest zero - the caller shows "N/A - no m3
 * recorded" when the total is 0, never a fabricated per-unit number).
 * @param {{ country?:string, site?:string, from?:string, to?:string }} [opts]
 * @returns {Promise<number>}
 */
export async function sumProductionM3({ country, site, from, to } = {}) {
  const rows = await listProduction({ country, site, from, to })
  let total = 0
  for (const r of rows) {
    const n = Number(r?.m3)
    if (Number.isFinite(n)) total += n
  }
  return total
}
