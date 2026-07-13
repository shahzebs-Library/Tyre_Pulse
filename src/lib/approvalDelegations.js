/**
 * Approval Delegations — pure, dependency-free domain logic for the Approval
 * Delegation / Acting Approver capability (enterprise plan §6). Determines
 * whether a delegation is currently in effect and which delegators a given user
 * is acting for, and rolls a set of delegations up into KPI counts.
 *
 * Deterministic by design: the "current time" is always injected (`nowMs`); no
 * `Date.now()` is called here. The service (`src/lib/api/approvalDelegations.js`)
 * and the page (`src/pages/ApprovalDelegations.jsx`) build on these primitives
 * so the "is this delegation active?" rule lives in exactly one place, and the
 * workflows service (`myDelegatedApprovals`) reuses it for the delegate inbox.
 */

/** Parse a timestamp-ish value to epoch ms, or null when unparseable. */
export function toEpochMs(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Is this delegation in effect at `nowMs`?
 *   active === true
 *   AND (starts_at is null OR starts_at <= now)
 *   AND (ends_at   is null OR ends_at   >= now)
 *
 * A null/absent window bound means "open-ended" on that side. Non-boolean
 * `active` is treated strictly (only `true` counts as active).
 *
 * @param {object} d       a delegation row
 * @param {number} nowMs   injected current time (epoch ms)
 * @returns {boolean}
 */
export function isActiveDelegation(d, nowMs) {
  if (!d || d.active !== true) return false
  const now = Number.isFinite(nowMs) ? nowMs : NaN
  if (!Number.isFinite(now)) return false
  const starts = toEpochMs(d.starts_at)
  if (starts != null && starts > now) return false
  const ends = toEpochMs(d.ends_at)
  if (ends != null && ends < now) return false
  return true
}

/**
 * Has this delegation not started yet (window begins in the future) while still
 * flagged active and not already expired? Used for the "upcoming" bucket.
 */
export function isUpcomingDelegation(d, nowMs) {
  if (!d || d.active !== true) return false
  const now = Number.isFinite(nowMs) ? nowMs : NaN
  if (!Number.isFinite(now)) return false
  const starts = toEpochMs(d.starts_at)
  if (starts == null || starts <= now) return false
  const ends = toEpochMs(d.ends_at)
  if (ends != null && ends < now) return false // already expired → not upcoming
  return true
}

/**
 * Has this delegation expired (its end bound is in the past)? A delegation that
 * has been switched off (active === false) but never had an end date is treated
 * as expired/inactive rather than upcoming.
 */
export function isExpiredDelegation(d, nowMs) {
  if (!d) return false
  const now = Number.isFinite(nowMs) ? nowMs : NaN
  if (!Number.isFinite(now)) return false
  const ends = toEpochMs(d.ends_at)
  if (ends != null && ends < now) return true
  // Manually deactivated with no future/active window → treat as inactive-expired.
  if (d.active !== true) {
    const starts = toEpochMs(d.starts_at)
    if (starts == null || starts <= now) return true
  }
  return false
}

/**
 * Distinct delegator ids that the given user is an ACTIVE delegate for at
 * `nowMs`. A delegation with a null `entity_type` applies to every approval
 * type; otherwise it only counts when its `entity_type` matches the requested
 * `entityType`. When `entityType` is null, entity-scoped delegations still count
 * (the caller wants "everyone I could act for right now").
 *
 * @param {string} delegateId
 * @param {Array<object>} rows        delegation rows
 * @param {number} nowMs              injected current time (epoch ms)
 * @param {string|null} [entityType]  optional approval-type filter
 * @returns {Array<string>} distinct delegator ids
 */
export function activeDelegatorsFor(delegateId, rows, nowMs, entityType = null) {
  if (!delegateId) return []
  const list = Array.isArray(rows) ? rows : []
  const out = new Set()
  for (const d of list) {
    if (!d || d.delegate_id !== delegateId) continue
    if (!isActiveDelegation(d, nowMs)) continue
    if (entityType != null && d.entity_type != null && d.entity_type !== entityType) continue
    if (d.delegator_id) out.add(d.delegator_id)
  }
  return [...out]
}

/**
 * Roll a set of delegations up into KPI counts for the page header.
 *   • total             — number of rows
 *   • activeCount       — currently in effect
 *   • upcomingCount     — active but window not started yet
 *   • expiredCount      — end bound in the past (or deactivated with no future)
 *   • distinctDelegators
 *   • distinctDelegates
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 */
export function summariseDelegations(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const delegators = new Set()
  const delegates = new Set()
  let activeCount = 0
  let upcomingCount = 0
  let expiredCount = 0

  for (const d of list) {
    if (!d) continue
    if (d.delegator_id) delegators.add(d.delegator_id)
    if (d.delegate_id) delegates.add(d.delegate_id)
    if (isActiveDelegation(d, nowMs)) activeCount += 1
    else if (isUpcomingDelegation(d, nowMs)) upcomingCount += 1
    else if (isExpiredDelegation(d, nowMs)) expiredCount += 1
  }

  return {
    total: list.length,
    activeCount,
    upcomingCount,
    expiredCount,
    distinctDelegators: delegators.size,
    distinctDelegates: delegates.size,
  }
}

/**
 * Classify a single delegation for the status filter / badge:
 * 'active' | 'upcoming' | 'expired' | 'inactive'.
 */
export function delegationStatus(d, nowMs) {
  if (isActiveDelegation(d, nowMs)) return 'active'
  if (isUpcomingDelegation(d, nowMs)) return 'upcoming'
  if (isExpiredDelegation(d, nowMs)) return 'expired'
  return 'inactive'
}
