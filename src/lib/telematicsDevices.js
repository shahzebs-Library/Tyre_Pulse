/**
 * Telematics devices — pure, dependency-free domain logic for the Telematics
 * Device Registry module (/telematics-devices).
 *
 * Keeping status/online logic and aggregation here (no Supabase, no React)
 * makes them unit-testable and reusable across the service layer, the page and
 * any future ingestion/heartbeat pipeline. The service
 * (`src/lib/api/telematicsDevices.js`) and page (`src/pages/TelematicsDevices.jsx`)
 * both build on these primitives. Mirrors geofences.js / tyreAge.js.
 */

/** Canonical device statuses (mirrors the CHECK constraint in V147). */
export const DEVICE_STATUSES = ['active', 'offline', 'decommissioned']

export const DEVICE_STATUS_META = {
  active: { label: 'Active', tint: 'text-emerald-400', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  offline: { label: 'Offline', tint: 'text-amber-400', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  decommissioned: { label: 'Decommissioned', tint: 'text-[var(--text-dim)]', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}

/** Default freshness window (hours) after which a device is considered offline. */
export const DEFAULT_ONLINE_THRESHOLD_HOURS = 24

/** Parse a value to a valid Date, or null when it isn't a usable timestamp. */
export function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Is a device "online" as of `now`? A device counts as online when its
 * `last_seen_at` falls within `thresholdHours` of the reference clock and it is
 * not decommissioned. `now` is injected (ms or Date) so the function stays pure
 * and deterministic under test.
 */
export function deviceOnline(device, now, thresholdHours = DEFAULT_ONLINE_THRESHOLD_HOURS) {
  if (!device || device.status === 'decommissioned') return false
  const seen = toDate(device.last_seen_at)
  if (!seen) return false
  const ref = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(ref.getTime())) return false
  const hours = Number.isFinite(thresholdHours) && thresholdHours > 0 ? thresholdHours : DEFAULT_ONLINE_THRESHOLD_HOURS
  const deltaMs = ref.getTime() - seen.getTime()
  // A future last_seen (clock skew) still counts as a recent contact.
  if (deltaMs < 0) return true
  return deltaMs <= hours * 3600 * 1000
}

/** Hours since a device was last seen (1 decimal), or null when never seen. */
export function hoursSinceSeen(device, now) {
  const seen = toDate(device?.last_seen_at)
  if (!seen) return null
  const ref = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(ref.getTime())) return null
  const hours = (ref.getTime() - seen.getTime()) / (3600 * 1000)
  if (hours < 0) return 0
  return Math.round(hours * 10) / 10
}

/**
 * Aggregate a set of device rows for the KPI header: counts by status, an
 * online/offline split (from `deviceOnline`), the number of distinct assets
 * covered, and how many devices have never reported in. `now` is injected so
 * the summary is deterministic. `thresholdHours` tunes the freshness window.
 */
export function summarizeDevices(rows = [], now, thresholdHours = DEFAULT_ONLINE_THRESHOLD_HOURS) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, offline: 0, decommissioned: 0 }
  let online = 0
  let offline = 0
  let neverSeen = 0
  const assets = new Set()

  for (const r of list) {
    const status = DEVICE_STATUSES.includes(r?.status) ? r.status : 'active'
    byStatus[status] += 1

    if (deviceOnline(r, now, thresholdHours)) online += 1
    else offline += 1

    if (!toDate(r?.last_seen_at)) neverSeen += 1

    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
  }

  return {
    total: list.length,
    byStatus,
    online,
    offline,
    neverSeen,
    assetsCovered: assets.size,
    unassigned: list.length - list.filter((r) => r?.asset_no != null && String(r.asset_no).trim()).length,
  }
}
