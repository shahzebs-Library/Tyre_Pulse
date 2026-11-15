/**
 * Company scope for lookups keyed by a business number.
 *
 * Since TEN-1b a job card number is unique per company (organisation_id,
 * work_order_no), and asset codes and tyre serials were never global either.
 * An ordinary user only ever sees their own company (restrictive RLS), so a
 * lookup by number alone is safe for them. A super admin's reads span every
 * company, so the same lookup can return another company's row. Every read
 * keyed by a number therefore also pins organisation_id: the row's own
 * company when the caller already holds the row, else the caller's company.
 *
 * Audit: docs/commercial-readiness/audit/BY_NUMBER_JOIN_AUDIT.md.
 */
import { supabase } from '../supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for a well-formed uuid string. */
export function isOrgId(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

/**
 * The caller's company as the database sees it (app_current_org()).
 * Best effort: null when it cannot be read, so the caller keeps the RLS-only
 * behaviour an ordinary user already has rather than blocking the screen.
 */
export async function currentOrgId() {
  try {
    const { data, error } = await supabase.rpc('app_current_org')
    if (error) return null
    return isOrgId(data) ? data : null
  } catch {
    return null
  }
}

/**
 * The first row of an already ordered result, preferring the caller's company
 * when the rows span more than one company. Rows from two OTHER companies are
 * never picked between: null is returned instead.
 *
 * @param {Array<object>} rows  ordered rows carrying organisation_id
 * @returns {Promise<object|null>}
 */
export async function firstForCallerCompany(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  const orgs = new Set(list.map((r) => r.organisation_id).filter(Boolean))
  // One company (the ordinary user's case, or a code only one company uses):
  // keep the caller's existing first-row order, and skip the extra round trip.
  if (orgs.size <= 1) return list[0] || null
  const org = await currentOrgId()
  return (org && list.find((r) => r.organisation_id === org)) || null
}

/**
 * Pick the one row a number lookup should open when several companies hold
 * the same number. Order: the row in `org`; else, when only one row exists at
 * all, that row (an ordinary user, or a number only one company uses); else
 * nothing, flagged ambiguous, because choosing one company's row on the
 * reader's behalf is exactly the cross-company mix-up this guards against.
 *
 * @param {Array<object>} rows   candidate rows carrying organisation_id
 * @param {string|null} org      the company to prefer
 * @returns {{row: object|null, ambiguous: boolean}}
 */
export function pickCompanyRow(rows, org) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  if (org) {
    const own = list.filter((r) => r.organisation_id === org)
    if (own.length) return { row: own[0], ambiguous: false }
  }
  if (list.length === 1) return { row: list[0], ambiguous: false }
  return { row: null, ambiguous: list.length > 1 }
}
