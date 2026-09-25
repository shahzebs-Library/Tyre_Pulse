/**
 * Console known devices: new-IP / new-device sign-in alerts.
 * Migration: supabase/migrations/20260924123000_console_new_device_alerts.sql.
 *
 * recordConsoleLoginDevice - called after a successful console sign-in. The
 *   server reads the IP and user agent from the request headers itself; the
 *   values passed here are only a fallback. Best-effort: it NEVER throws and
 *   never blocks a sign-in.
 * listKnownDevices / forgetKnownDevice - super-admin RPCs for the Sessions page.
 * Pure helpers (normalizeKnownDevice, summarizeKnownDevices, deviceLabel) hold
 * the display logic so it is unit tested without a database.
 */
import { supabase, unwrap } from './_client'

/** Record this console sign-in. Resolves to the server result or null; never throws. */
export async function recordConsoleLoginDevice(userAgent) {
  try {
    const ua = typeof userAgent === 'string'
      ? userAgent
      : (typeof navigator !== 'undefined' ? navigator.userAgent : null)
    const { data, error } = await supabase.rpc('console_record_login_device', {
      p_ip: null,
      p_user_agent: ua ? String(ua).slice(0, 512) : null,
    })
    if (error || !data || typeof data !== 'object') return null
    return data
  } catch {
    return null
  }
}

/** A friendly short name for a user-agent string. */
export function deviceLabel(ua) {
  const s = String(ua || '').trim()
  if (!s || s.toLowerCase() === 'unknown') return 'Unknown browser'
  const browser = /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
      : /Firefox\//.test(s) ? 'Firefox'
        : /Chrome\//.test(s) ? 'Chrome'
          : /Safari\//.test(s) ? 'Safari'
            : null
  const os = /Windows/.test(s) ? 'Windows'
    : /Android/.test(s) ? 'Android'
      : /iPhone|iPad|iPod/.test(s) ? 'iOS'
        : /Mac OS X|Macintosh/.test(s) ? 'macOS'
          : /Linux/.test(s) ? 'Linux'
            : null
  if (browser && os) return `${browser} on ${os}`
  if (browser || os) return browser || os
  return s.length > 40 ? `${s.slice(0, 40)}...` : s
}

/** Shape one row from console_list_known_devices(). Returns null for junk. */
export function normalizeKnownDevice(row) {
  if (!row || typeof row !== 'object' || !row.id) return null
  const count = Number(row.login_count)
  return {
    id: String(row.id),
    adminId: row.admin_id || null,
    adminName: row.admin_name || 'Unknown admin',
    ip: row.ip || null,
    ipSource: ['header', 'client', 'unknown'].includes(row.ip_source) ? row.ip_source : 'unknown',
    userAgent: row.ua_label || null,
    device: deviceLabel(row.ua_label),
    firstSeen: row.first_seen || null,
    lastSeen: row.last_seen || null,
    loginCount: Number.isFinite(count) && count > 0 ? count : 0,
  }
}

/** Counts for the panel header. `now` is injectable for tests. */
export function summarizeKnownDevices(devices, now = Date.now()) {
  const list = Array.isArray(devices) ? devices.filter(Boolean) : []
  const admins = new Set(list.map((d) => d.adminId).filter(Boolean))
  const ips = new Set(list.map((d) => d.ip).filter(Boolean))
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const newThisWeek = list.filter((d) => {
    const t = d.firstSeen ? new Date(d.firstSeen).getTime() : NaN
    return Number.isFinite(t) && t >= weekAgo
  }).length
  const unverifiedIp = list.filter((d) => d.ipSource !== 'header').length
  return { total: list.length, admins: admins.size, ips: ips.size, newThisWeek, unverifiedIp }
}

export async function listKnownDevices() {
  const raw = unwrap(await supabase.rpc('console_list_known_devices'))
  return (Array.isArray(raw) ? raw : []).map(normalizeKnownDevice).filter(Boolean)
}

export async function forgetKnownDevice(id) {
  const res = unwrap(await supabase.rpc('console_forget_device', { p_id: id }))
  if (res && res.ok === false) throw new Error('That device was already removed.')
  return res
}
