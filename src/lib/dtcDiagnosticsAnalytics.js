/**
 * DTC Diagnostics page analytics (pure, no I/O) behind /dtc.
 *
 * The fault maths (recurrence, burden, ageing, data quality) lives in
 * src/lib/dtcCodes.js and is REUSED here, never re-derived. This module adds
 * the page-level pieces that used to sit inline in DtcDiagnostics.jsx: the
 * register filter, the per-row recurrence lookup, the headline KPI set and the
 * register/export row shape. `now` is injectable.
 */
import { analyzeDtc, severityRank, isOpenStatus } from './dtcCodes'

export const DTC_SEVERITY_LABEL = { info: 'Info', warning: 'Warning', critical: 'Critical' }
export const DTC_STATUS_LABEL = { active: 'Active', acknowledged: 'Acknowledged', cleared: 'Cleared' }

const lc = (v) => String(v ?? '').toLowerCase()
const recKey = (asset, code) => `${String(asset ?? '').trim()} ${String(code ?? '').trim().toUpperCase()}`

/** Register filter: status + severity + asset + system + free text. */
export function filterDtcRows(rows = [], { status = 'all', severity = 'all', asset = '', system = '', search = '' } = {}) {
  const q = lc(search).trim()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false
    if (status !== 'all' && r.status !== status) return false
    if (severity !== 'all' && r.severity !== severity) return false
    if (asset && r.asset_no !== asset) return false
    if (system && String(r.system || '').trim() !== system) return false
    if (q) {
      const hay = `${r.asset_no || ''} ${r.code || ''} ${r.description || ''} ${r.system || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** asset+code -> occurrence count, from dtcCodes.detectRecurring output. */
export function recurrenceIndex(recurring = []) {
  const m = new Map()
  for (const g of recurring || []) m.set(recKey(g.asset_no, g.code), g.occurrences)
  return m
}

/** Occurrences of this row's code on this asset; 0 when unknown / not repeated. */
export function rowRecurrence(row, index) {
  const a = String(row?.asset_no ?? '').trim()
  const c = String(row?.code ?? '').trim()
  if (!a || !c || !index) return 0
  return index.get(recKey(a, c)) || 0
}

/** Whole days open for an open code (detected_at, then created_at); null otherwise. */
export function openAgeDays(row, now = new Date()) {
  if (!row || !isOpenStatus(row.status)) return null
  const t = new Date(row.detected_at || row.created_at || '').getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000))
}

/**
 * The full page model: analyzeDtc over ALL rows (fleet picture) plus the
 * headline KPIs. Shares with an empty denominator are null, never 0%.
 */
export function buildDtcModel(rows = [], now = new Date()) {
  const analysis = analyzeDtc(rows, { asOf: now.getTime() })
  const s = analysis.summary
  const open = s.byStatus.active + s.byStatus.acknowledged
  const clearedPct = s.total ? Math.round((s.byStatus.cleared / s.total) * 1000) / 10 : null
  const over30 = (analysis.ageing.buckets['31 to 90d'] || 0) + (analysis.ageing.buckets['over 90d'] || 0)
  return {
    analysis,
    index: recurrenceIndex(analysis.recurring),
    kpis: {
      total: s.total,
      open,
      active: s.active,
      criticalActive: s.criticalActive,
      acknowledged: s.byStatus.acknowledged,
      clearedPct,
      assetsAffected: s.assetsAffected,
      repeatOffenderAssets: analysis.kpis.repeatOffenderAssets,
      distinctCodes: analysis.kpis.distinctCodes,
      openOver30: over30,
      oldestOpenDays: analysis.ageing.oldestDays,
      avgOpenDays: analysis.ageing.avgDays,
    },
  }
}

/** Distinct sorted systems (blank excluded). */
export function systemOptions(rows = []) {
  const set = new Set()
  for (const r of rows || []) { const s = String(r?.system || '').trim(); if (s) set.add(s) }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Flat register rows for the table and exports. */
export function dtcRegisterRows(rows = [], index, now = new Date()) {
  return (rows || []).map((r) => {
    const rec = rowRecurrence(r, index)
    const detectedMs = new Date(r.detected_at || '').getTime()
    return {
      id: r.id,
      asset_no: r.asset_no || null,
      code: r.code || null,
      system: r.system || null,
      description: r.description || null,
      severity: r.severity || null,
      severityLabel: DTC_SEVERITY_LABEL[r.severity] || r.severity || 'N/A',
      severityRank: severityRank(r.severity),
      status: r.status || null,
      statusLabel: DTC_STATUS_LABEL[r.status] || r.status || 'N/A',
      detected_at: r.detected_at || null,
      detectedMs: Number.isFinite(detectedMs) ? detectedMs : null,
      openDays: openAgeDays(r, now),
      recurrence: rec > 1 ? rec : null,
      site: r.site || null,
      raw: r,
    }
  })
}
