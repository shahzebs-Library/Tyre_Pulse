/**
 * Inspections that can belong to one tyre, for the Tyre Passport. Two paged,
 * country-scoped reads: inspections that name the serial, and inspections of
 * the assets the tyre was fitted to. The pure matcher in
 * src/lib/tyrePassportView.js (inspectionRowsForTyre) then keeps only the ones
 * that were on this tyre's position while it was fitted.
 */
import { supabase, applyCountry, fetchAllPages, unwrap } from './_client'

const COLS = 'id,asset_no,site,inspection_date,completed_date,inspector,status,findings,tyre_serial,tyre_conditions,pressure_reading,created_at'
const MAX_ROWS = 2000

export async function listTyreInspections(serial, assets = [], { country } = {}) {
  const value = String(serial || '').trim()
  const assetList = [...new Set((assets || []).filter(Boolean).map(String))].slice(0, 50)
  const reads = []
  if (value) {
    reads.push(fetchAllPages((from, to) => applyCountry(
      supabase.from('inspections').select(COLS).eq('tyre_serial', value), country,
    ).order('inspection_date', { ascending: false }).order('id').range(from, to), { max: MAX_ROWS }))
  }
  if (assetList.length) {
    reads.push(fetchAllPages((from, to) => applyCountry(
      supabase.from('inspections').select(COLS).in('asset_no', assetList), country,
    ).order('inspection_date', { ascending: false }).order('id').range(from, to), { max: MAX_ROWS }))
  }
  const results = await Promise.all(reads)
  const rows = []
  let truncated = false
  for (const r of results) {
    rows.push(...(unwrap(r) || []))
    if (r.truncated) truncated = true
  }
  return { rows, truncated }
}
