/**
 * dataOpsCenter.js - pure logic shared by the Control Center DATA screens
 * (Data Operations, Import History, Duplicate Control, Material Master,
 * Teach the Classifier, Data Learning, Data Cleanup).
 *
 * No I/O here. Every figure the pages show that is not a straight read comes
 * from one of these functions so it can be tested.
 *
 * Honesty rules applied throughout:
 *   - an unknown value is null (the page prints "N/A"), never a fake 0
 *   - money is grouped per currency and never added across SAR, AED and EGP
 */

/** Each country reports in its own currency. */
export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Console audit actions that change data. Used to build the "recent data
 * changes" feed on Data Operations from console_sessions.
 */
export const DATA_ACTIONS = Object.freeze({
  duplicate_resolve: { label: 'Duplicate rows removed', tone: 'warning', route: '/console/duplicates?tab=history' },
  duplicate_restore: { label: 'Duplicate removal undone', tone: 'info', route: '/console/duplicates?tab=history' },
  duplicate_scan_all: { label: 'All tables scanned for duplicates', tone: 'info', route: '/console/duplicates' },
  data_cleanup: { label: 'Old records deleted', tone: 'danger', route: '/console/data-cleanup' },
  material_confirm: { label: 'Item categories confirmed', tone: 'info', route: '/console/material-master' },
  material_save: { label: 'Item category decided', tone: 'info', route: '/console/material-master' },
  material_derive: { label: 'Material master rebuilt', tone: 'info', route: '/console/material-master' },
  decisions_save: { label: 'Category overrides saved', tone: 'info', route: '/console/import-history?tab=decisions' },
  decisions_apply: { label: 'Reviewed decisions applied to loaded lines', tone: 'warning', route: '/console/import-history?tab=decisions' },
  decisions_revert: { label: 'Applied decisions undone', tone: 'info', route: '/console/import-history?tab=decisions' },
  upload_feed_pause: { label: 'Upload feed paused', tone: 'warning', route: '/console/import-history?tab=coverage' },
  upload_feed_resume: { label: 'Upload feed resumed', tone: 'info', route: '/console/import-history?tab=coverage' },
  classifier_accept: { label: 'Classifier rule learned', tone: 'info', route: '/console/classification-learning?tab=rules' },
  classifier_reject: { label: 'Classifier word ruled out', tone: 'info', route: '/console/classification-learning?tab=rules' },
  classifier_retire: { label: 'Classifier rule retired', tone: 'warning', route: '/console/classification-learning?tab=rules' },
  classifier_reapply: { label: 'Classifier rule applied again', tone: 'info', route: '/console/classification-learning?tab=rules' },
  learn_confirm: { label: 'Tyre fact learned', tone: 'info', route: '/console/data-learning?tab=rules' },
  learn_undo: { label: 'Tyre learning batch undone', tone: 'warning', route: '/console/data-learning?tab=history' },
  learn_rule_off: { label: 'Tyre learning rule turned off', tone: 'warning', route: '/console/data-learning?tab=rules' },
  learn_rule_on: { label: 'Tyre learning rule turned on', tone: 'info', route: '/console/data-learning?tab=rules' },
})

export const DATA_ACTION_KEYS = Object.freeze(Object.keys(DATA_ACTIONS))

/** Shape console_sessions rows into feed items, newest first. Unknown actions are dropped. */
export function shapeDataActivity(rows = [], names = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && DATA_ACTIONS[r.action])
    .map((r) => {
      const meta = DATA_ACTIONS[r.action]
      const d = r.details && typeof r.details === 'object' ? r.details : {}
      return {
        id: r.id,
        action: r.action,
        label: meta.label,
        tone: meta.tone,
        route: meta.route,
        at: r.created_at || null,
        who: names[r.admin_id] || 'A super admin',
        target: r.target_type || null,
        reason: typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim() : null,
        detail: activityDetail(d),
      }
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

function activityDetail(d) {
  const parts = []
  if (num(d.deleted) != null) parts.push(`${num(d.deleted).toLocaleString('en-US')} rows deleted`)
  if (num(d.restored) != null) parts.push(`${num(d.restored).toLocaleString('en-US')} rows put back`)
  if (num(d.rows) != null) parts.push(`${num(d.rows).toLocaleString('en-US')} rows`)
  if (num(d.count) != null) parts.push(`${num(d.count).toLocaleString('en-US')} items`)
  if (num(d.filled) != null) parts.push(`${num(d.filled).toLocaleString('en-US')} rows filled`)
  if (d.country) parts.push(String(d.country))
  if (d.before) parts.push(`before ${d.before}`)
  return parts.join(', ') || null
}

/** Count the feed by tone so the strip can say how many risky changes happened. */
export function activityCounts(items = [], sinceMs = null) {
  const out = { total: 0, danger: 0, warning: 0 }
  for (const it of items) {
    if (sinceMs != null) {
      const t = it.at ? Date.parse(it.at) : NaN
      if (!Number.isFinite(t) || t < sinceMs) continue
    }
    out.total += 1
    if (it.tone === 'danger') out.danger += 1
    if (it.tone === 'warning') out.warning += 1
  }
  return out
}

/* ── Duplicate Control: scan every table ─────────────────────────────────── */

/**
 * Combine per-table previews into one overview. Row counts add across tables
 * (they are counts); money is kept per table and per the single country it was
 * read for, never summed across currencies.
 *
 * @param {Array<{target:{key,label,tbl,kind}, preview?:object, error?:string}>} results
 * @param {string|null} country  the one country scanned, or null for all
 */
export function scanAllSummary(results = [], country = null) {
  const currency = country ? COUNTRY_CURRENCY[country] || null : null
  const rows = (Array.isArray(results) ? results : []).map((r) => {
    const p = r?.preview || null
    const deletable = p ? num(p.extra_deletable) : null
    const protectedRows = p ? num(p.extra_protected) : null
    const money = p && r.target?.kind === 'money' && country ? num(p.money_deletable) : null
    return {
      key: r?.target?.key,
      label: r?.target?.label || r?.target?.key || 'Unknown',
      tbl: r?.target?.tbl || null,
      kind: r?.target?.kind || null,
      deletable,
      protectedRows,
      money,
      currency: money != null ? currency : null,
      error: r?.error || null,
    }
  })
  const ok = rows.filter((r) => !r.error)
  const deletable = ok.reduce((a, r) => a + (r.deletable || 0), 0)
  const protectedRows = ok.reduce((a, r) => a + (r.protectedRows || 0), 0)
  const money = country ? ok.reduce((a, r) => a + (r.money || 0), 0) : null
  return {
    rows: rows.sort((a, b) => (b.deletable || 0) - (a.deletable || 0)),
    tablesScanned: ok.length,
    tablesFailed: rows.length - ok.length,
    tablesWithDuplicates: ok.filter((r) => (r.deletable || 0) > 0).length,
    deletable,
    protectedRows,
    money,
    currency: country ? currency : null,
  }
}

/* ── Data Learning: change history by batch ──────────────────────────────── */

/**
 * Group tyre_learn_apply_log rows into one entry per batch, newest first.
 * The log holds one row per changed tyre record.
 */
export function groupLearnBatches(rows = [], factsById = {}) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.batch_id) continue
    let b = map.get(r.batch_id)
    if (!b) {
      b = { batchId: r.batch_id, rows: 0, fields: new Set(), factIds: new Set(), first: r.created_at, last: r.created_at, sample: null }
      map.set(r.batch_id, b)
    }
    b.rows += 1
    if (r.target_field) b.fields.add(r.target_field)
    if (r.fact_id) b.factIds.add(r.fact_id)
    if (r.created_at && (!b.first || r.created_at < b.first)) b.first = r.created_at
    if (r.created_at && (!b.last || r.created_at > b.last)) b.last = r.created_at
    if (!b.sample && (r.old_value != null || r.new_value != null)) b.sample = { from: r.old_value ?? null, to: r.new_value ?? null }
  }
  return [...map.values()]
    .map((b) => {
      const facts = [...b.factIds].map((id) => factsById[id]).filter(Boolean)
      return {
        batchId: b.batchId,
        rows: b.rows,
        fields: [...b.fields],
        at: b.last || b.first || null,
        rule: facts[0] ? `${facts[0].match_value} -> ${facts[0].target_value}` : null,
        sample: b.sample,
      }
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

/* ── Data Cleanup: run history and retention ─────────────────────────────── */

/** system_logs rows written by admin_data_cleanup_run, shaped for a table. */
export function shapeCleanupRuns(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const d = r?.detail && typeof r.detail === 'object' ? r.detail : {}
    return {
      id: r.id,
      at: r.created_at || null,
      key: d.key || null,
      table: d.table || null,
      before: d.before || null,
      deleted: num(d.deleted),
      snapshot: d.snapshot || null,
      message: r.message || null,
    }
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

/**
 * Read the retention switches out of system_config rows. Values are text in
 * the table; a blank or junk value is unknown (null), not zero.
 */
export function readRetention(configRows = []) {
  const get = (k) => (Array.isArray(configRows) ? configRows : []).find((r) => r?.key === k)?.value
  const intOrNull = (v) => {
    const s = typeof v === 'string' ? v.replace(/"/g, '').trim() : v
    const n = num(s)
    return n == null ? null : Math.trunc(n)
  }
  const dual = get('dual_control_enabled')
  return {
    auditRetentionDays: intOrNull(get('audit_retention_days')),
    dataRetentionMonths: intOrNull(get('data_retention_months')),
    dualControl: dual == null ? null : String(dual).replace(/"/g, '').trim() === 'true',
  }
}

/* ── Import History: date window ─────────────────────────────────────────── */

/** Keep uploads whose uploaded_at falls in [from, to] (YYYY-MM-DD, both inclusive). */
export function filterByDateWindow(rows = [], from = '', to = '', field = 'uploaded_at') {
  if (!from && !to) return Array.isArray(rows) ? rows : []
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    const v = r?.[field]
    if (!v) return false
    const day = String(v).slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })
}

/* ── Data Operations: recently opened tools ──────────────────────────────── */

/** Move `route` to the front of the recents list, without duplicates, capped. */
export function pushRecent(list = [], route, max = 6) {
  if (!route) return Array.isArray(list) ? list.slice(0, max) : []
  const rest = (Array.isArray(list) ? list : []).filter((r) => r !== route)
  return [route, ...rest].slice(0, max)
}

/** Validate a reason typed into a confirm dialog (same rule as ConfirmImpactDialog). */
export function reasonOk(reason) {
  return typeof reason === 'string' && reason.trim().length >= 3
}
