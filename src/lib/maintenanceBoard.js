/**
 * maintenanceBoard.js - pure shapers for the Maintenance Cost & Tasks board.
 *
 * Turns the `get_maintenance_snapshot` JSON into chart-ready chart.js data
 * objects and normalized KPI numbers. NO I/O and NO colours: the page applies
 * the shared palette (reportColors.stylize) so this module stays deterministic
 * and testable. Every field is guarded (arrays may be missing / null); numbers
 * are null-safe. No em/en dashes in any output string.
 */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const isNum = (v) => Number.isFinite(Number(v))
const arr = (v) => (Array.isArray(v) ? v : [])

/** 'YYYY-MM' -> 'Mon YY' label (passthrough for anything else). */
export function monthLabel(key) {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

/** Normalized headline KPIs; null when the source value is missing / not numeric. */
export function mtkpis(snapshot) {
  const k = snapshot?.kpis || {}
  const pick = (v) => (isNum(v) ? n(v) : null)
  return {
    jobCards: pick(k.job_cards),
    lineItems: pick(k.line_items),
    totalSpend: pick(k.total_spend),
    avgJobCost: pick(k.avg_job_cost),
    tyreLines: pick(k.tyre_lines),
    openJobs: pick(k.open_jobs),
  }
}

/** Top maintenance tasks -> occurrence bar data. */
export function taskChart(snapshot) {
  const rows = arr(snapshot?.top_tasks)
  return {
    labels: rows.map((r) => String(r?.label ?? '')),
    datasets: [{ label: 'Occurrences', data: rows.map((r) => n(r?.n)) }],
  }
}

/** Top corrective actions -> occurrence bar data. */
export function actionChart(snapshot) {
  const rows = arr(snapshot?.top_actions)
  return {
    labels: rows.map((r) => String(r?.label ?? '')),
    datasets: [{ label: 'Occurrences', data: rows.map((r) => n(r?.n)) }],
  }
}

/** Spend by work type -> bar data. */
export function workTypeSpendChart(snapshot) {
  const rows = arr(snapshot?.by_work_type)
  return {
    labels: rows.map((r) => String(r?.label ?? '')),
    datasets: [{ label: 'Spend', data: rows.map((r) => n(r?.spend)) }],
  }
}

/** Spend by site -> bar data. */
export function siteSpendChart(snapshot) {
  const rows = arr(snapshot?.spend_by_site)
  return {
    labels: rows.map((r) => String(r?.label ?? '')),
    datasets: [{ label: 'Spend', data: rows.map((r) => n(r?.spend)) }],
  }
}

/** Spend by asset -> bar data. */
export function assetSpendChart(snapshot) {
  const rows = arr(snapshot?.spend_by_asset)
  return {
    labels: rows.map((r) => String(r?.label ?? '')),
    datasets: [{ label: 'Spend', data: rows.map((r) => n(r?.spend)) }],
  }
}

/** Monthly spend -> line data ('Mon YY' labels). */
export function monthlySpendChart(snapshot) {
  const rows = arr(snapshot?.monthly_spend)
  return {
    labels: rows.map((r) => monthLabel(r?.m)),
    datasets: [{ label: 'Spend', data: rows.map((r) => n(r?.spend)) }],
  }
}

/** Honest, number-led recommendations from the snapshot. Empty when nothing stands out. */
export function buildMaintenanceRecommendations(snapshot) {
  const recs = []
  if (!snapshot || snapshot.ok === false) return recs
  const k = mtkpis(snapshot)

  if (isNum(k.openJobs) && k.openJobs > 0) {
    recs.push({ level: k.openJobs > 100 ? 'high' : 'medium', text: `${k.openJobs.toLocaleString('en-US')} job card(s) are still open. Close them out to reduce vehicle downtime.` })
  }

  // Repair-heavy spend signals reactive maintenance versus planned PM.
  const byType = arr(snapshot.by_work_type)
  const total = byType.reduce((s, r) => s + n(r?.spend), 0)
  const repair = byType.find((r) => /repair/i.test(String(r?.label || '')))
  if (repair && total > 0) {
    const share = Math.round((n(repair.spend) / total) * 100)
    if (share >= 60) recs.push({ level: 'high', text: `Repairs are ${share}% of maintenance spend. Shift budget toward preventive maintenance to cut breakdown cost.` })
  }

  // Concentrated task cost: the single most frequent task dominating the list.
  const tasks = arr(snapshot.top_tasks)
  if (tasks.length > 0) {
    const totalTaskN = tasks.reduce((s, r) => s + n(r?.n), 0)
    const topN = n(tasks[0]?.n)
    if (totalTaskN > 0 && topN / totalTaskN >= 0.25) {
      recs.push({ level: 'low', text: `"${String(tasks[0]?.label || '').trim()}" alone is ${Math.round((topN / totalTaskN) * 100)}% of the top tasks. Review parts sourcing and intervals for it.` })
    }
  }

  // Tyre share of maintenance work.
  if (isNum(k.tyreLines) && isNum(k.lineItems) && k.lineItems > 0) {
    const tyreShare = Math.round((k.tyreLines / k.lineItems) * 100)
    if (tyreShare >= 15) recs.push({ level: 'medium', text: `Tyre-related work is ${tyreShare}% of line items. Track CPK and rotation to control tyre spend.` })
  }

  return recs.slice(0, 6)
}
