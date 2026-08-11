import { supabase, applyCountry } from './_client'
import { resolveDefaultPeriod } from '../defaultPeriod'

/**
 * The newest row date a feed holds - one row read, so a screen can pick an
 * honest opening period without loading the feed first.
 *
 * This exists because the alternative is worse in both directions: opening on
 * all of history is the slowness being fixed, and opening blindly on the current
 * month shows an empty page for the feeds that arrive in monthly uploads.
 *
 * Never throws. A feed we could not read resolves to the current month, which is
 * the same behaviour as before this existed.
 */

/** The date column each feed is judged by - the BUSINESS date, not insert time. */
export const FEED_DATE_COLUMN = {
  parts_consumption: 'event_date',
  work_orders: 'opened_at',
  work_order_line_items: 'created_at',
  tyre_records: 'issue_date',
  inspections: 'inspection_date',
  accidents: 'incident_date',
  production_logs: 'period_date',
  checklist_submissions: 'submitted_at',
  odometer_logs: 'reading_date',
  engine_hours_logs: 'reading_date',
  wash_records: 'wash_date',
}

/**
 * Newest business date on a table, scoped to the caller's country the same way
 * every other read is. Returns null when it cannot be read - the caller then
 * treats the feed as unknown rather than as empty.
 *
 * @param {string} table
 * @param {object} [opts]
 * @param {string} [opts.country]
 * @param {string} [opts.dateColumn] override when a caller uses a different date
 * @returns {Promise<string|null>}
 */
export async function getLatestActivity(table, { country, dateColumn } = {}) {
  const col = dateColumn || FEED_DATE_COLUMN[table]
  if (!col) return null
  try {
    let q = supabase.from(table).select(col)
    q = applyCountry(q, country)
    const { data, error } = await q.order(col, { ascending: false, nullsFirst: false }).limit(1)
    if (error) return null
    const v = Array.isArray(data) && data.length ? data[0]?.[col] : null
    return v ? String(v).slice(0, 10) : null
  } catch {
    return null
  }
}

/**
 * The period a screen should open on for one feed, resolved against real data.
 * Convenience wrapper: one read, then the pure rule.
 */
export async function defaultPeriodFor(table, { country, dateColumn, now } = {}) {
  const latest = await getLatestActivity(table, { country, dateColumn })
  return resolveDefaultPeriod({ latest, now })
}
