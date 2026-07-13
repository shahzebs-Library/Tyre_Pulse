/**
 * Notification Preferences service — the single seam between the Settings page's
 * Notifications section and Supabase (table `notification_preferences`, V204).
 * One row per user, keyed by the authenticated user's id. Explicit column list
 * (least-privilege selects), coerced booleans and validated enums on write.
 * RLS enforces "each user manages only their own row" plus org isolation; this
 * layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js / alertThresholds.js. A missing
 * `notification_preferences` relation (org has not run the migration) degrades
 * reads to the DEFAULT_PREFS shape so the page renders its controls instead of
 * erroring.
 */
import { supabase, unwrap } from './_client'
import {
  DEFAULT_PREFS,
  DIGEST_FREQUENCIES,
  PRIORITY_ORDER,
} from '../notificationPrefs'

export const COLS =
  'user_id,organisation_id,channel_in_app,channel_email,channel_push,' +
  'channel_whatsapp,channel_sms,channel_slack,channel_teams,' +
  'quiet_start,quiet_end,timezone,digest_frequency,min_priority,updated_at'

/** Boolean channel columns, coerced on write. */
const CHANNEL_COLS = [
  'channel_in_app',
  'channel_email',
  'channel_push',
  'channel_whatsapp',
  'channel_sms',
  'channel_slack',
  'channel_teams',
]

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('notification_preferences'))
  )
}

/** Normalise a value to a boolean (accepts true/'true'/1/'1'/'on'). */
function asBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return ['true', '1', 'on', 'yes'].includes(v.trim().toLowerCase())
  return false
}

/** Keep a value only if it is one of `allowed`, else return `fallback`. */
function asEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback
}

/** Normalise an HH:MM[:SS] time string, or null when blank/invalid. */
function asTime(v) {
  if (v == null || v === '') return null
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = m[3] != null ? Number(m[3]) : 0
  if (h > 23 || min > 59 || sec > 59) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(min)}:${pad(sec)}`
}

/** Get the signed-in user's id, or null when there is no session. */
async function currentUserId() {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data?.user?.id ?? null
}

/**
 * The current user's notification preferences. Returns a DEFAULT_PREFS-shaped
 * object (with the resolved `user_id`) when the user has no stored row yet, or
 * when the table has not been provisioned. Never returns null so the UI always
 * has a complete shape to bind to.
 *
 * @returns {Promise<object>}
 */
export async function getMyPreferences() {
  const userId = await currentUserId()
  if (!userId) return { ...DEFAULT_PREFS, user_id: null }
  try {
    const row = unwrap(
      await supabase
        .from('notification_preferences')
        .select(COLS)
        .eq('user_id', userId)
        .maybeSingle(),
    )
    if (!row) return { ...DEFAULT_PREFS, user_id: userId }
    return row
  } catch (err) {
    if (isMissingRelation(err)) return { ...DEFAULT_PREFS, user_id: userId }
    throw err
  }
}

/**
 * Upsert the current user's preferences. Only recognised fields present in the
 * patch are written; each is coerced/validated so the stored value never drifts
 * from the shape the DB CHECK constraints allow. Upserts on the `user_id`
 * primary key so a first save inserts and subsequent saves update in place.
 *
 * @param {object} patch  partial preference values from the form
 * @returns {Promise<object>} the persisted row
 */
export async function upsertMyPreferences(patch = {}) {
  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in to save notification preferences.')

  const payload = { user_id: userId }

  for (const col of CHANNEL_COLS) {
    if (patch[col] !== undefined) payload[col] = asBool(patch[col])
  }
  if (patch.quiet_start !== undefined) payload.quiet_start = asTime(patch.quiet_start)
  if (patch.quiet_end !== undefined) payload.quiet_end = asTime(patch.quiet_end)
  if (patch.timezone !== undefined) {
    payload.timezone = patch.timezone ? String(patch.timezone).trim().slice(0, 64) : null
  }
  if (patch.digest_frequency !== undefined) {
    payload.digest_frequency = asEnum(patch.digest_frequency, DIGEST_FREQUENCIES, 'none')
  }
  if (patch.min_priority !== undefined) {
    payload.min_priority = asEnum(patch.min_priority, PRIORITY_ORDER, 'low')
  }

  return unwrap(
    await supabase
      .from('notification_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select(COLS)
      .single(),
  )
}
