/**
 * Self-Healing service - the Supabase boundary for the console Self-Healing
 * module (Admin Control Module 2). It is deliberately THIN and SAFE:
 *
 *   - SCAN paths are READ-ONLY. They REUSE the existing, server-gated
 *     reconciliation RPCs (dataReconciliation.js) plus a lightweight staleness
 *     query and the local anomaly engine. Each source is isolated in its own
 *     try/catch and degrades to [] so one unavailable table never sinks a scan.
 *
 *   - FIX paths are thin pass-throughs to the EXISTING reconciliation RPCs only.
 *     This module creates NO new mutating RPC. The only fixes offered are the
 *     ones the reconciliation layer already guards server-side:
 *       backfill a missing asset, backfill all orphans, merge byte-identical
 *       duplicate tyres (the RPC itself refuses non-identical rows).
 *
 *   - logHealFinding is a best-effort reporter into system_logs so a scan's
 *     findings surface on the System Health board. It never throws.
 *
 * Nothing here decides to delete or overwrite data on its own.
 */
import { supabase, applyCountry } from './_client'
import {
  listOrphanAssets, listDuplicateTyres, listSerialConflicts,
  backfillAsset, backfillAllOrphanAssets, mergeDuplicate,
} from './dataReconciliation'
import { logSystemEvent } from './systemLogs'
import { detectAnomalies } from '../anomalyEngine'

/** Tables scanned for site-level staleness. */
const STALE_TABLES = ['tyre_records', 'accidents', 'inspections']

/** Cap on rows pulled per table for the staleness scan (head-light). */
const STALE_ROW_CAP = 5000

/**
 * Latest activity per site across the operational tables, as
 * [{ site, created_at }] (one row per site = the most recent created_at seen in
 * any scanned table). Feeds the pure `detectStaleGroups`. Never throws: a table
 * that errors is skipped; total failure returns [].
 *
 * @param {object} [opts]
 * @param {string} [opts.country]  optional country scope
 * @returns {Promise<Array<{ site: string, created_at: string }>>}
 */
async function queryStaleRows({ country } = {}) {
  const latest = new Map() // site -> { t, created_at }
  for (const table of STALE_TABLES) {
    try {
      let q = supabase.from(table)
        .select('site,created_at')
        .order('created_at', { ascending: false })
        .limit(STALE_ROW_CAP)
      q = applyCountry(q, country)
      const { data, error } = await q
      if (error) continue
      for (const r of Array.isArray(data) ? data : []) {
        const site = r?.site
        const created = r?.created_at
        if (!site || !created) continue
        const t = new Date(created).getTime()
        if (Number.isNaN(t)) continue
        const prev = latest.get(site)
        if (!prev || t > prev.t) latest.set(site, { t, created_at: created })
      }
    } catch {
      // skip this table, keep scanning the rest
    }
  }
  return Array.from(latest.entries()).map(([site, v]) => ({ site, created_at: v.created_at }))
}

/**
 * Run every READ-ONLY scan. Each source is independently guarded so partial
 * data still returns; nothing here mutates anything.
 *
 * @param {object} [opts]
 * @param {string} [opts.country]
 * @returns {Promise<{
 *   orphans: Array, duplicates: Array, serialConflicts: Array, staleRows: Array
 * }>}
 */
export async function runScans({ country } = {}) {
  const [orphans, duplicates, serialConflicts, staleRows] = await Promise.all([
    Promise.resolve().then(listOrphanAssets).catch(() => []),
    Promise.resolve().then(listDuplicateTyres).catch(() => []),
    Promise.resolve().then(listSerialConflicts).catch(() => []),
    queryStaleRows({ country }).catch(() => []),
  ])
  return {
    orphans: Array.isArray(orphans) ? orphans : [],
    duplicates: Array.isArray(duplicates) ? duplicates : [],
    serialConflicts: Array.isArray(serialConflicts) ? serialConflicts : [],
    staleRows: Array.isArray(staleRows) ? staleRows : [],
  }
}

/**
 * Predictive anomaly scan over tyre_records using the local rule-based engine
 * (no AI). READ-ONLY and honest: returns [] on any error or empty data.
 *
 * @param {object} [opts]
 * @param {string} [opts.country]
 * @returns {Promise<Array>} anomaly objects from detectAnomalies
 */
export async function scanAnomalies({ country } = {}) {
  try {
    let q = supabase.from('tyre_records')
      .select('id,asset_no,serial_no,site,issue_date,cost_per_tyre,risk_level,brand,qty,created_at')
      .limit(STALE_ROW_CAP)
    q = applyCountry(q, country)
    const { data, error } = await q
    if (error) return []
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 0) return []
    return detectAnomalies(rows)
  } catch {
    return []
  }
}

/* ── SAFE fix pass-throughs (existing guarded reconciliation RPCs only) ─────── */

/**
 * Backfill a single missing asset into vehicle_fleet. Thin pass-through to the
 * existing recon_backfill_asset RPC.
 * @param {string} assetNo
 * @returns {Promise<string>} new vehicle_fleet row id
 */
export function applyBackfillOrphan(assetNo) {
  return backfillAsset(assetNo)
}

/**
 * Backfill every orphaned asset. Thin pass-through to the existing
 * recon_backfill_all_orphan_assets RPC.
 * @returns {Promise<number>} count backfilled
 */
export function applyBackfillAllOrphans() {
  return backfillAllOrphanAssets()
}

/**
 * Merge byte-identical duplicate tyre rows (keep one, remove the rest). Thin
 * pass-through to the existing recon_merge_duplicate RPC, which refuses the
 * merge server-side unless the rows are truly identical.
 * @param {string}   keepId
 * @param {string[]} removeIds
 * @returns {Promise<number>} count removed
 */
export function applyMergeDuplicate(keepId, removeIds) {
  return mergeDuplicate(keepId, removeIds)
}

/**
 * Best-effort record of a scan's findings into system_logs so they surface on
 * the System Health board. Only logs when there is something to report, and
 * never throws.
 *
 * @param {{ total?: number, bySeverity?: object }} summary  summarizeFindings output
 * @returns {Promise<{ ok: boolean }>}
 */
export async function logHealFinding(summary) {
  try {
    const total = Number(summary?.total) || 0
    if (total <= 0) return { ok: false }
    const by = summary?.bySeverity || {}
    const message =
      `Self-Healing scan flagged ${total} issue(s): ` +
      `${by.warning || 0} warning, ${by.info || 0} info`
    await logSystemEvent({
      module_id: 'self-healing',
      severity: 'warning',
      source: 'self-healing-scan',
      message,
      detail: summary || null,
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
