/**
 * Import Center - line-item aggregation.
 *
 * Some ERP exports are LINE-ITEM files: several rows per business record
 * (e.g. "Work Order Details" store-issues with one row per issued item, where
 * the per-line Tyre value is the pre-calculated cost). Committing them 1:1
 * would create duplicate work orders and lose all but the first line's cost.
 *
 * A mapping profile can therefore declare, in unit_settings:
 *   { "aggregate": { "by": "work_order_no", "sum": ["tyre_cost","parts_cost"] } }
 * and the wizard collapses the staged rows: one row per key, summing the
 * declared numeric fields, keeping the first non-empty value for everything
 * else, and preserving EVERY source line verbatim in custom_data.line_items.
 *
 * @module import/aggregate
 */

/** Sum two possibly-absent numerics (strings tolerated); null when neither parses. */
function addNum(a, b) {
  const na = Number(a); const nb = Number(b)
  const ha = Number.isFinite(na); const hb = Number.isFinite(nb)
  if (ha && hb) return Math.round((na + nb) * 100) / 100
  if (ha) return na
  if (hb) return nb
  return null
}

const STATUS_RANK = { error: 3, warning: 2, ready: 1 }

/**
 * Collapse annotated wizard rows into one row per natural key.
 *
 * @param {Array<Object>} rows  Annotated rows from runValidation (each with
 *   raw / mapped / transformed / custom / issues / validationStatus / ...).
 * @param {{ by: string, sum?: string[] }} cfg
 * @returns {Array<Object>} aggregated rows (rows without the key pass through)
 */
export function aggregateStagedRows(rows, cfg) {
  const by = cfg?.by
  if (!by) return rows
  const sumFields = Array.isArray(cfg.sum) ? cfg.sum : []

  /** @type {Map<string, Object>} */
  const groups = new Map()
  const out = []

  for (const r of rows) {
    const key = r?.transformed?.[by]
    const norm = key == null ? '' : String(key).trim()
    if (!norm) { out.push(r); continue }

    const existing = groups.get(norm)
    if (!existing) {
      const first = {
        ...r,
        transformed: { ...r.transformed },
        mapped: { ...r.mapped },
        custom: { ...r.custom, line_items: [r.raw], line_count: 1 },
        issues: [...(r.issues || [])],
      }
      groups.set(norm, first)
      out.push(first)
      continue
    }

    // merge: sum the declared cost/qty fields...
    for (const f of sumFields) {
      const merged = addNum(existing.transformed[f], r.transformed?.[f])
      if (merged != null) existing.transformed[f] = merged
    }
    // ...first non-empty wins for every other transformed field...
    for (const [k, v] of Object.entries(r.transformed || {})) {
      if (sumFields.includes(k)) continue
      const cur = existing.transformed[k]
      if ((cur == null || cur === '') && v != null && v !== '') existing.transformed[k] = v
    }
    // ...keep every source line for audit, merge issues, keep worst status.
    existing.custom.line_items.push(r.raw)
    existing.custom.line_count += 1
    for (const iss of r.issues || []) {
      if (!existing.issues.some((e) => e.code === iss.code && e.field === iss.field)) {
        existing.issues.push(iss)
      }
    }
    if ((STATUS_RANK[r.validationStatus] || 0) > (STATUS_RANK[existing.validationStatus] || 0)) {
      existing.validationStatus = r.validationStatus
    }
  }
  return out
}
