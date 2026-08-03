import { supabase } from './_client'

/**
 * Data Trust / Lineage / Diagnostics Control Center service (V458).
 *
 * Thin Supabase boundary over the two new read RPCs. Both degrade to
 * `{ ok:false }` rather than throwing, so the Control Center renders an honest
 * empty/error state instead of crashing. Trust scores, duplicate/orphan/anomaly
 * lists and all resolve/scan actions come from the EXISTING services
 * (dataTrust, dataReconciliation, duplicateControl, systemLogs, ...) - this file
 * only adds the genuinely-missing figure-lineage trace and the one-call
 * diagnostics summary.
 */

const DOMAINS = ['tyre_cost', 'cost_per_km', 'tyre_life', 'brand_performance', 'fleet_register']
export const LINEAGE_DOMAINS = DOMAINS
export const DOMAIN_LABELS = {
  tyre_cost: 'Tyre spend',
  cost_per_km: 'Cost per km',
  tyre_life: 'Tyre life',
  brand_performance: 'Brand performance',
  fleet_register: 'Fleet register',
}

/**
 * Trace a KPI figure back to its source tables, their provenance and the recent
 * import activity behind it.
 * @param {{ domain?:string, country?:string, from?:string, to?:string }} [opts]
 */
export async function getFigureLineage({ domain = 'tyre_cost', country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_figure_lineage', {
      p_domain: DOMAINS.includes(domain) ? domain : 'tyre_cost',
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error) return { ok: false, reason: 'error' }
    return data || { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * One-call data-quality diagnostics summary (cheap indexed counts + volumes).
 * @param {{ country?:string }} [opts]
 */
export async function getControlCenterSummary({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_control_center_summary', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error) return { ok: false, reason: 'error' }
    return data || { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * One-call Control Center feed (V460): summary + default tyre_cost lineage in a
 * single round trip. Returns `{ ok, summary, lineage }`. Degrades to `{ok:false}`
 * so the caller can fall back to the two separate calls.
 * @param {{ country?:string }} [opts]
 */
export async function getDiagnosticsFeed({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_diagnostics_feed', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error) return { ok: false, reason: 'error' }
    return data || { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Severity ordering + tone for the diagnostics feed (console kit vocabulary). */
export const ISSUE_SEVERITY_RANK = { critical: 0, warning: 1, info: 2 }
export const ISSUE_SEVERITY_TONE = { critical: 'danger', warning: 'warning', info: 'info' }

/** Where each diagnostic drills down to (existing console surface). */
export const ISSUE_ROUTE = {
  recon_orphan_assets: '/data-reconciliation',
  recon_brand: '/data-reconciliation',
  data_reconciliation: '/data-reconciliation',
  tyre_price_backfill: '/data-reconciliation',
  material_master: '/console/material-master',
  import_history: '/console/import-history',
}

/**
 * Sort a summary's issues most-severe first, then by count desc. Pure.
 * @param {Array} issues
 */
export function rankIssues(issues) {
  return [...(issues || [])].sort((a, b) => {
    const s = (ISSUE_SEVERITY_RANK[a.severity] ?? 9) - (ISSUE_SEVERITY_RANK[b.severity] ?? 9)
    return s !== 0 ? s : (Number(b.count) || 0) - (Number(a.count) || 0)
  })
}

/** Total open issues (non-zero counts). Pure. */
export function openIssueCount(issues) {
  return (issues || []).reduce((n, i) => n + (Number(i.count) > 0 ? 1 : 0), 0)
}
