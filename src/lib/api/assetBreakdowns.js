/**
 * assetBreakdowns - service layer for the breakdown register.
 *
 * A breakdown row is a live operational record, not a snapshot: it is opened
 * when a machine goes down and closed when somebody records that it came back.
 * Nothing here freezes the fleet's state onto the row - the asset's site, type
 * and current operational status stay in `vehicle_fleet`, so a machine that
 * moves site does not leave a breakdown pointing at the old one.
 *
 * Every read degrades to a correctly-shaped empty result when the table is not
 * provisioned, so an org that has not run the migration sees an empty state
 * rather than a thrown page.
 */
import { supabase, isMissingRelation, applyCountry, fetchAllPages } from './_client'

const COLS = 'id,country,asset_no,site,reported_on,details,breakdown_days,expected_return,'
  + 'returned_to_service,returned_on,repair_location,remark,source_file,created_at,updated_at'

/** Columns a client may write. organisation_id is server-defaulted on purpose. */
export const BREAKDOWN_EDITABLE_COLS = [
  'country', 'asset_no', 'site', 'reported_on', 'details', 'breakdown_days',
  'expected_return', 'returned_to_service', 'returned_on', 'repair_location',
  'remark', 'source_file',
]

const text = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function sanitize(row = {}) {
  const out = {}
  for (const key of BREAKDOWN_EDITABLE_COLS) {
    if (!(key in row)) continue
    const v = row[key]
    if (key === 'breakdown_days') out[key] = num(v)
    else if (key === 'returned_to_service') out[key] = v === true || v === 'true' || v === 'yes'
    else if (key === 'asset_no') out[key] = (text(v) || '').toUpperCase().replace(/\s+/g, '') || null
    else if (key === 'repair_location') {
      // The column allows only the sheet's own two tokens; anything else is
      // stored as "not recorded" rather than rejected at the database, so a
      // typo in a form never loses the rest of the record.
      const s = String(v || '').trim().toLowerCase()
      out[key] = s === 'in' ? 'In' : s === 'out' ? 'Out' : null
    } else out[key] = text(v)
  }
  return out
}

/**
 * Every breakdown for a country. Paged rather than capped: the register is
 * small today but a row-capped read of a register silently understates how many
 * machines are down, which is the one number this screen exists to state.
 */
export async function listAssetBreakdowns({ country, max = 20000 } = {}) {
  try {
    const build = () => applyCountry(
      supabase.from('asset_breakdowns').select(COLS).order('reported_on', { ascending: false }).order('id'),
      country,
    )
    const { data, error, truncated } = await fetchAllPages(build, { max })
    if (error) {
      if (isMissingRelation(error)) return { ok: false, reason: 'unavailable', rows: [], truncated: false }
      throw error
    }
    return { ok: true, rows: data || [], truncated: !!truncated }
  } catch (e) {
    if (isMissingRelation(e)) return { ok: false, reason: 'unavailable', rows: [], truncated: false }
    throw e
  }
}

/** Open or update a breakdown. Returns the stored row. */
export async function saveAssetBreakdown(row = {}) {
  const patch = sanitize(row)
  const q = row.id
    ? supabase.from('asset_breakdowns').update(patch).eq('id', row.id).select(COLS).single()
    : supabase.from('asset_breakdowns').insert(patch).select(COLS).single()
  const { data, error } = await q
  if (error) throw error
  return data
}

/**
 * Record that a machine is back in service.
 *
 * The return DATE is what closes the record, so it is required rather than
 * defaulted to today - a machine that came back last week must not be recorded
 * as having come back the day somebody got round to typing it in, or every
 * downtime figure drifts longer than it really was.
 */
export async function markReturnedToService(id, returnedOn, remark) {
  const patch = { returned_to_service: true, returned_on: text(returnedOn) }
  if (remark !== undefined) patch.remark = text(remark)
  const { data, error } = await supabase
    .from('asset_breakdowns').update(patch).eq('id', id).select(COLS).single()
  if (error) throw error
  return data
}

/** Reopen a breakdown closed by mistake. Clears the return date with it. */
export async function reopenAssetBreakdown(id) {
  const { data, error } = await supabase
    .from('asset_breakdowns')
    .update({ returned_to_service: false, returned_on: null })
    .eq('id', id).select(COLS).single()
  if (error) throw error
  return data
}

export async function deleteAssetBreakdown(id) {
  const { error } = await supabase.from('asset_breakdowns').delete().eq('id', id)
  if (error) throw error
  return true
}
