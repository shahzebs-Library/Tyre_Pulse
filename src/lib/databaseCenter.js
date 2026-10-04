/**
 * databaseCenter.js - PURE helpers for the console Database Center
 * (/console/database). No I/O. Every figure the page shows is shaped here so
 * it can be tested, and every unknown comes back as null (rendered "N/A" with
 * a reason), never as a made-up zero.
 */

const MB = 1024 * 1024
const GB = MB * 1024

/** Binary sizes, matching what Postgres reports (2,331,298,963 B = 2,223 MB). */
export function fmtBytes(bytes, { digits } = {}) {
  const n = Number(bytes)
  if (bytes === null || bytes === undefined || !Number.isFinite(n)) return 'N/A'
  if (n < 1024) return `${n} B`
  if (n < MB) return `${(n / 1024).toFixed(digits ?? 1)} KB`
  if (n < GB) return `${(n / MB).toLocaleString('en-US', { minimumFractionDigits: digits ?? 1, maximumFractionDigits: digits ?? 1 })} MB`
  return `${(n / GB).toFixed(digits ?? 2)} GB`
}

export function fmtInt(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'N/A'
  return Number(v).toLocaleString('en-US')
}

export function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'N/A'
  return `${Number(v).toFixed(digits)}%`
}

/** "30 Sep" / "30 Sep 03:30" in Riyadh time, the owner's clock. */
export function fmtRiyadh(ts, { time = false, date = true } = {}) {
  if (!ts) return 'N/A'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'N/A'
  const opts = { timeZone: 'Asia/Riyadh' }
  if (date) Object.assign(opts, { day: '2-digit', month: 'short' })
  if (time) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false })
  return new Intl.DateTimeFormat('en-GB', opts).format(d)
}

/* ── tables ──────────────────────────────────────────────────────────────── */

export const TABLE_KINDS = {
  business: { label: 'Business data', tone: 'info' },
  log: { label: 'Log', tone: 'default' },
  loading: { label: 'Loading area', tone: 'warning' },
  safety: { label: 'Safety copy', tone: 'default' },
  system: { label: 'System', tone: 'quiet' },
}

const TABLE_DESCRIPTIONS = {
  audit_log_v2: 'Audit trail of every change',
  work_orders: 'Job cards',
  parts_consumption: 'Expense lines',
  production_logs: 'Concrete m3 per trip',
  ksa_country_upload_template_staging: 'KSA master file, loading area',
  uae_country_upload_template_staging: 'UAE file, loading area',
  egypt_country_upload_template_staging: 'Egypt file, loading area',
  work_order_line_items: 'Job card tasks',
  domain_events: 'Internal event bus',
  material_master: 'Item catalogue',
  tyre_records: 'Tyre fitments',
  inspections: 'Inspections',
  vehicle_fleet: 'Asset register',
  snapshot_tables: 'Nightly backup copies',
  brain_cache: 'Classifier cache',
  notifications: 'In-app notifications',
  console_sessions: 'Console audit log',
  system_logs: 'App error log',
  accidents: 'Accidents',
}

export function tableDescription(schema, name) {
  if (TABLE_DESCRIPTIONS[name]) return TABLE_DESCRIPTIONS[name]
  if (schema === '_bak' || /^_bucket_snapshot|_snapshot_/.test(name)) return 'Old safety copy'
  if (schema && schema !== 'public') return `${schema} schema`
  return ''
}

/** Which kind of table this is. Decided by name and schema only. */
export function tableKind(schema, name) {
  const n = String(name || '')
  if (schema === 'backups' || schema === '_bak' || /^_bucket_snapshot|_snapshot_|^_bak/.test(n)) return 'safety'
  if (/staging$|^stg_|_staging_|^expenses_(ksa|uae|egypt)$/.test(n)) return 'loading'
  if (/^audit|_log(_v\d+)?$|_logs?$|^domain_events$|_events$|^console_sessions$|^notifications$/.test(n) && n !== 'production_logs' && n !== 'odometer_logs' && n !== 'engine_hours_logs') return 'log'
  if (schema && !['public'].includes(schema)) return 'system'
  return 'business'
}

/**
 * Shape the overview table list: kind, description, share of the whole
 * database. Rows are the planner's size-scaled estimate and are marked so.
 */
export function shapeTables(tables, dbBytes) {
  const total = Number(dbBytes) || 0
  return (Array.isArray(tables) ? tables : []).map((t) => {
    const kind = tableKind(t.schema, t.name)
    return {
      key: `${t.schema}.${t.name}`,
      schema: t.schema,
      name: t.name,
      label: t.schema === 'public' ? t.name : `${t.schema}.${t.name}`,
      description: tableDescription(t.schema, t.name),
      kind,
      kindLabel: TABLE_KINDS[kind].label,
      kindTone: TABLE_KINDS[kind].tone,
      rows: t.rows == null ? null : Number(t.rows),
      bytes: Number(t.bytes) || 0,
      deadRows: Number(t.dead_rows) || 0,
      share: total ? (Number(t.bytes) || 0) / total * 100 : null,
    }
  })
}

/** "12 of 425 tables hold 73% of the space". */
export function concentration(shaped, tableCount, allBytes) {
  const rows = Array.isArray(shaped) ? shaped : []
  const top = rows.slice(0, 12)
  const topBytes = top.reduce((s, t) => s + t.bytes, 0)
  const all = Number(allBytes) || 0
  return {
    shown: top.length,
    tableCount: tableCount == null ? null : Number(tableCount),
    pct: all ? Math.round(topBytes / all * 100) : null,
  }
}

/* ── connections ─────────────────────────────────────────────────────────── */

export function connectionSummary(c) {
  if (!c) return null
  const total = Number(c.total) || 0
  const max = Number(c.max) || null
  const busy = Number(c.client_active) || 0
  const idle = Number(c.client_idle) || 0
  const background = Number(c.background) || 0
  const free = max == null ? null : Math.max(max - total, 0)
  const usedPct = max ? total / max * 100 : null
  const tone = usedPct == null ? 'default' : usedPct >= 90 ? 'danger' : usedPct >= 75 ? 'warning' : 'good'
  const label = usedPct == null ? 'Limit not readable' : usedPct >= 90 ? 'Nearly full' : usedPct >= 75 ? 'Getting busy' : 'Healthy'
  return { total, max, busy, idle, background, free, usedPct, tone, label }
}

/* ── where database time goes ───────────────────────────────────────────── */

const QUERY_LABELS = [
  [/wal->>|realtime\.list_changes|subscription_ids/i, 'Realtime change feed (reads the write log)'],
  [/^select set_config\(/i, 'Session setup on every API call'],
  [/base_types|pg_catalog\.pg_type|recurse as \(/i, 'Schema lookup by the API layer'],
  [/deliver_pending_webhooks/i, 'Webhook delivery job'],
  [/process_domain_events/i, 'Event bus processing job'],
  [/deliver_workflow_notifications/i, 'Workflow notification job'],
  [/net\.http_|net\._http/i, 'Outgoing web requests (pg_net)'],
  [/cron\.|job_run_details/i, 'Scheduled job bookkeeping'],
  [/get_parts_expense_snapshot/i, 'Expense report call'],
  [/get_cost_cpk_overview/i, 'Cost per km report call'],
  [/get_tyre_running_life/i, 'Tyre running life report call'],
  [/audit_log_v2/i, 'Audit trail write or read'],
]

/** Plain-English name for a query shape. The raw shape is kept for the detail view. */
export function queryLabel(shape) {
  const s = String(shape || '').trim()
  for (const [re, label] of QUERY_LABELS) if (re.test(s)) return label
  const rpc = s.match(/(?:select|from)\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/i)
  if (rpc && !/^(count|coalesce|jsonb_|json_|set_config|max|min|sum|array_agg)/i.test(rpc[1])) return `Report call: ${rpc[1].replace(/_/g, ' ')}`
  const tbl = s.match(/(?:from|into|update)\s+"?(?:public"?\.")?"?([a-z_][a-z0-9_]*)"?/i)
  if (tbl) {
    const verb = /^\s*(insert)/i.test(s) ? 'write' : /^\s*update/i.test(s) ? 'update' : /^\s*delete/i.test(s) ? 'delete' : 'read'
    return `${tbl[1].replace(/_/g, ' ')} ${verb}`
  }
  return 'Other database work'
}

export function shapeQueryTime(payload) {
  if (!payload || payload.ok === false) return { ok: false, rows: [], since: null, hotSpots: 0 }
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map((r) => ({
    id: String(r.id),
    label: queryLabel(r.shape),
    shape: r.shape || '',
    calls: Number(r.calls) || 0,
    totalMs: Number(r.total_ms) || 0,
    meanMs: r.mean_ms == null ? null : Number(r.mean_ms),
    share: r.share_pct == null ? null : Number(r.share_pct),
  }))
  // A hot spot: one shape taking a quarter or more of all time, or a very slow average.
  const hotSpots = rows.filter((r) => (r.share ?? 0) >= 25 || ((r.meanMs ?? 0) >= 1000 && r.calls >= 100)).length
  return { ok: true, rows, since: payload.since || null, hotSpots, totalMs: Number(payload.total_ms) || 0 }
}

/* ── freshness ───────────────────────────────────────────────────────────── */

const RARELY_CHANGES = new Set(['vehicle_fleet', 'accidents'])

/**
 * How recent the newest row is. Asset register and accidents change rarely
 * by nature, so their age is shown but never called silent.
 */
export function freshnessStatus(table, lastRowAt, now = new Date()) {
  if (!lastRowAt) return { tone: 'default', label: 'No rows', days: null }
  const t = new Date(lastRowAt).getTime()
  if (Number.isNaN(t)) return { tone: 'default', label: 'N/A', days: null }
  const days = Math.floor((now.getTime() - t) / 86400000)
  if (RARELY_CHANGES.has(table)) return { tone: 'default', label: days <= 0 ? 'Today' : 'changes rarely', days }
  if (days <= 0) return { tone: 'good', label: 'Today', days }
  if (days <= 3) return { tone: 'warning', label: `${days} ${days === 1 ? 'day' : 'days'}`, days }
  return { tone: 'danger', label: `${days} days silent`, days }
}

export function shapeFreshness(payload, now = new Date()) {
  const rows = (payload?.rows || []).map((r) => ({
    table: r.table,
    label: r.label,
    lastRowAt: r.last_row_at || null,
    unreadable: !!r.unreadable,
    ...(r.unreadable ? { tone: 'default', status: 'Not readable', days: null } : (() => {
      const s = freshnessStatus(r.table, r.last_row_at, now)
      return { tone: s.tone, status: s.label, days: s.days }
    })()),
  }))
  return { rows, silent: rows.filter((r) => r.tone === 'danger').length }
}

/* ── backups and recovery ────────────────────────────────────────────────── */

/**
 * One nightly copy. The listing returns one entry per stored chunk and the
 * work_orders entry of a skipped table still carries its row count, so a table
 * whose rows are missing from the snapshot total is reported as skipped.
 */
export function shapeSnapshot(s) {
  const tables = Array.isArray(s?.tables) ? s.tables : []
  const byTable = new Map()
  for (const t of tables) byTable.set(t.table_name, (byTable.get(t.table_name) || 0) + (Number(t.row_count) || 0))
  const sum = [...byTable.values()].reduce((a, b) => a + b, 0)
  const total = Number(s?.total_rows) || 0
  const skipped = []
  if (sum > total) {
    // The largest entry that does not fit the stored total is the skipped one.
    for (const [name, rows] of [...byTable.entries()].sort((a, b) => b[1] - a[1])) {
      if (sum - rows <= total + 0.5 && skipped.length === 0) { skipped.push({ table: name, rows }); break }
    }
  }
  return {
    id: s?.id,
    takenAt: s?.taken_at || null,
    reason: s?.reason || '',
    tableCount: byTable.size - skipped.length,
    totalRows: total,
    tables: [...byTable.entries()].map(([name, rows]) => ({ name, rows, skipped: skipped.some((k) => k.table === name) })),
    skipped,
  }
}

export function recoveryWindow(snapshots) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter((s) => s?.taken_at)
  if (!list.length) return { count: 0, first: null, last: null }
  const times = list.map((s) => new Date(s.taken_at).getTime()).sort((a, b) => a - b)
  return { count: list.length, first: new Date(times[0]).toISOString(), last: new Date(times[times.length - 1]).toISOString() }
}

/** "Every day at 00:30 UTC" read from the cron schedule, shown in Riyadh time. */
export function cronToRiyadh(schedule) {
  const m = String(schedule || '').trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/)
  if (!m) return null
  const mins = Number(m[1]); const hours = (Number(m[2]) + 3) % 24
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} Riyadh`
}

/* ── trust scores ────────────────────────────────────────────────────────── */

export function trustTone(score) {
  if (score == null) return { tone: 'default', label: 'N/A' }
  if (score >= 65) return { tone: 'good', label: 'Good' }
  if (score >= 50) return { tone: 'warning', label: 'Fair' }
  return { tone: 'danger', label: 'Weak' }
}

/** Days since a timestamp, or null. */
export function daysSince(ts, now = new Date()) {
  if (!ts) return null
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86400000)
}

/** Migration version 20260930080638 as "30 Sep 11:06" Riyadh. */
export function migrationTime(version) {
  const m = String(version || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (!m) return 'N/A'
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`
  return fmtRiyadh(iso, { time: true })
}
