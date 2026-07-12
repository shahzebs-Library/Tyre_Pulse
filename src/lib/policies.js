/**
 * Policy Management — pure helpers (no I/O) for the Policy Management module.
 * A policy is "due for review" when its review_date falls on or before a
 * horizon (default 30 days) from the reference clock. All functions take `now`
 * so they are deterministic and unit-testable; the page and service consume
 * them so review logic lives in exactly one place.
 */

export const POLICY_STATUSES = ['draft', 'active', 'under_review', 'archived']

export const POLICY_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  active: { label: 'Active', tone: 'green' },
  under_review: { label: 'Under review', tone: 'amber' },
  archived: { label: 'Archived', tone: 'slate' },
}

// Default review horizon in days: a policy whose review_date is within this
// window (or already past) is flagged as due for review.
export const DEFAULT_REVIEW_HORIZON_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Parse a value to a valid Date, or null. */
function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Review status of a single policy as of `now`.
 * Returns { hasReviewDate, dueForReview, overdue, daysUntilReview }.
 * A policy is due-for-review when review_date <= now + horizonDays. Archived
 * policies are never flagged (they are out of active governance).
 */
export function policyReviewStatus(policy, now, horizonDays = DEFAULT_REVIEW_HORIZON_DAYS) {
  const ref = toDate(now) || new Date()
  const reviewDate = toDate(policy?.review_date)
  if (!reviewDate) {
    return { hasReviewDate: false, dueForReview: false, overdue: false, daysUntilReview: null }
  }
  const daysUntilReview = Math.ceil((reviewDate.getTime() - ref.getTime()) / DAY_MS)
  const archived = policy?.status === 'archived'
  const horizon = ref.getTime() + horizonDays * DAY_MS
  const dueForReview = !archived && reviewDate.getTime() <= horizon
  const overdue = !archived && reviewDate.getTime() < ref.getTime()
  return { hasReviewDate: true, dueForReview, overdue, daysUntilReview }
}

/**
 * Summarize a list of policies as of `now`: counts by status plus a
 * due-for-review count. Deterministic (now injected).
 */
export function summarizePolicies(rows, now, horizonDays = DEFAULT_REVIEW_HORIZON_DAYS) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { draft: 0, active: 0, under_review: 0, archived: 0 }
  let dueForReview = 0
  let overdue = 0
  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    const rs = policyReviewStatus(r, now, horizonDays)
    if (rs.dueForReview) dueForReview += 1
    if (rs.overdue) overdue += 1
  }
  return {
    total: list.length,
    byStatus,
    dueForReview,
    overdue,
    draft: byStatus.draft,
    active: byStatus.active,
    under_review: byStatus.under_review,
    archived: byStatus.archived,
  }
}
