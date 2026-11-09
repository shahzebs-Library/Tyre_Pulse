import { supabase, toServiceError } from './_client'

const scope = (country) => (country && country !== 'All' ? country : null)

/**
 * Jan-2025-onward tyre data accuracy audit (public.get_tyre_evidence_audit,
 * migration 20261111090000). Read only; RLS scopes the countries returned.
 */
export async function getTyreEvidenceAudit({ country, from, to } = {}) {
  const { data, error } = await supabase.rpc('get_tyre_evidence_audit', {
    p_country: scope(country), p_from: from || '2025-01-01', p_to: to || null,
  })
  if (error) throw toServiceError(error)
  return data || {}
}

const EVIDENCE_COLS =
  'id,country,asset_no,position,serial_no,fit_date,removal_date,status,km_at_fitment,km_at_removal,job_card,purchase_cost_status,evidence_class,reasons'

/**
 * Record-level rows of one evidence class (for the export of record ids).
 * Paged 1,000 at a time with an id tiebreak; stops at `max` and says so.
 */
export async function listEvidenceRows({ country, evidenceClass, from = '2025-01-01', to, max = 20000 } = {}) {
  const out = []
  const pageSize = 1000
  for (let offset = 0; offset < max; offset += pageSize) {
    let q = supabase.from('v_tyre_fitment_evidence').select(EVIDENCE_COLS)
      .eq('era', 'modern').gte('fit_date', from)
    if (to) q = q.lte('fit_date', to)
    if (scope(country)) q = q.eq('country', scope(country))
    if (evidenceClass) q = q.eq('evidence_class', evidenceClass)
    const { data, error } = await q.order('fit_date', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw toServiceError(error)
    out.push(...(data || []))
    if (!data || data.length < pageSize) return { rows: out, truncated: false }
  }
  return { rows: out, truncated: true }
}
