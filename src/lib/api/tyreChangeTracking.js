/**
 * tyreChangeTracking service - loads exactly what the tracking report needs and
 * nothing more.
 *
 * READ SIZE IS THE WHOLE DESIGN HERE. The running-life RPC returns 3,595 rows /
 * 2.2 MB for KSA in one reply and the browser was dropping it (V523), so this
 * loads the DUE SET ONLY (465 rows for KSA) and then reads fitment history for
 * ONLY the assets that carry a flag, in chunks of asset codes. A whole-fleet
 * tyre_records read is never issued.
 *
 * Every read degrades on its own: a failure in one source is reported as a
 * named gap rather than silently rendering as "nothing is flagged". "We could
 * not look" and "there is nothing" are opposite statements.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'
import { toUserMessage } from '../safeError'
import { getTyreRunningLife } from './tyreRunningLife'
import { shapeRunningLife } from '../tyreRunningLife'

/** Only the columns the matcher reads - a fitment row, not the whole record. */
const FITMENT_COLS =
  'id,asset_no,serial_no,position,tyre_position,brand,size,site,country,issue_date,fitment_date,removal_date,km_at_removal,status,category'

/** Inspections carry the tyre conditions the user-raised flags come from. */
const INSPECTION_COLS =
  'id,asset_no,site,country,inspection_date,scheduled_date,completed_date,created_at,tyre_conditions'

const ACTION_COLS =
  'id,title,asset_no,tyre_serial,site,country,status,created_at,source_type,source_id,source_detail'

/** PostgREST caps a URL, so asset lists are sent in chunks. */
const ASSET_CHUNK = 120

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Fitment history for a named set of assets.
 *
 * Country-scoped, because the same asset code is usually a different machine in
 * another country (V376) - an unscoped read would let a UAE fitment "replace" a
 * KSA tyre.
 */
export async function listFitmentsForAssets(assets = [], { country } = {}) {
  const list = [...new Set((assets || []).map((a) => String(a || '').trim()).filter(Boolean))]
  if (!list.length) return { ok: true, rows: [] }
  try {
    const rows = []
    for (const part of chunk(list, ASSET_CHUNK)) {
      const { data, error } = await fetchAllPages((from, to) => applyCountry(
        supabase.from('tyre_records').select(FITMENT_COLS)
          .in('asset_no', part)
          .order('issue_date', { ascending: true })
          .order('id', { ascending: true }),
        country,
      ).range(from, to), { max: 40000 })
      if (error) return { ok: false, reason: toUserMessage(error), rows: [] }
      if (Array.isArray(data)) rows.push(...data)
    }
    return { ok: true, rows }
  } catch (e) {
    return { ok: false, reason: toUserMessage(e), rows: [] }
  }
}

/** Inspections in the window that recorded tyre conditions. */
export async function listInspectionsWithConditions({ country, from = '', to = '' } = {}) {
  try {
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = applyCountry(
        supabase.from('inspections').select(INSPECTION_COLS)
          .not('tyre_conditions', 'is', null)
          .order('inspection_date', { ascending: false })
          .order('id', { ascending: true }),
        country,
      )
      if (from) q = q.gte('inspection_date', from)
      if (to) q = q.lte('inspection_date', to)
      return q.range(lo, hi)
    }, { max: 5000 })
    if (error) return { ok: false, reason: toUserMessage(error), rows: [] }
    return { ok: true, rows: Array.isArray(data) ? data : [] }
  } catch (e) {
    return { ok: false, reason: toUserMessage(e), rows: [] }
  }
}

/**
 * Corrective actions raised from an inspection. These are the only flags that
 * carry a real raised-on date for a system rule, so they are what makes "how
 * long has this been outstanding" answerable at all.
 */
export async function listTyreFlagActions({ country } = {}) {
  try {
    const { data, error } = await fetchAllPages((lo, hi) => {
      let q = supabase.from('corrective_actions').select(ACTION_COLS)
        .eq('source_type', 'inspection')
        .not('source_detail', 'is', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
      if (country && country !== 'All') q = q.eq('country', country)
      return q.range(lo, hi)
    }, { max: 20000 })
    if (error) return { ok: false, reason: toUserMessage(error), rows: [] }
    return { ok: true, rows: Array.isArray(data) ? data : [] }
  } catch (e) {
    return { ok: false, reason: toUserMessage(e), rows: [] }
  }
}

/**
 * Everything the tracking section needs, in one call.
 *
 * The due list is the ONLY source that is fatal when it fails: without it there
 * is no system-raised flag set at all, and a page showing only the user-raised
 * ones would understate the work outstanding. The other two report themselves
 * as gaps so the screen can name what is missing.
 *
 * @param {{country?:string, asset?:string, from?:string, to?:string}} opts
 * @returns {Promise<{ok:boolean, reason?:string, dueRows:Array, inspections:Array,
 *   actions:Array, tyreRecords:Array, gaps:string[]}>}
 */
export async function loadTyreChangeTracking({ country, asset = '', from = '', to = '' } = {}) {
  const gaps = []
  const duePayload = await getTyreRunningLife({ country, dueOnly: true, asset: asset || null })
  if (!duePayload || duePayload.ok === false) {
    return {
      ok: false,
      reason: (duePayload && duePayload.reason) || 'The running-life service could not be read.',
      dueRows: [], inspections: [], actions: [], tyreRecords: [], gaps,
    }
  }
  const dueRows = shapeRunningLife(duePayload).rows
    .filter((r) => !asset || String(r.asset || '').toUpperCase() === String(asset).toUpperCase())

  const [inspRes, actionRes] = await Promise.all([
    listInspectionsWithConditions({ country, from, to }),
    listTyreFlagActions({ country }),
  ])
  if (!inspRes.ok) gaps.push(`Inspections could not be read, so damage recorded by inspectors is not included. ${inspRes.reason}`)
  if (!actionRes.ok) gaps.push(`Corrective actions could not be read, so flags raised from an inspection are not included. ${actionRes.reason}`)

  const inspections = asset
    ? inspRes.rows.filter((r) => String(r.asset_no || '').toUpperCase() === String(asset).toUpperCase())
    : inspRes.rows
  const actions = asset
    ? actionRes.rows.filter((r) => String(r.asset_no || '').toUpperCase() === String(asset).toUpperCase())
    : actionRes.rows

  // Only the assets that actually carry a flag - never the whole fleet.
  const assets = new Set()
  for (const r of dueRows) if (r.asset) assets.add(r.asset)
  for (const r of inspections) if (r.asset_no) assets.add(r.asset_no)
  for (const r of actions) if (r.asset_no) assets.add(r.asset_no)

  const fit = await listFitmentsForAssets([...assets], { country })
  if (!fit.ok) {
    gaps.push(`The monthly tyre consumption could not be read, so no replacement can be confirmed. ${fit.reason}`)
  }

  return {
    ok: true,
    dueRows,
    inspections,
    actions,
    tyreRecords: fit.rows,
    gaps,
  }
}
