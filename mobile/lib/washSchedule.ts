/**
 * washSchedule - pure "due for wash again" logic.
 *
 * Vehicles are washed on a rolling interval. Given the wash history, this
 * derives which assets are due again (latest wash + interval has passed) so the
 * washing screen can surface a "Due for wash" list and fire a local reminder.
 *
 * Pure and deterministic (no I/O, no Date.now() unless `now` is omitted), so it
 * is trivially testable and shares one definition of "due" across the UI and the
 * notification path. There is NO server cron - the reminder is a local
 * notification driven by this list.
 */

/** Default wash cadence, in days. One place; referenced by the screen + tests. */
export const WASH_INTERVAL_DAYS = 7

export interface WashHistoryRecord {
  asset_no: string | null
  wash_date: string | null
  site?: string | null
  vehicle_type?: string | null
}

export interface WashDueEntry {
  asset_no: string
  last_wash_date: string
  next_due_date: string
  days_overdue: number
  site: string | null
  vehicle_type: string | null
}

interface WashDueOptions {
  intervalDays?: number
  /** Reference "today" as YYYY-MM-DD or Date. Defaults to the current day. */
  now?: string | Date
}

/** Local (device-timezone) YYYY-MM-DD for a Date. */
function toISODate(d: Date): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** Parse a YYYY-MM-DD string to a midnight-anchored Date (null when invalid). */
function parseDate(s: string | null | undefined): Date | null {
  if (!s || typeof s !== 'string') return null
  const iso = s.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(iso + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function resolveNow(now?: string | Date): Date {
  if (now instanceof Date) return new Date(toISODate(now) + 'T00:00:00')
  if (typeof now === 'string') {
    const p = parseDate(now)
    if (p) return p
  }
  return new Date(toISODate(new Date()) + 'T00:00:00')
}

/** Whole days between two midnight-anchored dates (b - a). */
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/**
 * The date an asset is next due for a wash, given its last wash date.
 * Returns a YYYY-MM-DD string, or null when the input is not a valid date.
 */
export function nextWashDue(
  lastDate: string | null | undefined,
  intervalDays = WASH_INTERVAL_DAYS,
): string | null {
  const d = parseDate(lastDate)
  if (!d) return null
  const iv = Number.isFinite(intervalDays) && intervalDays > 0 ? Math.floor(intervalDays) : WASH_INTERVAL_DAYS
  const due = new Date(d.getTime())
  due.setDate(due.getDate() + iv)
  return toISODate(due)
}

/**
 * Assets whose most recent wash is at or past its interval as of `now`.
 * One entry per asset (its latest wash wins), most-overdue first. Records with
 * no asset or an unparseable date are skipped honestly (never guessed).
 */
export function washDueList(
  records: WashHistoryRecord[] | null | undefined,
  options: WashDueOptions = {},
): WashDueEntry[] {
  const iv = Number.isFinite(options.intervalDays) && (options.intervalDays as number) > 0
    ? Math.floor(options.intervalDays as number)
    : WASH_INTERVAL_DAYS
  const today = resolveNow(options.now)

  // Reduce to the latest wash per asset.
  const latest = new Map<string, WashHistoryRecord & { _d: Date }>()
  for (const r of records ?? []) {
    const asset = (r?.asset_no ?? '').trim()
    if (!asset) continue
    const d = parseDate(r?.wash_date)
    if (!d) continue
    const prev = latest.get(asset)
    if (!prev || d.getTime() > prev._d.getTime()) {
      latest.set(asset, { ...r, asset_no: asset, _d: d })
    }
  }

  const out: WashDueEntry[] = []
  for (const rec of latest.values()) {
    const due = new Date(rec._d.getTime())
    due.setDate(due.getDate() + iv)
    const overdue = dayDiff(due, today) // today - due; >= 0 means due/overdue
    if (overdue >= 0) {
      out.push({
        asset_no: rec.asset_no as string,
        last_wash_date: toISODate(rec._d),
        next_due_date: toISODate(due),
        days_overdue: overdue,
        site: rec.site ?? null,
        vehicle_type: rec.vehicle_type ?? null,
      })
    }
  }

  out.sort((a, b) => b.days_overdue - a.days_overdue || a.asset_no.localeCompare(b.asset_no))
  return out
}
