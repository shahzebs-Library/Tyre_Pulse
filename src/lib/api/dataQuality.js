/**
 * Data Quality service - read-only per-country completeness/integrity scorecard
 * for the Data Reconciliation console. Single Supabase boundary for the V354
 * `recon_data_quality_summary` RPC (SECURITY DEFINER, app_is_elevated-gated,
 * org-scoped in Postgres). This layer never re-implements the gate; it only
 * relocates the call and degrades to an honest empty state on any error.
 *
 * The `gradeFor` helper is a PURE function (no I/O) so it is unit-testable and
 * reusable by the panel - it derives a 0-100 score and a letter grade from a
 * single country row's linkage and brand-completeness ratios.
 */
import { supabase } from './_client'

/**
 * Fetch the per-country data-quality summary via the `recon_data_quality_summary`
 * RPC. Never throws - returns [] on a null payload or any RPC error so the panel
 * can render an honest empty/error state.
 *
 * @returns {Promise<Array<{
 *   country: string,
 *   tyres: number,
 *   tyres_no_brand: number,
 *   tyres_no_serial: number,
 *   wo: number,
 *   wo_total: number,
 *   wo_linked: number,
 *   tyres_linked: number,
 *   fleet: number
 * }>>} one row per country (empty array when none or on error)
 */
export async function getDataQualitySummary() {
  try {
    const { data, error } = await supabase.rpc('recon_data_quality_summary')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Pure grade calculator for a single country row.
 *
 * Score (0-100) is a simple weighted blend of three completeness/integrity
 * ratios, each expressed as a percentage of its own denominator:
 *   - tyre asset linkage  (tyres_linked / tyres)       weight 0.40
 *   - work-order linkage  (wo_linked   / wo_total)     weight 0.30
 *   - tyre brand complete (1 - no_brand / tyres)       weight 0.30
 * A ratio whose denominator is 0 is treated as a perfect 1 (nothing to fault),
 * so an empty bucket never drags the grade down. The weighted result is scaled
 * to 0-100 and rounded.
 *
 * Letter grade bands: A >=90, B >=80, C >=70, D >=60, F <60.
 *
 * @param {{tyres_no_brand?: number, tyres?: number, tyres_linked?: number,
 *          wo_linked?: number, wo_total?: number}} row
 * @returns {{ score: number, grade: string }}
 */
export function gradeFor(row) {
  const r = row || {}
  const tyres = Number(r.tyres) || 0
  const woTotal = Number(r.wo_total) || 0
  const tyresLinked = Number(r.tyres_linked) || 0
  const woLinked = Number(r.wo_linked) || 0
  const noBrand = Number(r.tyres_no_brand) || 0

  const ratio = (num, den) => (den > 0 ? Math.max(0, Math.min(1, num / den)) : 1)

  const tyreLinkage = ratio(tyresLinked, tyres)
  const woLinkage = ratio(woLinked, woTotal)
  const brandComplete = ratio(tyres - noBrand, tyres)

  const blended = tyreLinkage * 0.4 + woLinkage * 0.3 + brandComplete * 0.3
  const score = Math.round(Math.max(0, Math.min(1, blended)) * 100)

  let grade = 'F'
  if (score >= 90) grade = 'A'
  else if (score >= 80) grade = 'B'
  else if (score >= 70) grade = 'C'
  else if (score >= 60) grade = 'D'

  return { score, grade }
}
