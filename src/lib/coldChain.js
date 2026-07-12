/**
 * Cold-Chain — pure, dependency-free domain logic for the Cold-Chain Monitor
 * module (/cold-chain). Classifies a temperature reading against a safe range
 * and aggregates a set of readings for the KPI header.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/coldChain.js`) and page
 * (`src/pages/ColdChain.jsx`) both build on these primitives so the breach logic
 * lives in exactly one place.
 */

/** Canonical statuses (mirrors the CHECK constraint in V143). */
export const COLD_CHAIN_STATUSES = ['ok', 'warning', 'breach']

export const COLD_CHAIN_STATUS_META = {
  ok: { label: 'OK', tone: 'green' },
  warning: { label: 'Warning', tone: 'amber' },
  breach: { label: 'Breach', tone: 'red' },
}

/** How close (in °C) to a bound before a reading is flagged "warning". */
export const WARNING_MARGIN_C = 1

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Classify a temperature against a [min, max] safe range.
 *   • 'breach'  — temp is outside [min, max]
 *   • 'warning' — temp is inside the range but within WARNING_MARGIN_C of a bound
 *   • 'ok'      — comfortably inside the range
 *
 * Missing/unparseable inputs are handled gracefully: with no usable bound the
 * reading can never breach, so it classifies as 'ok'. A single defined bound is
 * honoured on its own (open-ended range).
 *
 * @param {number} temp
 * @param {number} [min]
 * @param {number} [max]
 * @returns {'ok'|'warning'|'breach'}
 */
export function classifyTemp(temp, min, max) {
  const t = toFiniteNumber(temp)
  const lo = toFiniteNumber(min)
  const hi = toFiniteNumber(max)
  if (t == null) return 'ok'

  // Breach: strictly outside a defined bound.
  if (lo != null && t < lo) return 'breach'
  if (hi != null && t > hi) return 'breach'

  // Warning: inside the range but hugging a bound.
  if (lo != null && t - lo <= WARNING_MARGIN_C) return 'warning'
  if (hi != null && hi - t <= WARNING_MARGIN_C) return 'warning'

  return 'ok'
}

/**
 * Summarise a set of readings for the KPI header. Counts each row by its stored
 * status (falling back to a live re-classification when a row has no status),
 * plus the number of distinct assets monitored.
 *
 * @param {Array<object>} rows
 * @returns {{ total:number, ok:number, warning:number, breach:number,
 *             breaches:number, warnings:number, assetsMonitored:number }}
 */
export function summarizeColdChain(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { ok: 0, warning: 0, breach: 0 }
  const assets = new Set()

  for (const r of list) {
    const status = COLD_CHAIN_STATUSES.includes(r?.status)
      ? r.status
      : classifyTemp(r?.temperature_c, r?.min_threshold_c, r?.max_threshold_c)
    counts[status] += 1
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
  }

  return {
    total: list.length,
    ok: counts.ok,
    warning: counts.warning,
    breach: counts.breach,
    breaches: counts.breach,
    warnings: counts.warning,
    assetsMonitored: assets.size,
  }
}
