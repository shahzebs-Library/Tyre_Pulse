/**
 * costPerM3 - service layer for the Cost per M3 module.
 *
 * Cost per cubic metre = (Internal ERP expenses + SCO cost + SANY workshop
 * invoices) / approved production M3, per region, per country in its own
 * currency (never blended). Internal cost reuses parts_consumption (ERP intake);
 * SCO and SANY are their own ledgers; production is the approved-M3 series.
 *
 * Every read degrades to an empty-but-shaped value on a missing relation / RPC
 * error so a not-yet-migrated org shows an honest empty state, never a throw.
 */
import { supabase } from './_client'

/**
 * Insert many rows fast and reliably: batches of CHUNK, a small concurrency pool,
 * per-batch error capture (a bad batch never aborts the whole upload). Handles the
 * 65k-rows-per-month production files. Returns { inserted, failed, errors } and
 * reports progress. A batch that errors is NOT retried row-by-row here (kept simple);
 * its rows count as failed and the first few messages are surfaced.
 */
async function chunkedInsert(table, rows, onProgress) {
  const CHUNK = 500
  const POOL = 5
  const batches = []
  for (let i = 0; i < rows.length; i += CHUNK) batches.push(rows.slice(i, i + CHUNK))
  let inserted = 0
  let failed = 0
  let done = 0
  const errors = []
  let cursor = 0
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++]
      try {
        const { data, error } = await supabase.from(table).insert(batch).select('id')
        if (error) {
          failed += batch.length
          if (errors.length < 5) errors.push(error.message || String(error))
        } else {
          inserted += (data || []).length
        }
      } catch (e) {
        failed += batch.length
        if (errors.length < 5) errors.push(e?.message || String(e))
      }
      done += batch.length
      if (onProgress) onProgress({ done, total: rows.length, inserted, failed })
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, batches.length) }, worker))
  return { inserted, failed, errors }
}

const SCO_COLS = 'id, country, region, site, period_date, cost_center, description, amount, currency, ref_no, source, notes, created_at'
const SANY_COLS = 'id, country, region, site, asset_code, asset_no, invoice_no, invoice_date, period_date, description, amount, currency, status, doc_type, gross_amount, net_amount, fx_rate, deductions, fleet_remarks, maintenance_remarks, source, notes, created_at'

/** Empty, correctly-shaped Cost/M3 result. */
function emptyCostPerM3() {
  return { ok: false, country: null, currency: null, from: null, to: null, regions: [], total: null }
}

/**
 * Cost per M3 for a country + period. Returns { ok, currency, regions[], total }.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export async function getCostPerM3({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_cost_per_m3', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error || !data || data.ok === false) return { ...emptyCostPerM3(), ...(data || {}) }
    return {
      ok: true,
      country: data.country ?? country ?? null,
      currency: data.currency ?? country ?? '',
      from: data.from ?? from ?? null,
      to: data.to ?? to ?? null,
      regions: Array.isArray(data.regions) ? data.regions : [],
      total: data.total ?? null,
    }
  } catch {
    return emptyCostPerM3()
  }
}

/**
 * Monthly Cost/M3 trend (date-wise) for a country. Returns { ok, currency,
 * months:[{month, internal_cost, tyre_cost, sco_cost, sany_cost, production_m3,
 * grand_total, cost_per_m3}] }. Default = last 12 months. Degrades to empty.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export async function getCostPerM3Trend({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_cost_per_m3_trend', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error || !data || data.ok === false) {
      return { ok: false, currency: country || '', months: [] }
    }
    return {
      ok: true,
      currency: data.currency ?? country ?? '',
      months: Array.isArray(data.months) ? data.months : [],
    }
  } catch {
    return { ok: false, currency: country || '', months: [] }
  }
}

// ---- SCO cost ledger -------------------------------------------------------

/** List SCO cost rows for a country + period (period_date within [from,to]). */
export async function listScoCosts({ country, from, to, limit = 500 } = {}) {
  try {
    let q = supabase.from('sco_costs').select(SCO_COLS).order('period_date', { ascending: false }).order('id')
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('period_date', from)
    if (to) q = q.lte('period_date', to)
    const { data, error } = await q.limit(limit)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/** Insert one SCO cost row (organisation/currency/created_by defaulted server-side). */
export async function createScoCost(row) {
  const { data, error } = await supabase.from('sco_costs').insert([sanitizeSco(row)]).select(SCO_COLS).single()
  if (error) throw error
  return data
}

/** Bulk insert SCO cost rows (import). Chunked/fast. Returns {read,inserted,skipped,failed,errors}. */
export async function importScoCosts(rows = [], onProgress) {
  const read = Array.isArray(rows) ? rows.length : 0
  const clean = (Array.isArray(rows) ? rows : []).map((r) => sanitizeSco(r)).filter((r) => r.country && Number.isFinite(r.amount))
  const skipped = read - clean.length
  if (!clean.length) return { read, inserted: 0, skipped, failed: 0, errors: [] }
  const res = await chunkedInsert('sco_costs', clean, onProgress)
  return { read, skipped, ...res }
}

export async function updateScoCost(id, patch) {
  const { data, error } = await supabase.from('sco_costs').update(sanitizeSco(patch, true)).eq('id', id).select(SCO_COLS).single()
  if (error) throw error
  return data
}

export async function deleteScoCost(id) {
  const { error } = await supabase.from('sco_costs').delete().eq('id', id)
  if (error) throw error
}

// ---- SANY workshop invoices ------------------------------------------------

export async function listSanyInvoices({ country, from, to, limit = 500 } = {}) {
  try {
    let q = supabase.from('sany_invoices').select(SANY_COLS).order('period_date', { ascending: false }).order('id')
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('period_date', from)
    if (to) q = q.lte('period_date', to)
    const { data, error } = await q.limit(limit)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function createSanyInvoice(row) {
  const { data, error } = await supabase.from('sany_invoices').insert([sanitizeSany(row)]).select(SANY_COLS).single()
  if (error) throw error
  return data
}

export async function importSanyInvoices(rows = [], onProgress) {
  const read = Array.isArray(rows) ? rows.length : 0
  const clean = (Array.isArray(rows) ? rows : []).map((r) => sanitizeSany(r)).filter((r) => r.country && Number.isFinite(r.amount))
  const skipped = read - clean.length
  if (!clean.length) return { read, inserted: 0, skipped, failed: 0, errors: [] }
  const res = await chunkedInsert('sany_invoices', clean, onProgress)
  return { read, skipped, ...res }
}

export async function updateSanyInvoice(id, patch) {
  const { data, error } = await supabase.from('sany_invoices').update(sanitizeSany(patch, true)).eq('id', id).select(SANY_COLS).single()
  if (error) throw error
  return data
}

export async function deleteSanyInvoice(id) {
  const { error } = await supabase.from('sany_invoices').delete().eq('id', id)
  if (error) throw error
}

// ---- Production (approved M3) ----------------------------------------------

const PROD_COLS = 'id, country, site, asset_no, pump_no, period_date, m3, approved_m3, supplied_m3, rejected, reason, remarks, dn_number, order_number, mix_code, mix_description, customer_name, project_name, source, notes, created_at'

export async function listProduction({ country, from, to, limit = 1000 } = {}) {
  try {
    let q = supabase.from('production_logs')
      .select(PROD_COLS)
      .order('period_date', { ascending: false }).order('id')
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('period_date', from)
    if (to) q = q.lte('period_date', to)
    const { data, error } = await q.limit(limit)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/**
 * Monthly production summary (V482 get_production_monthly): one row per month
 * with loads, supplied/approved/not-approved m3, rejected loads + m3, and the
 * rejection reasons carrying sample remarks. Server-aggregated (the table holds
 * hundreds of thousands of load rows). Newest month first. Degrades to [].
 * @param {{ country?: string, from?: string, to?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function getProductionMonthly({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_production_monthly', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null, p_to: to || null,
    })
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/**
 * Production rejections (concrete sent but not approved) by site + reason for a
 * country + period. Returns { ok, total:{supplied_m3, approved_m3, not_approved_m3,
 * rejected_loads}, by_site[], by_reason[] }. Degrades to an empty shape.
 */
export async function getProductionRejections({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_production_rejections', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null, p_to: to || null,
    })
    if (error || !data || data.ok === false) {
      return { ok: false, total: null, by_site: [], by_reason: [] }
    }
    return {
      ok: true,
      total: data.total ?? null,
      by_site: Array.isArray(data.by_site) ? data.by_site : [],
      by_reason: Array.isArray(data.by_reason) ? data.by_reason : [],
    }
  } catch {
    return { ok: false, total: null, by_site: [], by_reason: [] }
  }
}

export async function createProduction(row) {
  const { data, error } = await supabase.from('production_logs').insert([sanitizeProd(row)])
    .select(PROD_COLS).single()
  if (error) throw error
  return data
}

export async function importProduction(rows = [], onProgress) {
  const read = Array.isArray(rows) ? rows.length : 0
  const clean = (Array.isArray(rows) ? rows : []).map((r) => sanitizeProd(r)).filter((r) => r.country && r.period_date)
  const skipped = read - clean.length
  if (!clean.length) return { read, inserted: 0, skipped, failed: 0, errors: [] }
  const res = await chunkedInsert('production_logs', clean, onProgress)
  return { read, skipped, ...res }
}

export async function updateProduction(id, patch) {
  const { data, error } = await supabase.from('production_logs').update(sanitizeProd(patch, true)).eq('id', id)
    .select('id, country, site, asset_no, period_date, m3, approved_m3, source, notes, created_at').single()
  if (error) throw error
  return data
}

export async function deleteProduction(id) {
  const { error } = await supabase.from('production_logs').delete().eq('id', id)
  if (error) throw error
}

// ---- Sites (region map) ----------------------------------------------------

const SITE_COLS = 'id, country, name, site_code, region, city, site_type, active, notes, created_at'

export async function listSites({ country, limit = 2000 } = {}) {
  try {
    let q = supabase.from('sites').select(SITE_COLS).order('country').order('name')
    if (country && country !== 'All') q = q.eq('country', country)
    const { data, error } = await q.limit(limit)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function createSite(row) {
  const { data, error } = await supabase.from('sites').insert([sanitizeSite(row)]).select(SITE_COLS).single()
  if (error) throw error
  return data
}

export async function updateSite(id, patch) {
  const { data, error } = await supabase.from('sites').update(sanitizeSite(patch, true)).eq('id', id).select(SITE_COLS).single()
  if (error) throw error
  return data
}

export async function deleteSite(id) {
  const { error } = await supabase.from('sites').delete().eq('id', id)
  if (error) throw error
}

/**
 * Import sites: INSERT new sites, UPDATE region/fields on existing ones (matched by
 * country + name, case-insensitive - the sites unique key). Small dataset, so the
 * existing set is fetched once and diffed in JS. Returns {read,inserted,updated,skipped,failed,errors}.
 */
export async function importSites(rows = []) {
  const read = Array.isArray(rows) ? rows.length : 0
  const clean = (Array.isArray(rows) ? rows : []).map((r) => sanitizeSite(r)).filter((r) => r.country && r.name)
  const skipped = read - clean.length
  if (!clean.length) return { read, inserted: 0, updated: 0, skipped, failed: 0, errors: [] }
  const key = (c, n) => `${String(c).trim().toLowerCase()}|${String(n).trim().toLowerCase()}`
  const existing = {}
  for (const s of await listSites({})) existing[key(s.country, s.name)] = s.id
  let inserted = 0; let updated = 0; let failed = 0
  const errors = []
  const toInsert = []
  for (const r of clean) {
    const id = existing[key(r.country, r.name)]
    if (id) {
      try {
        const patch = { region: r.region, city: r.city, site_code: r.site_code, site_type: r.site_type, active: r.active, notes: r.notes }
        const { error } = await supabase.from('sites').update(patch).eq('id', id)
        if (error) { failed += 1; if (errors.length < 5) errors.push(error.message) } else updated += 1
      } catch (e) { failed += 1; if (errors.length < 5) errors.push(e?.message || String(e)) }
    } else {
      toInsert.push(r)
    }
  }
  if (toInsert.length) {
    const res = await chunkedInsert('sites', toInsert)
    inserted += res.inserted; failed += res.failed; errors.push(...res.errors.slice(0, Math.max(0, 5 - errors.length)))
  }
  return { read, inserted, updated, skipped, failed, errors }
}

function sanitizeSite(r = {}, isPatch = false) {
  const out = {}
  const set = (k, v) => { if (!isPatch || v !== undefined) out[k] = v }
  set('country', txt(r.country))
  set('name', txt(r.name))
  set('site_code', txt(r.site_code))
  set('region', txt(r.region))
  set('city', txt(r.city))
  set('site_type', txt(r.site_type))
  if (r.active !== undefined) out.active = !/^(no|false|0|n)$/i.test(String(r.active ?? '').trim())
  else if (!isPatch) out.active = true
  set('notes', txt(r.notes))
  return out
}

// ---- Import-history logging (so the console sees these uploads) -------------

/**
 * Best-effort log of a Cost/M3 or Sites upload into the console Import History
 * (import_files + import_batches), so failures are visible centrally like ERP
 * imports. Never throws.
 * @param {{filename:string, sizeBytes?:number, module:string, country?:string, result:object, at:string}} p
 */
export async function logIntakeToHistory({ filename, sizeBytes, module, country, result = {}, at }) {
  try {
    const failed = Number(result.failed) > 0
    const { data: f } = await supabase.from('import_files').insert({
      original_filename: filename || `${module}.xlsx`,
      size_bytes: sizeBytes || null,
      country: country || null,
      source_system: 'cost_m3',
      validation_status: failed ? 'error' : 'ok',
    }).select('id').single()
    await supabase.from('import_batches').insert({
      country: country || null,
      module,
      file_id: f?.id || null,
      source_system: 'cost_m3',
      total_rows: Number(result.read) || 0,
      imported_rows: (Number(result.inserted) || 0) + (Number(result.updated) || 0),
      skipped_rows: Number(result.skipped) || 0,
      error_rows: Number(result.failed) || 0,
      import_status: failed ? 'failed' : 'committed',
      completed_at: at || null,
    })
  } catch { /* logging is best-effort */ }
}

// ---- sanitizers (whitelist; coerce amounts; never send generated cols) ------

const numOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const txt = (v) => (v == null ? null : String(v).trim() || null)

function sanitizeSco(r = {}, isPatch = false) {
  const out = {}
  const set = (k, v) => { if (!isPatch || v !== undefined) out[k] = v }
  set('country', txt(r.country))
  set('region', txt(r.region))
  set('site', txt(r.site))
  set('period_date', r.period_date || undefined)
  set('cost_center', txt(r.cost_center))
  set('description', txt(r.description))
  if (r.amount !== undefined) out.amount = numOrNull(r.amount) ?? 0
  else if (!isPatch) out.amount = 0
  set('currency', txt(r.currency))
  set('ref_no', txt(r.ref_no))
  set('notes', txt(r.notes))
  if (!isPatch) out.source = r.source || 'manual'
  return out
}

function sanitizeSany(r = {}, isPatch = false) {
  const out = {}
  const set = (k, v) => { if (!isPatch || v !== undefined) out[k] = v }
  set('country', txt(r.country))
  set('region', txt(r.region))
  set('site', txt(r.site))
  set('asset_code', txt(r.asset_code))
  set('asset_no', txt(r.asset_no))
  set('invoice_no', txt(r.invoice_no))
  set('invoice_date', r.invoice_date || undefined)
  set('period_date', r.period_date || undefined)
  set('description', txt(r.description))
  if (r.amount !== undefined) out.amount = numOrNull(r.amount) ?? 0
  else if (!isPatch) out.amount = 0
  set('currency', txt(r.currency))
  set('status', txt(r.status))
  set('doc_type', r.doc_type === 'detail' ? 'detail' : (r.doc_type === 'summary' ? 'summary' : undefined))
  set('fleet_remarks', txt(r.fleet_remarks))
  set('maintenance_remarks', txt(r.maintenance_remarks))
  set('notes', txt(r.notes))
  if (!isPatch) out.source = r.source || 'manual'
  return out
}

function sanitizeProd(r = {}, isPatch = false) {
  const out = {}
  const set = (k, v) => { if (!isPatch || v !== undefined) out[k] = v }
  set('country', txt(r.country))
  set('site', txt(r.site))
  set('asset_no', txt(r.asset_no))
  set('pump_no', txt(r.pump_no))
  set('period_date', r.period_date || undefined)
  if (r.m3 !== undefined) out.m3 = numOrNull(r.m3)
  if (r.approved_m3 !== undefined) out.approved_m3 = numOrNull(r.approved_m3)
  if (r.supplied_m3 !== undefined) out.supplied_m3 = numOrNull(r.supplied_m3)
  if (r.rejected !== undefined) out.rejected = r.rejected === true || r.rejected === 'true'
  set('reason', txt(r.reason))
  set('remarks', txt(r.remarks))
  set('dn_number', txt(r.dn_number))
  set('order_number', txt(r.order_number))
  set('mix_code', txt(r.mix_code))
  set('mix_description', txt(r.mix_description))
  set('customer_name', txt(r.customer_name))
  set('project_name', txt(r.project_name))
  set('notes', txt(r.notes))
  if (!isPatch) out.source = r.source || 'manual'
  return out
}
