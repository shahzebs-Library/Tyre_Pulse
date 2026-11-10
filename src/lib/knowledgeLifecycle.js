/**
 * knowledgeLifecycle - pure rules for the controlled-document lifecycle of the
 * company knowledge base (SOPs, manuals, pressure guidance, removal criteria,
 * RCA procedures, warranty rules, procurement procedures).
 *
 * MIRRORS supabase/migrations/20261112103000_knowledge_lifecycle.sql:
 *   - transitions          <-> kb_lifecycle_guard()
 *   - canApprove           <-> kb_is_approver() + the four-eyes check
 *   - isRetrievable        <-> the WHERE clause of match_knowledge_documents()
 * Change both together. The database is the authority; these exist so the page
 * shows the same answer before the user presses a button.
 *
 * Dates are compared as calendar days (YYYY-MM-DD), the same as `current_date`
 * in SQL. `today` is injected so the functions stay pure.
 */

export const KB_STATUSES = Object.freeze(['draft', 'approved', 'superseded', 'expired', 'withdrawn'])

export const KB_STATUS_META = Object.freeze({
  draft: { label: 'Draft', tone: 'muted', hint: 'Not used by the AI until an approver signs it off.' },
  approved: { label: 'Approved', tone: 'good', hint: 'Used by the AI while in date.' },
  superseded: { label: 'Superseded', tone: 'warn', hint: 'Replaced by a newer version. Not used by the AI.' },
  expired: { label: 'Expired', tone: 'warn', hint: 'Past its expiry date. Not used by the AI.' },
  withdrawn: { label: 'Withdrawn', tone: 'bad', hint: 'Taken out of use. Not used by the AI.' },
  scheduled: { label: 'Approved, not yet effective', tone: 'info', hint: 'Approved, used by the AI from its effective date.' },
})

/** Allowed status changes. Superseded and withdrawn are terminal. */
export const KB_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['approved', 'withdrawn']),
  approved: Object.freeze(['superseded', 'expired', 'withdrawn']),
  expired: Object.freeze(['withdrawn']),
  superseded: Object.freeze([]),
  withdrawn: Object.freeze([]),
})

export const APPROVER_ROLES = Object.freeze(['admin', 'manager', 'director'])

/** Days before review_due that a document is flagged "review due soon". */
export const REVIEW_SOON_DAYS = 30

const DAY_MS = 86_400_000
const text = (v) => (v == null ? '' : String(v).trim())

/** A value as a calendar day string (YYYY-MM-DD), or null. */
export function toDay(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dayNum = (day) => (day ? Date.parse(`${day}T00:00:00Z`) / DAY_MS : null)

/** Normalised stored status (unknown -> draft, never approved). */
export function storedStatus(doc) {
  const s = text(doc?.status).toLowerCase()
  return KB_STATUSES.includes(s) ? s : 'draft'
}

export function canTransition(from, to) {
  return (KB_TRANSITIONS[from] || []).includes(to)
}

/**
 * Mirror of the retrieval rule: approved AND effective_from <= today (or none)
 * AND expires_at > today (or none).
 */
export function isRetrievable(doc, today) {
  if (storedStatus(doc) !== 'approved') return false
  const t = toDay(today)
  const from = toDay(doc?.effective_from)
  const to = toDay(doc?.expires_at)
  if (from && t && from > t) return false
  if (to && t && to <= t) return false
  return true
}

/**
 * The status a reader should see today. An approved document past its expiry
 * reads "expired" even before the housekeeping job flips the stored value; one
 * not yet effective reads "scheduled".
 */
export function effectiveStatus(doc, today) {
  const s = storedStatus(doc)
  if (s !== 'approved') return s
  const t = toDay(today)
  const from = toDay(doc?.effective_from)
  const to = toDay(doc?.expires_at)
  if (to && t && to <= t) return 'expired'
  if (from && t && from > t) return 'scheduled'
  return 'approved'
}

/**
 * Review state from review_due: 'none' (no date), 'overdue', 'due_soon'
 * (within REVIEW_SOON_DAYS) or 'ok'. Only live documents (approved) are
 * reviewed; anything else returns 'none'.
 */
export function reviewState(doc, today, soonDays = REVIEW_SOON_DAYS) {
  if (storedStatus(doc) !== 'approved') return { state: 'none', days: null }
  const due = dayNum(toDay(doc?.review_due))
  const t = dayNum(toDay(today))
  if (due == null || t == null) return { state: 'none', days: null }
  const days = Math.round(due - t)
  if (days < 0) return { state: 'overdue', days }
  if (days <= soonDays) return { state: 'due_soon', days }
  return { state: 'ok', days }
}

/** Plain sentence for a review state, or '' when nothing to say. */
export function reviewNote(rs) {
  if (!rs || rs.state === 'none' || rs.state === 'ok') return ''
  if (rs.state === 'overdue') return `Review overdue by ${Math.abs(rs.days)} day${Math.abs(rs.days) === 1 ? '' : 's'}`
  return rs.days === 0 ? 'Review due today' : `Review due in ${rs.days} day${rs.days === 1 ? '' : 's'}`
}

function isApproverRole({ role, isSuperAdmin } = {}) {
  return !!isSuperAdmin || APPROVER_ROLES.includes(text(role).toLowerCase())
}

/**
 * Can this user approve this document now? Returns { ok, reason }.
 * Rules: draft only, approver role, never the uploader, must hold content.
 */
export function canApprove(doc, user = {}) {
  const s = storedStatus(doc)
  if (!doc) return { ok: false, reason: 'No document selected.' }
  if (!canTransition(s, 'approved')) return { ok: false, reason: `A ${KB_STATUS_META[s].label.toLowerCase()} document cannot be approved.` }
  if (!isApproverRole(user)) return { ok: false, reason: 'Only an Admin, Manager or Director can approve a document.' }
  if (doc.created_by && user.userId && doc.created_by === user.userId) {
    return { ok: false, reason: 'The person who uploaded a document cannot approve it. Ask another approver.' }
  }
  const hasBody = Number(doc.chunk_count) > 0 || text(doc.content).length > 0
  if (!hasBody) return { ok: false, reason: 'A document with no content cannot be approved.' }
  return { ok: true, reason: '' }
}

/** Can this user withdraw this document? Returns { ok, reason }. */
export function canWithdraw(doc, user = {}) {
  const s = storedStatus(doc)
  if (!doc) return { ok: false, reason: 'No document selected.' }
  if (!canTransition(s, 'withdrawn')) return { ok: false, reason: `A ${KB_STATUS_META[s].label.toLowerCase()} document cannot be withdrawn.` }
  if (!isApproverRole(user)) return { ok: false, reason: 'Only an Admin, Manager or Director can withdraw a document.' }
  return { ok: true, reason: '' }
}

/**
 * Can a new version be uploaded to supersede this document? A draft is edited,
 * not superseded; withdrawn/superseded are history.
 */
export function canSupersede(doc) {
  const s = storedStatus(doc)
  return s === 'approved' || s === 'expired'
}

/** Next version number for a document that supersedes `doc`. */
export function nextVersion(doc) {
  const v = Number(doc?.version)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) + 1 : 2
}

/**
 * Validate the lifecycle dates a user typed. Returns an error string or ''.
 */
export function validateLifecycleDates({ effective_from, review_due, expires_at } = {}) {
  const from = toDay(effective_from)
  const review = toDay(review_due)
  const exp = toDay(expires_at)
  if (effective_from && !from) return 'Effective from is not a valid date.'
  if (review_due && !review) return 'Review due is not a valid date.'
  if (expires_at && !exp) return 'Expires on is not a valid date.'
  if (from && exp && exp <= from) return 'Expires on must be after the effective date.'
  if (from && review && review < from) return 'Review due cannot be before the effective date.'
  return ''
}

/**
 * Citation label for a retrieval hit: "Tyre Pressure SOP v2, p.3-4 [doc 1a2b3c4d]".
 * Accepts the match_knowledge_documents row shape.
 */
export function citationLabel(hit) {
  if (!hit) return ''
  const title = text(hit.title) || 'Untitled document'
  const v = Number(hit.version)
  const ver = Number.isFinite(v) && v >= 1 ? ` v${v}` : ''
  const pf = Number(hit.page_from)
  const pt = Number(hit.page_to)
  let page = ''
  if (Number.isFinite(pf) && pf >= 1) page = Number.isFinite(pt) && pt > pf ? `, p.${pf}-${pt}` : `, p.${pf}`
  const id = text(hit.document_id || hit.id)
  return `${title}${ver}${page}${id ? ` [doc ${id.slice(0, 8)}]` : ''}`
}

/** Count documents per effective status (for KPI tiles). */
export function lifecycleCounts(docs = [], today) {
  const out = { draft: 0, approved: 0, scheduled: 0, superseded: 0, expired: 0, withdrawn: 0, reviewOverdue: 0, reviewSoon: 0, live: 0 }
  for (const d of Array.isArray(docs) ? docs : []) {
    const s = effectiveStatus(d, today)
    out[s] = (out[s] || 0) + 1
    if (isRetrievable(d, today)) out.live += 1
    const rs = reviewState(d, today).state
    if (rs === 'overdue') out.reviewOverdue += 1
    else if (rs === 'due_soon') out.reviewSoon += 1
  }
  return out
}
