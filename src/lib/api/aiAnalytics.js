/**
 * AiAnalytics reads - the exact tyre/inspection/corrective-action selects the
 * AI Smart Analytics page consumes. Read-only; returns the raw Supabase /
 * fetchAllPages result the page reads via `.data` (error-tolerant bulk load).
 */
import { supabase, fetchAllPages } from './_client'

const active = (c) => (c && c !== 'All' ? c : null)

/** Chronological tyre_records for AI analysis (paged), country-scoped. */
export function listAiTyreRecords({ country } = {}) {
  const cf = active(country)
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records')
      .select('id,issue_date,brand,site,asset_no,category,risk_level,cost_per_tyre,qty,serial_no,created_at,country')
      .order('issue_date', { ascending: true })
    if (cf) q = q.eq('country', cf)
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
