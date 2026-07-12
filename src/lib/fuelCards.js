/**
 * Fuel Cards — pure helpers (no I/O) for the Fuel Card Management module.
 * Card numbers are PII and are never rendered or exported in full; they are
 * masked to the last 4 digits. Expiry banding and fleet summaries live here so
 * the page and service consume a single, deterministic source of truth.
 *
 * These functions are unit-tested. Every time-dependent helper takes an injected
 * `now` so behaviour is deterministic and never reads the clock itself.
 */

export const FUEL_CARD_STATUSES = ['active', 'blocked', 'expired', 'unassigned']

export const FUEL_CARD_STATUS_META = {
  active: { label: 'Active', tone: 'green' },
  blocked: { label: 'Blocked', tone: 'red' },
  expired: { label: 'Expired', tone: 'slate' },
  unassigned: { label: 'Unassigned', tone: 'amber' },
}

export const EXPIRY_BANDS = ['expired', 'expiring', 'valid', 'unknown']

export const EXPIRY_BAND_META = {
  expired: { label: 'Expired', tone: 'red' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  valid: { label: 'Valid', tone: 'green' },
  unknown: { label: 'No expiry', tone: 'slate' },
}

// A card is "expiring soon" within this many days of its expiry date.
export const EXPIRY_SOON_DAYS = 30

/**
 * Mask a card number to its last 4 digits, e.g. "4321123456789012" →
 * "•••• 9012". Non-digit separators are ignored when extracting the tail. Short
 * or empty values degrade gracefully so nothing throws in a table cell.
 * @param {string|number} num
 * @returns {string}
 */
export function maskCardNumber(num) {
  if (num == null) return '—'
  const digits = String(num).replace(/\D/g, '')
  if (!digits) {
    const s = String(num).trim()
    return s ? `•••• ${s.slice(-4)}` : '—'
  }
  if (digits.length <= 4) return digits
  return `•••• ${digits.slice(-4)}`
}

/**
 * Classify a card by expiry against the injected reference clock. Returns one of
 * EXPIRY_BANDS plus the whole-day countdown (`days`, negative once expired).
 * `now` is injectable (ms or Date) so the result is deterministic.
 * @param {{ expiry_date?: string|null, status?: string }} card
 * @param {number|Date} now
 * @returns {{ band: string, days: number|null }}
 */
export function cardExpiryStatus(card, now) {
  const raw = card?.expiry_date || null
  if (!raw) return { band: 'unknown', days: null }
  const exp = new Date(raw)
  if (Number.isNaN(exp.getTime())) return { band: 'unknown', days: null }
  const ref = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(ref.getTime())) return { band: 'unknown', days: null }
  const MS_PER_DAY = 24 * 3600 * 1000
  const days = Math.floor((exp.getTime() - ref.getTime()) / MS_PER_DAY)
  if (days < 0) return { band: 'expired', days }
  if (days <= EXPIRY_SOON_DAYS) return { band: 'expiring', days }
  return { band: 'valid', days }
}

/** True when a card is assigned to a vehicle (asset) or a driver. */
export function isCardAssigned(card) {
  const asset = card?.asset_no != null && String(card.asset_no).trim() !== ''
  const driver = card?.driver_name != null && String(card.driver_name).trim() !== ''
  return asset || driver
}

/**
 * Summarise a set of fuel cards for the KPI header: counts by status, assigned
 * vs unassigned, and the total authorised monthly limit. Pure and deterministic.
 * @param {Array} rows
 * @returns {{ total:number, byStatus:Record<string,number>, active:number,
 *   assigned:number, unassigned:number, totalMonthlyLimit:number }}
 */
export function summarizeFuelCards(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, blocked: 0, expired: 0, unassigned: 0 }
  let assigned = 0
  let unassigned = 0
  let totalMonthlyLimit = 0
  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    if (isCardAssigned(r)) assigned += 1
    else unassigned += 1
    const limit = Number(r?.monthly_limit)
    if (Number.isFinite(limit)) totalMonthlyLimit += limit
  }
  return {
    total: list.length,
    byStatus,
    active: byStatus.active,
    assigned,
    unassigned,
    totalMonthlyLimit,
  }
}
