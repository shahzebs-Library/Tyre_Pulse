/**
 * Notification Preferences — pure, dependency-free domain logic for the §11
 * Notification engine's per-user preferences slice. No Supabase, no React, no
 * clock access: every time-dependent function takes the "now" value injected by
 * the caller, so the logic is fully deterministic and unit-testable.
 *
 * The service (`src/lib/api/notificationPreferences.js`) and the Settings page
 * build on these primitives so channel/quiet-hours/priority rules live in
 * exactly one place. A future deliverer can reuse the same functions to decide
 * whether (and how) to fan a notification out to a given user.
 */

/** Channel keys, in stable display order. Mirrors the DB `channel_*` columns. */
export const CHANNEL_KEYS = [
  'in_app',
  'email',
  'push',
  'whatsapp',
  'sms',
  'slack',
  'teams',
]

/** Priority order, ascending. Index = severity rank (low=0 … critical=3). */
export const PRIORITY_ORDER = ['low', 'normal', 'high', 'critical']

/** Digest cadences allowed by the DB CHECK constraint. */
export const DIGEST_FREQUENCIES = ['none', 'daily', 'weekly']

/**
 * Default preferences — the shape returned when a user has no stored row yet.
 * Matches the column defaults in MIGRATIONS_V204 exactly so the UI renders the
 * same values a fresh insert would produce.
 */
export const DEFAULT_PREFS = Object.freeze({
  channel_in_app: true,
  channel_email: true,
  channel_push: false,
  channel_whatsapp: false,
  channel_sms: false,
  channel_slack: false,
  channel_teams: false,
  quiet_start: null,
  quiet_end: null,
  timezone: null,
  digest_frequency: 'none',
  min_priority: 'low',
})

/**
 * Normalise a value to a minutes-since-midnight ordinal (0–1439), or null when
 * it is not a valid HH:MM[:SS] time. Accepts "22:00", "07:30:00", "9:5".
 * @param {string|null|undefined} hhmm
 * @returns {number|null}
 */
export function toMinutes(hhmm) {
  if (hhmm == null) return null
  const m = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Is the given time inside the user's quiet-hours window?
 *
 * Handles both same-day windows (e.g. 09:00–17:00) and wrap-around windows that
 * cross midnight (e.g. 22:00–07:00). The window is treated as [start, end):
 * start is inclusive, end is exclusive, so a boundary equal to `end` is NOT
 * quiet. When either bound is missing/invalid, there is no quiet window and this
 * returns false.
 *
 * @param {object} prefs  preference row (uses quiet_start / quiet_end)
 * @param {string} hhmm   the "now" time to test, as HH:MM (injected by caller)
 * @returns {boolean}
 */
export function isInQuietHours(prefs, hhmm) {
  const start = toMinutes(prefs?.quiet_start)
  const end = toMinutes(prefs?.quiet_end)
  const now = toMinutes(hhmm)
  if (start == null || end == null || now == null) return false
  // Empty window (start === end) means "no quiet hours".
  if (start === end) return false
  if (start < end) {
    // Same-day window: [start, end)
    return now >= start && now < end
  }
  // Wrap-around window crossing midnight: [start, 24:00) ∪ [00:00, end)
  return now >= start || now < end
}

/**
 * The list of enabled channel keys (subset of CHANNEL_KEYS), in display order.
 * @param {object} prefs
 * @returns {string[]}
 */
export function channelsEnabled(prefs) {
  const p = prefs || {}
  return CHANNEL_KEYS.filter((key) => p[`channel_${key}`] === true)
}

/**
 * Does a notification of the given priority meet the user's minimum-priority
 * threshold? Uses the low < normal < high < critical ordering. An unknown or
 * missing incoming priority defaults to the lowest rank; an unknown/missing
 * configured minimum defaults to 'low' (everything passes).
 *
 * @param {object} prefs     preference row (uses min_priority)
 * @param {string} priority  the incoming notification's priority
 * @returns {boolean}
 */
export function meetsPriority(prefs, priority) {
  const minIdx = PRIORITY_ORDER.indexOf(prefs?.min_priority)
  const floor = minIdx === -1 ? 0 : minIdx
  const incoming = PRIORITY_ORDER.indexOf(priority)
  const rank = incoming === -1 ? 0 : incoming
  return rank >= floor
}

/**
 * A compact, human-readable summary of a preference set, for display and logs.
 * Deterministic; performs no I/O.
 *
 * @param {object} prefs
 * @returns {{
 *   channels: string[], channelCount: number,
 *   digest: string, minPriority: string,
 *   quietHours: string|null, timezone: string|null
 * }}
 */
export function summarisePrefs(prefs) {
  const p = { ...DEFAULT_PREFS, ...(prefs || {}) }
  const channels = channelsEnabled(p)
  const start = toMinutes(p.quiet_start)
  const end = toMinutes(p.quiet_end)
  const quietHours =
    start != null && end != null && start !== end
      ? `${p.quiet_start}–${p.quiet_end}`
      : null
  return {
    channels,
    channelCount: channels.length,
    digest: DIGEST_FREQUENCIES.includes(p.digest_frequency) ? p.digest_frequency : 'none',
    minPriority: PRIORITY_ORDER.includes(p.min_priority) ? p.min_priority : 'low',
    quietHours,
    timezone: p.timezone || null,
  }
}
