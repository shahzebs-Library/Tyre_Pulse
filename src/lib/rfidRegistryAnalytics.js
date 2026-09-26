/**
 * RFID Registry analytics (pure, no I/O) behind /rfid-registry.
 *
 * Distinct from src/lib/rfid.js, which serves the simpler /rfid register on a
 * different table. This engine reads the V122/V132 schema: rfid_tags,
 * rfid_readers, rfid_alerts and rfid_read_events.
 *
 * Honesty: shares with an empty denominator are null (N/A), never 0% or 100%;
 * a reader with no heartbeat is "never reported", not "offline for 0 hours".
 * `now` is injectable so every time-based figure is deterministic in tests.
 */

export const TAG_STATUSES = ['available', 'assigned', 'attached', 'removed', 'lost', 'damaged']
export const TAG_STATUS_LABEL = {
  available: 'Available', assigned: 'Assigned', attached: 'Attached',
  removed: 'Removed', lost: 'Lost', damaged: 'Damaged',
}
export const ALERT_SEVERITIES = ['critical', 'high', 'medium', 'low']
export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
/** A reader silent for longer than this is treated as stale. */
export const READER_STALE_HOURS = 24

const HOUR_MS = 3600000
const lc = (v) => String(v ?? '').toLowerCase()
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)
const timeOf = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Human label for an alert type token ("tag_not_seen" -> "Tag not seen"). */
export function alertTypeLabel(type) {
  const s = String(type ?? '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A'
}

/** Signal band for a read RSSI in dBm; null when not recorded. */
export function rssiBand(rssi) {
  const n = rssi == null || rssi === '' ? null : Number(rssi)
  if (n == null || !Number.isFinite(n)) return null
  if (n > -50) return { key: 'strong', label: 'Strong' }
  if (n > -70) return { key: 'fair', label: 'Fair' }
  return { key: 'weak', label: 'Weak' }
}

/** Hours since a reader last reported; null when it never has. */
export function readerSilenceHours(reader, now = new Date()) {
  const t = timeOf(reader?.last_heartbeat)
  if (t == null) return null
  return Math.max(0, Math.round(((now.getTime() - t) / HOUR_MS) * 10) / 10)
}

/** Reader health: 'online' | 'stale' | 'never' | 'inactive'. */
export function readerHealth(reader, now = new Date()) {
  if (lc(reader?.status) && lc(reader.status) !== 'active') return 'inactive'
  const h = readerSilenceHours(reader, now)
  if (h == null) return 'never'
  return h > READER_STALE_HOURS ? 'stale' : 'online'
}
export const READER_HEALTH_LABEL = { online: 'Online', stale: 'Stale', never: 'Never reported', inactive: 'Not active' }

/** Headline KPIs across all four feeds. */
export function summarizeRfidRegistry({ tags = [], readers = [], alerts = [], now = new Date() } = {}) {
  const byStatus = Object.fromEntries(TAG_STATUSES.map((s) => [s, 0]))
  for (const t of tags) if (byStatus[t?.status] != null) byStatus[t.status] += 1
  const open = alerts.filter((a) => !a?.resolved_at)
  const bySeverity = Object.fromEntries(ALERT_SEVERITIES.map((s) => [s, 0]))
  for (const a of open) if (bySeverity[a?.severity] != null) bySeverity[a.severity] += 1
  const health = { online: 0, stale: 0, never: 0, inactive: 0 }
  for (const r of readers) health[readerHealth(r, now)] += 1
  const linked = tags.filter((t) => t?.tyre_record_id || t?.tyre_records?.id).length
  return {
    totalTags: tags.length,
    byStatus,
    lostOrDamaged: byStatus.lost + byStatus.damaged,
    attachedPct: pct(byStatus.attached, tags.length),
    linkedToTyre: linked,
    linkedPct: pct(linked, tags.length),
    totalReaders: readers.length,
    activeReaders: readers.filter((r) => lc(r?.status) === 'active').length,
    readerHealth: health,
    alertsOpen: open.length,
    alertsToday: open.filter((a) => { const t = timeOf(a?.created_at); return t != null && sameDay(new Date(t), now) }).length,
    criticalOpen: bySeverity.critical,
    openBySeverity: bySeverity,
    alertsResolved: alerts.length - open.length,
  }
}

/** Distinct sorted non-blank values of a field. */
export function distinctValues(rows = [], pick) {
  const set = new Set()
  for (const r of rows) { const v = String(pick(r) ?? '').trim(); if (v) set.add(v) }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Tag inventory filter: free text + status + site. */
export function filterTags(tags = [], { search = '', status = 'all', site = 'all' } = {}) {
  const q = lc(search).trim()
  return tags.filter((t) => {
    if (status !== 'all' && t?.status !== status) return false
    if (site !== 'all' && t?.site !== site) return false
    if (!q) return true
    return [t?.tag_uid, t?.tag_epc, t?.manufacturer, t?.tyre_records?.serial_no, t?.tyre_records?.asset_no, t?.asset_no, t?.site]
      .some((v) => lc(v).includes(q))
  })
}

/** Reader filter: free text (name / zone / site / uid) + health. */
export function filterReaders(readers = [], { search = '', health = 'all', now = new Date() } = {}) {
  const q = lc(search).trim()
  return readers.filter((r) => {
    if (health !== 'all' && readerHealth(r, now) !== health) return false
    if (!q) return true
    return [r?.name, r?.zone_name, r?.site, r?.reader_uid, r?.location].some((v) => lc(v).includes(q))
  })
}

/** Alert filter: open/all scope + severity + free text; newest first. */
export function filterAlerts(alerts = [], { scope = 'open', severity = 'all', search = '' } = {}) {
  const q = lc(search).trim()
  return alerts
    .filter((a) => {
      if (scope === 'open' && a?.resolved_at) return false
      if (severity !== 'all' && a?.severity !== severity) return false
      if (!q) return true
      return [a?.tag_uid, a?.rfid_tags?.tag_uid, a?.message, a?.alert_type, a?.current_zone].some((v) => lc(v).includes(q))
    })
    .sort((a, b) => (timeOf(b?.created_at) ?? 0) - (timeOf(a?.created_at) ?? 0))
}

/** The N most urgent open alerts: highest severity, then newest. */
export function topOpenAlerts(alerts = [], n = 5) {
  return alerts
    .filter((a) => !a?.resolved_at)
    .sort((a, b) => (SEVERITY_RANK[b?.severity] || 0) - (SEVERITY_RANK[a?.severity] || 0)
      || (timeOf(b?.created_at) ?? 0) - (timeOf(a?.created_at) ?? 0))
    .filter((_, i) => i < n)
}

/** Read-event filter: free text (tag / zone / site) + site. */
export function filterHistory(history = [], { search = '', site = 'all' } = {}) {
  const q = lc(search).trim()
  return history.filter((h) => {
    if (site !== 'all' && h?.site !== site) return false
    if (!q) return true
    return [h?.tag_uid, h?.zone_name, h?.rfid_readers?.zone_name, h?.rfid_readers?.name, h?.site].some((v) => lc(v).includes(q))
  })
}

/** Read counts per zone, busiest first (for the history chart). */
export function readsByZone(history = []) {
  const map = new Map()
  for (const h of history) {
    const z = String(h?.rfid_readers?.zone_name || h?.zone_name || '').trim() || 'Unzoned'
    map.set(z, (map.get(z) || 0) + (Number(h?.read_count) > 0 ? Number(h.read_count) : 1))
  }
  return [...map.entries()].map(([zone, reads]) => ({ zone, reads })).sort((a, b) => b.reads - a.reads)
}

/** Flat tag rows for the inventory table and export. */
export function tagRows(tags = []) {
  return tags.map((t) => ({
    id: t.id,
    tag_uid: t.tag_uid || null,
    tag_type: t.tag_type || null,
    manufacturer: t.manufacturer || null,
    serial: t.tyre_records?.serial_no || null,
    asset: t.tyre_records?.asset_no || t.asset_no || null,
    site: t.site || null,
    status: t.status || null,
    statusLabel: TAG_STATUS_LABEL[t.status] || t.status || 'N/A',
    last_seen_at: t.last_seen_at || null,
    lastSeenMs: timeOf(t.last_seen_at),
    raw: t,
  }))
}

/** Flat reader rows for the readers table and export. */
export function readerRows(readers = [], now = new Date()) {
  return readers.map((r) => {
    const health = readerHealth(r, now)
    return {
      id: r.id,
      name: r.name || null,
      zone: r.zone_name || null,
      zoneType: r.zone_type || null,
      type: r.reader_type || null,
      site: r.site || null,
      status: r.status || null,
      health,
      healthLabel: READER_HEALTH_LABEL[health],
      silenceHours: readerSilenceHours(r, now),
      last_heartbeat: r.last_heartbeat || null,
      firmware: r.firmware_version || null,
    }
  })
}

/** Flat alert rows for the alerts table and export. */
export function alertRows(alerts = []) {
  return alerts.map((a) => ({
    id: a.id,
    severity: a.severity || null,
    severityRank: SEVERITY_RANK[a.severity] || 0,
    tag_uid: a.tag_uid || a.rfid_tags?.tag_uid || null,
    type: alertTypeLabel(a.alert_type),
    message: a.message || null,
    zone: a.current_zone || null,
    created_at: a.created_at || null,
    createdMs: timeOf(a.created_at),
    resolved: !!a.resolved_at,
    state: a.resolved_at ? 'Resolved' : 'Open',
  }))
}

/** Flat read-event rows for the history table and export. */
export function historyRows(history = []) {
  return history.map((h, i) => {
    const band = rssiBand(h.rssi)
    return {
      id: h.id || `${h.tag_uid}-${h.read_at}-${i}`,
      read_at: h.read_at || null,
      readMs: timeOf(h.read_at),
      tag_uid: h.tag_uid || null,
      zone: h.rfid_readers?.zone_name || h.zone_name || null,
      reader: h.rfid_readers?.name || null,
      rssi: band ? Number(h.rssi) : null,
      rssiBand: band?.key || null,
      rssiLabel: band?.label || 'N/A',
      site: h.site || null,
    }
  })
}
