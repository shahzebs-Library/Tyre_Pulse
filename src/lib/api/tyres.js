/**
 * Tyres service - tyre records (tyre_records). Explicit column lists; null-safe
 * country scoping. Pages migrate onto these methods instead of inline queries.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,serial_no,asset_no,brand,size,position,risk_level,tread_depth,pressure_reading,site,country,issue_date,created_at'

/**
 * List tyre records, newest first. Country-scoped (null-safe) and optionally
 * filtered by risk level / site.
 * @param {{country?:string, riskLevel?:string, site?:string, limit?:number}} [opts]
 */
export async function listTyreRecords({ country, riskLevel, site, limit = 100 } = {}) {
  let q = supabase
    .from('tyre_records')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (riskLevel) q = q.eq('risk_level', riskLevel)
  if (site) q = q.eq('site', site)
  return unwrap(await q)
}

/** Look up a tyre by its serial number (or null). */
export async function getTyreBySerial(serial) {
  return unwrap(
    await supabase.from('tyre_records').select(COLS).eq('serial_no', serial).maybeSingle(),
  )
}
