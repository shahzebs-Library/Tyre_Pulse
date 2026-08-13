/**
 * AiAnalytics reads - the exact tyre/inspection/corrective-action selects the
 * AI Smart Analytics page consumes. Read-only; returns the raw Supabase /
 * fetchAllPages result the page reads via `.data` (error-tolerant bulk load).
 */
import { supabase, fetchAllPages } from './_client'

const active = (c) => (c && c !== 'All' ? c : null)

/**
 * Chronological tyre_records for AI analysis (paged), country-scoped.
 *
 * `from`/`to` bound `issue_date` server-side and are OPTIONAL - omitted, this is
 * the same all-time read as before, so no caller is affected. They are here so a
 * caller that only analyses a period can stop pulling every record ever written.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export function listAiTyreRecords({ country, from: fromDate, to: toDate } = {}) {
  const cf = active(country)
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records')
      .select('id,issue_date,brand,site,asset_no,category,risk_level,cost_per_tyre,qty,serial_no,created_at,country')
      .order('issue_date', { ascending: true })
    if (cf) q = q.eq('country', cf)
    if (fromDate) q = q.gte('issue_date', fromDate)
    if (toDate) q = q.lte('issue_date', toDate)
    return q.range(from, to)
  }, { max: 200000 })
}

/** Latest 100 inspections (brief). */
export function listAiInspections() {
  return supabase.from('inspections')
    .select('id,status,severity,scheduled_date,site,findings,inspector')
    .order('scheduled_date', { ascending: false }).limit(100)
}

/** Latest 50 corrective actions (brief). */
export function listAiCorrectiveActions() {
  return supabase.from('corrective_actions')
    .select('id,title,priority,site,status,assigned_to')
    .order('created_at', { ascending: false }).limit(50)
}
