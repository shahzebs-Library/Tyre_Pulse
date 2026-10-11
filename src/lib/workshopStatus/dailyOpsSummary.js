/**
 * Workshop Status -> Daily Ops overview summary (Loop 13). Pure: no I/O, and
 * `now` is passed in so tests are deterministic.
 *
 * Builds the four figures the Daily Ops overview strip shows, REUSING the
 * Workshop Status engines (summarize / localDay from activeView,
 * removedStatus from removedView) so the strip and the Workshop Status tabs
 * can never disagree.
 *
 * Honesty rules:
 *  - each figure is null when its source was not read (failed, or the caller
 *    may not see it). A null renders "N/A", never 0.
 *  - "overdue release" counts only vehicles whose expected release date is
 *    known and already in the past. An unknown date is not overdue.
 *  - "released today" counts records that left the report today (removed_at,
 *    local day) and are not soft deleted.
 *  - the last upload is the newest CONFIRMED upload (a previewed file has not
 *    changed the report yet).
 */
import { summarize, localDay } from './activeView'
import { removedStatus, REMOVED_STATUS } from './removedView'
import { WORKSHOP_STATUS_PATH } from './notificationLinks'

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

/** Local calendar day (yyyy-mm-dd) of a date-only value or timestamp, or null. */
function dayOf(v) {
  if (blank(v)) return null
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : localDay(d)
}

/** Deep links into the matching Workshop Status tab / preset. */
export const DAILY_OPS_WORKSHOP_LINKS = Object.freeze({
  active: `${WORKSHOP_STATUS_PATH}?tab=active`,
  waiting: `${WORKSHOP_STATUS_PATH}?focus=over7`,
  overdue: `${WORKSHOP_STATUS_PATH}?tab=active`,
  released: `${WORKSHOP_STATUS_PATH}?tab=removed`,
  upload: `${WORKSHOP_STATUS_PATH}?tab=upload`,
})

/** Count of active records whose expected release date is before today. */
export function overdueReleaseCount(records, { now } = {}) {
  const today = localDay(now)
  let n = 0
  for (const r of records || []) {
    const d = dayOf(r?.expected_release_date)
    if (d && today && d < today) n += 1
  }
  return n
}

/** Count of records released (removed from the report) today, not deleted. */
export function releasedTodayCount(rows, { now } = {}) {
  const today = localDay(now)
  let n = 0
  for (const r of rows || []) {
    if (!r || removedStatus(r) === REMOVED_STATUS.DELETED) continue
    if (dayOf(r.removed_at) === today) n += 1
  }
  return n
}

/** Newest confirmed upload as { at, by, uploadNo, fileName }, or null. */
export function latestConfirmedUpload(uploads) {
  let best = null
  let bestAt = null
  for (const u of uploads || []) {
    if (!u || u.status !== 'confirmed') continue
    const at = u.confirmed_at || u.uploaded_at
    if (blank(at)) continue
    const time = new Date(at).getTime()
    if (!Number.isFinite(time)) continue
    if (bestAt == null || time > bestAt) {
      bestAt = time
      best = {
        at,
        by: blank(u.confirmed_by_name) ? (blank(u.uploaded_by_name) ? null : String(u.uploaded_by_name).trim()) : String(u.confirmed_by_name).trim(),
        uploadNo: u.upload_no ?? null,
        fileName: blank(u.file_name) ? null : String(u.file_name),
      }
    }
  }
  return best
}

/**
 * The strip's figures. Pass `null` for any source that was not read; its
 * figures come back null.
 *
 * @param {{ active?: object[]|null, removed?: object[]|null, uploads?: object[]|null, now?: Date }} input
 * @returns {{ active: number|null, waiting7: number|null, overdueRelease: number|null,
 *   releasedToday: number|null, lastUpload: object|null, uploadsKnown: boolean }}
 */
export function buildDailyOpsWorkshopSummary({ active = null, removed = null, uploads = null, now } = {}) {
  const activeOk = Array.isArray(active)
  const s = activeOk ? summarize(active, { now }) : null
  return {
    active: s ? s.total : null,
    waiting7: s ? s.over7 : null,
    overdueRelease: activeOk ? overdueReleaseCount(active, { now }) : null,
    releasedToday: Array.isArray(removed) ? releasedTodayCount(removed, { now }) : null,
    uploadsKnown: Array.isArray(uploads),
    lastUpload: Array.isArray(uploads) ? latestConfirmedUpload(uploads) : null,
  }
}
