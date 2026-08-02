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

const SCO_COLS = 'id, country, region, site, period_date, cost_center, description, amount, currency, ref_no, source, notes, created_at'
const SANY_COLS = 'id, country, region, site, asset_no, invoice_no, invoice_date, period_date, description, amount, currency, status, source, notes, created_at'

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

/** Bulk insert SCO cost rows (import). Returns {inserted}. */
export async function importScoCosts(rows = []) {
  const clean = (Array.isArray(rows) ? rows : []).map(sanitizeSco).filter((r) => r.country && Number.isFinite(r.amount))
  if (!clean.length) return { inserted: 0 }
  const { data, error } = await supabase.from('sco_costs').insert(clean).select('id')
  if (error) throw error
  return { inserted: (data || []).length }
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

export async function importSanyInvoices(rows = []) {
  const clean = (Array.isArray(rows) ? rows : []).map(sanitizeSany).filter((r) => r.country && Number.isFinite(r.amount))
  if (!clean.length) return { inserted: 0 }
  const { data, error } = await supabase.from('sany_invoices').insert(clean).select('id')
  if (error) throw error
  return { inserted: (data || []).length }
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

export async function listProduction({ country, from, to, limit = 1000 } = {}) {
  try {
    let q = supabase.from('production_logs')
      .select('id, country, site, asset_no, period_date, m3, approved_m3, source, notes, created_at')
      .order('period_date', { ascending: false }).order('id')
    if (country && country !== 'All') q = q.eq('country', country)
    if (from) q = q.gte('period_date', from)
    if (to) q = q.lte('period_date', to)
    const { data, error } = await q.limit(limit)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

export async function createProduction(row) {
  const { data, error } = await supabase.from('production_logs').insert([sanitizeProd(row)])
    .select('id, country, site, asset_no, period_date, m3, approved_m3, source, notes, created_at').single()
  if (error) throw error
  return data
}

export async function importProduction(rows = []) {
  const clean = (Array.isArray(rows) ? rows : []).map(sanitizeProd).filter((r) => r.country && r.period_date)
  if (!clean.length) return { inserted: 0 }
  const { data, error } = await supabase.from('production_logs').insert(clean).select('id')
  if (error) throw error
  return { inserted: (data || []).length }
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
  set('asset_no', txt(r.asset_no))
  set('invoice_no', txt(r.invoice_no))
  set('invoice_date', r.invoice_date || undefined)
  set('period_date', r.period_date || undefined)
  set('description', txt(r.description))
  if (r.amount !== undefined) out.amount = numOrNull(r.amount) ?? 0
  else if (!isPatch) out.amount = 0
  set('currency', txt(r.currency))
  set('status', txt(r.status))
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
  set('period_date', r.period_date || undefined)
  if (r.m3 !== undefined) out.m3 = numOrNull(r.m3)
  if (r.approved_m3 !== undefined) out.approved_m3 = numOrNull(r.approved_m3)
  set('notes', txt(r.notes))
  if (!isPatch) out.source = r.source || 'manual'
  return out
}
