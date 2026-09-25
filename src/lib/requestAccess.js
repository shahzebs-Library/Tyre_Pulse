/**
 * Requester side of just-in-time (JIT) elevation - pure helpers for
 * src/pages/RequestAccess.jsx. The rules themselves (duration, reason,
 * capability, status machine) live in ./jitElevation.js and are MIRRORED by the
 * server (supabase/migrations/20260924116000_jit_elevation.sql); this file only
 * shapes them for the person asking. No I/O.
 */
import { MODULE_GROUPS } from './moduleCatalog'
import { effectiveStatus, remainingMs } from './jitElevation'

/**
 * Grouped module choices for the request form, taken from the curated catalog
 * (its keys are the stable module_permissions keys the server validates).
 * @returns {{group:string, modules:{key:string,label:string}[]}[]}
 */
export function moduleOptions(groups = MODULE_GROUPS) {
  return (groups || [])
    .map((g) => ({
      group: g.group,
      modules: (g.modules || [])
        .filter((m) => m && /^[a-z0-9_:-]{1,80}$/.test(String(m.key)))
        .map((m) => ({ key: m.key, label: m.label || m.key })),
    }))
    .filter((g) => g.modules.length > 0)
}

/** Requester-facing status vocabulary. 'approved' is shown as 'active' while it runs. */
export const REQUESTER_STATUS_META = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  active: { label: 'Active', tone: 'good' },
  denied: { label: 'Denied', tone: 'danger' },
  expired: { label: 'Expired', tone: 'quiet' },
  revoked: { label: 'Revoked early', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
  lapsed: { label: 'Not decided in time', tone: 'quiet' },
}

/**
 * The status as the requester should read it. An approved row that is still
 * inside its window is 'active'; past expiry it is 'expired' even before the
 * 5-minute sweep flips the stored status (the grant is already ignored then).
 */
export function requesterStatus(row, now = Date.now()) {
  if (!row) return null
  const s = effectiveStatus(row, now)
  if (s === 'approved') return 'active'
  return s
}

/** Only a still-waiting request can be withdrawn (the server enforces the same). */
export function canCancel(row, now = Date.now()) {
  return requesterStatus(row, now) === 'pending'
}

/** Headline counts for the requester's own list. */
export function summarizeMine(rows = [], now = Date.now()) {
  const out = { total: 0, pending: 0, active: 0, denied: 0, ended: 0 }
  for (const r of rows || []) {
    out.total += 1
    const s = requesterStatus(r, now)
    if (s === 'pending') out.pending += 1
    else if (s === 'active') out.active += 1
    else if (s === 'denied') out.denied += 1
    else out.ended += 1
  }
  return out
}

/** Would the server refuse this account outright? Returns a plain reason or null. */
export function ineligibleReason(profile, isSuperAdmin) {
  if (!profile) return 'Sign in to request access.'
  if (isSuperAdmin) return 'Super admins already hold every capability, so there is nothing to request.'
  if (profile.role === 'Admin') return 'Admins already hold every module capability, so there is nothing to request.'
  if (profile.approved === false) return 'Your account must be approved before you can request access.'
  if (profile.locked === true) return 'This account is locked. Contact an administrator.'
  return null
}

/** Minutes left on an active elevation, rounded up, or null. */
export function minutesLeft(row, now = Date.now()) {
  const ms = remainingMs(row, now)
  if (ms === null) return null
  return Math.ceil(ms / 60000)
}
