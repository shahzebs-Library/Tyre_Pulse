/**
 * Pure helpers for wash supervisor verification and the next wash due date.
 * Mirrors the Flutter `wash_record.dart` / `wash_repository.dart` helpers and
 * the SQL in supabase/migrations/20261127190000_wash_supervisor_verification.sql.
 * The server is the authority; these only decide what the screen offers.
 */

/** Roles that may verify a wash. Mirrors wash_verifier_role() in SQL. */
export const WASH_VERIFIER_ROLES = new Set([
  'admin', 'manager', 'director', 'fleet supervisor',
  'maintenance supervisor', 'workshop supervisor',
])

/** The owner's one-week wash interval (same value as washAnalytics). */
const NEXT_WASH_DAYS = 7

/** When the vehicle is next due after this wash: stored column, else +7 days. */
export function nextWashDueOf(row) {
  if (row?.next_wash_due) return String(row.next_wash_due).slice(0, 10)
  const d = String(row?.wash_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + NEXT_WASH_DAYS)
  return t.toISOString().slice(0, 10)
}

/**
 * Whether the signed-in person may verify this wash: a pending record, a
 * verifier role (or super admin), and never the person who logged it. The
 * server re-checks all of this in verify_wash_record.
 */
export function canVerifyWash(row, profile, isSuperAdmin = false) {
  if (!row || row.verification_status !== 'pending' || !profile?.id) return false
  if (row.created_by && row.created_by === profile.id) return false
  return isSuperAdmin === true || WASH_VERIFIER_ROLES.has(String(profile.role || '').trim().toLowerCase())
}


/** The one-line verification status shown on a record. */
export function verificationLine(row, verifierName) {
  switch (row?.verification_status) {
    case 'pending': return 'Waiting for a supervisor to verify'
    case 'verified': return `Verified by ${verifierName || 'a supervisor'}${row.verified_at ? ` on ${String(row.verified_at).replace('T', ' ').slice(0, 16)}` : ''}`
    case 'not_required': return 'No check needed: logged by a supervisor'
    default: return 'Not set up on this server yet'
  }
}
