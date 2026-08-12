/**
 * assetDisposals - service layer for the Asset Disposal register.
 *
 * The disposal committee proposes machines to scrap or sell. That proposal is a
 * CLAIM, not a fact: an asset stays in `vehicle_fleet` (usually still Active),
 * still carries job cards and spend, and may still have tyres fitted. So the
 * register is read through `get_asset_disposal_register`, which joins that
 * evidence LIVE rather than freezing a copy of it - a stored snapshot would go
 * stale the moment somebody actually retires a machine, and the whole point of
 * the screen is to show the gap between what was proposed and what was done.
 *
 * Every read degrades to an honest, correctly-shaped empty envelope when the
 * table/RPC is not provisioned, so an org that has not run the migration sees
 * an empty state rather than a thrown page.
 */
import { supabase, isMissingRelation } from './_client'

/**
 * Columns written back by the editor. Deliberately excludes organisation_id
 * (defaulted server-side - sending it lets a client aim a row at another
 * tenant), the joined evidence (never stored) and the audit stamps.
 */
export const DISPOSAL_EDITABLE_COLS = [
  'country', 'asset_no', 'sr_no', 'register_status', 'region', 'asset_type',
  'model_year', 'brand', 'condition', 'disposition', 'site', 'remarks',
  'meter_text', 'meter_km', 'meter_hours', 'expense_note', 'major_repair_done',
  'description', 'job_cards_note', 'estimated_value', 'sale_proceeds',
  'currency', 'source_file', 'source_row',
]

/** An empty envelope with the same shape a successful read returns. */
function emptyRegister(country, reason) {
  return { ok: false, reason: reason || 'unavailable', country: country || null, rows: [], totals: null }
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const text = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

/**
 * Keep only the columns the table owns, so a row that arrived from a spreadsheet
 * (or from a row already carrying its joined evidence) cannot be posted back
 * with fields PostgREST will reject.
 */
function sanitize(row = {}) {
  const out = {}
  for (const key of DISPOSAL_EDITABLE_COLS) {
    if (!(key in row)) continue
    const v = row[key]
    if (key === 'model_year' || key === 'meter_km' || key === 'meter_hours'
      || key === 'estimated_value' || key === 'sale_proceeds' || key === 'source_row') {
      out[key] = num(v)
    } else if (key === 'major_repair_done') {
      out[key] = v === true || v === 'true' || v === 'yes' || v === 'Yes' ? true
        : v === false || v === 'false' || v === 'no' || v === 'No' ? false : null
    } else if (key === 'asset_no') {
      // Asset codes are canonical upper with no whitespace (V337/V490); the DB
      // normalises too, but a clean key here keeps the preview count honest.
      out[key] = (text(v) || '').toUpperCase().replace(/\s+/g, '') || null
    } else {
      // `site` is written RAW: a trigger canonicalises it, and pre-normalising
      // here would compete with the alias table (V395) rather than defer to it.
      out[key] = text(v)
    }
  }
  return out
}

/**
 * The committee register plus its live fleet / job card / tyre evidence.
 *
 * @param {object} [opts]
 * @param {string} [opts.country] one country, or 'All' / omitted for the caller's scope
 * @returns {Promise<{ok:boolean, country:?string, rows:Array, totals:?object, reason?:string}>}
 */
export async function getDisposalRegister({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_asset_disposal_register', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error) return emptyRegister(country, isMissingRelation(error) ? 'not_provisioned' : 'unavailable')
    if (!data || data.ok === false) return emptyRegister(country, data?.reason || 'unavailable')
    return {
      ok: true,
      country: data.country ?? (country || null),
      rows: Array.isArray(data.rows) ? data.rows : [],
      totals: data.totals || null,
    }
  } catch {
    return emptyRegister(country, 'unavailable')
  }
}

/** Add or refresh one row on the natural key (org + country + asset). */
export async function upsertDisposal(row) {
  const payload = sanitize(row)
  const { data, error } = await supabase
    .from('asset_disposals')
    .upsert([payload], { onConflict: 'organisation_id,country,asset_no' })
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** Patch an existing row by id. Only the fields present are sent. */
export async function updateDisposal(id, patch) {
  const payload = sanitize(patch)
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('asset_disposals')
    .update(payload)
    .eq('id', id)
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function deleteDisposal(id) {
  const { error } = await supabase.from('asset_disposals').delete().eq('id', id)
  if (error) throw error
  return true
}

/**
 * Record a committee decision.
 *
 * `decided_at` and `decided_by` are stamped HERE because there is no trigger for
 * them: an approval with no time and no name is not an audit trail. `updated_at`
 * is left to the database, which owns it. The actor id is best effort - if the
 * session cannot be read the decision still records rather than being lost, and
 * the row simply carries no name.
 *
 * @param {string} id
 * @param {{status:string, decision_note?:string, disposal_ref?:string, disposed_at?:string}} decision
 */
export async function setDisposalDecision(id, { status, decision_note, disposal_ref, disposed_at } = {}) {
  const patch = {
    status,
    decision_note: text(decision_note),
    decided_at: new Date().toISOString(),
  }
  try {
    const { data: auth } = await supabase.auth.getUser()
    if (auth?.user?.id) patch.decided_by = auth.user.id
  } catch { /* unreadable session: record the decision without the actor */ }

  if (status === 'disposed') {
    patch.disposal_ref = text(disposal_ref)
    // A machine marked disposed is disposed on a real day; default to today
    // rather than leaving the date blank on a terminal state.
    patch.disposed_at = disposed_at || new Date().toISOString().slice(0, 10)
  }

  const { data, error } = await supabase
    .from('asset_disposals')
    .update(patch)
    .eq('id', id)
    .select('id')
    .single()
  if (error) throw error
  return data
}

/**
 * Bulk add/refresh from a re-uploaded committee sheet.
 *
 * Chunked with a small worker pool, mirroring the ledger import path in
 * `costPerM3.js`: a bad chunk is captured and reported, never allowed to abort
 * the rest of the upload. Upsert on the natural key means a re-upload REFRESHES
 * the same asset instead of duplicating it - the standing rule that produced
 * the duplicate-expense incident.
 *
 * @returns {Promise<{written:number, failed:number, errors:string[]}>}
 */
export async function importDisposalRows(rows, onProgress) {
  const clean = (Array.isArray(rows) ? rows : []).map(sanitize).filter((r) => r.asset_no && r.country)
  const CHUNK = 200
  const POOL = 4
  const batches = []
  for (let i = 0; i < clean.length; i += CHUNK) batches.push(clean.slice(i, i + CHUNK))

  let written = 0
  let failed = 0
  let done = 0
  const errors = []
  let cursor = 0

  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++]
      try {
        const { data, error } = await supabase
          .from('asset_disposals')
          .upsert(batch, { onConflict: 'organisation_id,country,asset_no' })
          .select('id')
        if (error) {
          failed += batch.length
          if (errors.length < 5) errors.push(error.message || String(error))
        } else {
          written += (data || []).length
        }
      } catch (e) {
        failed += batch.length
        if (errors.length < 5) errors.push(e?.message || String(e))
      }
      done += batch.length
      if (onProgress) onProgress({ done, total: clean.length, written, failed })
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(POOL, batches.length)) }, worker))
  return { written, failed, errors, skipped: (Array.isArray(rows) ? rows.length : 0) - clean.length }
}

/**
 * Header synonyms for a committee sheet. Kept local because these headings are
 * this document's own vocabulary; the ERP ledger synonyms in costPerM3.js
 * describe a different family of files and folding the two together would make
 * each one answer for the other's columns.
 */
const DISPOSAL_HEADERS = {
  asset_no: ['asset', 'asset no', 'asset_no', 'asset code', 'equipment', 'equipment no', 'machine', 'machine no'],
  sr_no: ['sr', 'sr no', 'sr.no', 's no', 'serial', 'sl no', '#'],
  register_status: ['register status', 'fleet status', 'status in register'],
  region: ['region', 'area'],
  asset_type: ['asset type', 'type', 'category', 'equipment type'],
  model_year: ['model', 'model year', 'year'],
  brand: ['brand', 'make', 'manufacturer'],
  condition: ['condition', 'physical condition'],
  disposition: ['disposition', 'decision', 'proposal', 'scrap or sell', 'recommendation'],
  site: ['site', 'location', 'yard'],
  remarks: ['remarks', 'remark', 'comment', 'comments', 'notes'],
  meter_text: ['meter', 'meter reading', 'odometer', 'km / hours', 'reading'],
  expense_note: ['expense', 'expense note', 'expenses'],
  description: ['description', 'desc', 'details'],
  job_cards_note: ['job cards', 'job card', 'job card note'],
  estimated_value: ['estimated value', 'estimate', 'valuation', 'expected value'],
  sale_proceeds: ['sale proceeds', 'proceeds', 'sale value', 'sold for'],
  currency: ['currency'],
}

// Excel emits a non-breaking space that looks identical to a space; it is
// folded before matching because that exact character has silently broken
// header matching on real exports before.
const normHeader = (h) => String(h || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Map parsed spreadsheet rows onto disposal columns. Pure, so the upload preview
 * can show exactly what will be written before anything is sent.
 *
 * @param {Array<object>} rows rows from parseWorkbook (header-keyed objects)
 * @param {object} [opts] { country, sourceFile }
 */
export function mapDisposalSheetRows(rows, { country, sourceFile } = {}) {
  const out = []
  for (const [i, raw] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!raw || typeof raw !== 'object') continue
    const mapped = {}
    for (const [key, val] of Object.entries(raw)) {
      const nk = normHeader(key)
      for (const [field, syns] of Object.entries(DISPOSAL_HEADERS)) {
        if (syns.includes(nk)) { mapped[field] = val; break }
      }
    }
    if (!mapped.asset_no) continue
    mapped.country = country || null
    mapped.source_file = sourceFile || null
    mapped.source_row = i + 1
    // The sheet writes free text; fold the two words the register understands
    // and leave anything else for a human rather than guessing a disposition.
    const d = normHeader(mapped.disposition)
    mapped.disposition = d.includes('scrap') ? 'scrap' : d.includes('sell') || d.includes('sale') ? 'sell' : 'undecided'
    out.push(sanitize(mapped))
  }
  return out
}
