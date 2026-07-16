/**
 * schedule.ts - pure helpers that turn a flat list of dated items (inspections,
 * preventive-maintenance due dates, tasks / work) into a day-grouped agenda.
 *
 * No data fetching, no React, no fabrication: callers pass real rows in and get
 * ordered buckets out (Overdue / Today / This week / Later). Kept pure so it is
 * trivially testable and reusable.
 */

export type ScheduleKind = 'inspection' | 'maintenance' | 'task' | 'work_order'

export interface ScheduleItem {
  id: string
  kind: ScheduleKind
  title: string
  subtitle?: string
  /** ISO date string ('YYYY-MM-DD' or full timestamp). The day it is due. */
  date: string
  priority?: string | null
  status?: string | null
  /** Optional in-app navigation target for a tap. Omit for non-navigable rows. */
  route?: string
}

export type BucketKey = 'overdue' | 'today' | 'week' | 'later'

export interface ScheduleGroup {
  key: BucketKey
  label: string
  items: ScheduleItem[]
}

export interface ScheduleSummary {
  overdue: number
  today: number
  week: number
  total: number
}

const MS_PER_DAY = 86_400_000

const BUCKET_LABEL: Record<BucketKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
}

const BUCKET_ORDER: BucketKey[] = ['overdue', 'today', 'week', 'later']

/** Midnight (local) epoch for a Date - strips the time component. */
function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Parse a DB date/timestamp into a local Date. Returns null when unparseable. */
export function parseScheduleDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  // Bare 'YYYY-MM-DD' is treated as a local calendar day (avoid UTC shift).
  const raw = iso.length <= 10 ? `${iso}T00:00:00` : iso
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Whole-day offset of `iso` from `now` (negative = past, 0 = today).
 * Returns null when the date cannot be parsed.
 */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseScheduleDate(iso)
  if (!d) return null
  return Math.round((dayStart(d) - dayStart(now)) / MS_PER_DAY)
}

/** Which agenda bucket a date falls into relative to `now`. */
export function bucketFor(iso: string | null | undefined, now: Date = new Date()): BucketKey | null {
  const diff = daysUntil(iso, now)
  if (diff === null) return null
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 7) return 'week'
  return 'later'
}

/** True when the item is due before today and still open. */
export function isOverdue(item: ScheduleItem, now: Date = new Date()): boolean {
  return bucketFor(item.date, now) === 'overdue'
}

/**
 * Human day label for a row inside a bucket, e.g. "Today", "Tomorrow",
 * "Mon 21 Jul", or "3 days ago". Plain ASCII.
 */
export function dayLabel(iso: string | null | undefined, now: Date = new Date(), locale = 'en-GB'): string {
  const d = parseScheduleDate(iso)
  if (!d) return 'No date'
  const diff = daysUntil(iso, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff !== null && diff < 0) return `${Math.abs(diff)} days ago`
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Group items into ordered buckets. Items are sorted by due date ascending
 * (soonest first) within each bucket. Empty buckets are dropped. Rows with an
 * unparseable date are ignored (honest: no guessing).
 */
export function groupSchedule(items: ScheduleItem[], now: Date = new Date()): ScheduleGroup[] {
  const byBucket: Record<BucketKey, ScheduleItem[]> = { overdue: [], today: [], week: [], later: [] }
  for (const it of items) {
    const b = bucketFor(it.date, now)
    if (b) byBucket[b].push(it)
  }
  const cmp = (a: ScheduleItem, b: ScheduleItem) => {
    const da = parseScheduleDate(a.date)?.getTime() ?? 0
    const db = parseScheduleDate(b.date)?.getTime() ?? 0
    return da - db
  }
  return BUCKET_ORDER
    .map<ScheduleGroup>(key => ({ key, label: BUCKET_LABEL[key], items: byBucket[key].sort(cmp) }))
    .filter(g => g.items.length > 0)
}

/** Headline counts for the summary strip. */
export function summarize(items: ScheduleItem[], now: Date = new Date()): ScheduleSummary {
  let overdue = 0, today = 0, week = 0
  for (const it of items) {
    const b = bucketFor(it.date, now)
    if (b === 'overdue') overdue++
    else if (b === 'today') today++
    else if (b === 'week') week++
  }
  return { overdue, today, week, total: items.length }
}
