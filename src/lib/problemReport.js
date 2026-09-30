/**
 * problemReport.js - pure helpers for Problem Tracking (Phase 0 + Phase 1).
 *
 * No I/O here. The service (`src/lib/api/userIssues.js`), the web error logger
 * (`src/lib/api/systemLogs.js`), the "Report a problem" dialog and the console
 * inbox all read these, so the vocabulary lives in one place and mirrors the
 * CHECK constraints in supabase/migrations/20260930150000_user_issues.sql.
 * CHANGE BOTH TOGETHER.
 */

export const ISSUE_CATEGORIES = [
  { key: 'bug', label: 'Something is broken' },
  { key: 'data_wrong', label: 'The data looks wrong' },
  { key: 'slow', label: 'It is too slow' },
  { key: 'access', label: 'I cannot open something' },
  { key: 'other', label: 'Something else' },
]

export const ISSUE_SEVERITIES = [
  { key: 'low', label: 'Low: a small annoyance' },
  { key: 'medium', label: 'Medium: slows my work' },
  { key: 'high', label: 'High: I cannot finish my work' },
  { key: 'critical', label: 'Critical: many people are blocked' },
]

export const ISSUE_STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'triaged', label: 'Triaged' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting_user', label: 'Waiting for the reporter' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'closed', label: 'Closed' },
  { key: 'wont_fix', label: 'Will not fix' },
]

export const ISSUE_PLATFORMS = [
  { key: 'web', label: 'Web' },
  { key: 'flutter', label: 'Phone app' },
  { key: 'expo', label: 'Old phone app' },
]

/** Plain-English consequence of moving a report to each status. */
export const STATUS_IMPACT = {
  new: 'The report goes back to the top of the inbox as unreviewed.',
  triaged: 'The report is marked as reviewed. The reporter is not told.',
  in_progress: 'The report shows as being worked on. The reporter is not told.',
  waiting_user: 'The report is paused until the reporter answers. The reporter is not told automatically.',
  fixed: 'The reporter gets an in-app message saying the problem was fixed in the version you enter.',
  closed: 'The report leaves the open list. The reporter is not told.',
  wont_fix: 'The report is closed as a decision not to change anything. The reporter is not told.',
}

export const DESCRIPTION_MIN = 5
export const DESCRIPTION_MAX = 2000

const OPEN_STATUSES = new Set(['new', 'triaged', 'in_progress', 'waiting_user'])

export function isOpenStatus(status) {
  return OPEN_STATUSES.has(status)
}

function labelFrom(list, key) {
  const hit = list.find((o) => o.key === key)
  return hit ? hit.label : (key ? String(key) : 'N/A')
}

export const categoryLabel = (k) => labelFrom(ISSUE_CATEGORIES, k)
export const severityLabel = (k) => {
  const hit = ISSUE_SEVERITIES.find((o) => o.key === k)
  return hit ? hit.label.split(':')[0] : (k ? String(k) : 'N/A')
}
export const statusLabel = (k) => labelFrom(ISSUE_STATUSES, k)
export const platformLabel = (k) => labelFrom(ISSUE_PLATFORMS, k)

/**
 * Normalise an error message so the same problem groups together whatever
 * numbers, ids or quoted values it happened to carry. Lower case, whitespace
 * collapsed, uuids / hex / numbers / quoted strings replaced by placeholders.
 */
export function normalizeErrorMessage(message) {
  let s = message == null ? '' : String(message)
  s = s.toLowerCase()
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
  s = s.replace(/(["'`])(?:(?!\1).){0,200}\1/g, '<q>')
  s = s.replace(/\b0x[0-9a-f]+\b/g, '<n>')
  s = s.replace(/\b[0-9a-f]{16,}\b/g, '<id>')
  s = s.replace(/\d+(?:\.\d+)?/g, '<n>')
  s = s.replace(/\s+/g, ' ').trim()
  return s.slice(0, 240)
}

/** Fingerprint = source + normalised message. Null when there is no message. */
export function errorFingerprint(source, message) {
  const msg = normalizeErrorMessage(message)
  if (!msg) return null
  const src = String(source || 'app').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
  return `${src}|${msg}`
}

/** The web build's version string, or null. Never invents one. */
export function webAppVersion(env = import.meta.env) {
  const v = env?.VITE_APP_VERSION
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null
}

/** Best-effort browser + OS from a user agent string. Never throws. */
export function describeClient(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  let browser = null
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'
  let os = null
  if (/Windows/.test(ua)) os = 'Windows'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  const mobile = /Mobi|Android|iPhone|iPad/.test(ua)
  return {
    browser,
    os,
    device: browser ? `${browser}${mobile ? ' (mobile)' : ''}` : null,
  }
}

/**
 * Validate the report form. Returns { ok, errors, value } where value is the
 * trimmed, whitelisted payload ready for submit_user_issue.
 */
export function validateIssueInput({ description, category, severity } = {}) {
  const errors = {}
  const desc = typeof description === 'string' ? description.trim() : ''
  if (desc.length < DESCRIPTION_MIN) errors.description = 'Please describe the problem in a few words.'
  else if (desc.length > DESCRIPTION_MAX) errors.description = `Please keep it under ${DESCRIPTION_MAX} characters.`
  const cat = ISSUE_CATEGORIES.some((c) => c.key === category) ? category : null
  if (!cat) errors.category = 'Choose what kind of problem it is.'
  const sev = ISSUE_SEVERITIES.some((s) => s.key === severity) ? severity : 'medium'
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { description: desc, category: cat, severity: sev },
  }
}

/** Server refusal messages that are written for users and safe to show. */
export const SAFE_SERVER_MESSAGES = new Set([
  'Please sign in to report a problem',
  'Your account cannot report problems',
  'Your account is not linked to a company',
  'Please describe the problem in a few words',
  'The description is too long (2000 characters at most)',
  'Unknown problem type',
  'Too many reports in the last hour. Please try again later',
  'Only an administrator can manage reported problems',
  'Problem report not found',
  'Unknown status',
  'Say which app version has the fix',
  'Only an administrator of this company can own a problem',
  'Write a note first',
  'Only an administrator can read linked errors',
  'Only a super admin can read the problem summary',
])

/** SLA state for a report: 'met' | 'breached' | 'due' | 'none'. */
export function slaState(issue, now = Date.now()) {
  if (!issue?.sla_due_at) return 'none'
  const due = new Date(issue.sla_due_at).getTime()
  if (!Number.isFinite(due)) return 'none'
  if (!isOpenStatus(issue.status)) {
    const done = issue.resolved_at ? new Date(issue.resolved_at).getTime() : null
    return done != null && done <= due ? 'met' : 'breached'
  }
  return now > due ? 'breached' : 'due'
}

/** Client-side filtering for the console inbox. */
export function filterIssues(rows, { status, category, severity, platform, org, search } = {}) {
  const q = typeof search === 'string' ? search.trim().toLowerCase() : ''
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status === 'open' && !isOpenStatus(r.status)) return false
    if (status && status !== 'open' && status !== 'all' && r.status !== status) return false
    if (category && r.category !== category) return false
    if (severity && r.severity !== severity) return false
    if (platform && r.platform !== platform) return false
    if (org && r.organisation_id !== org) return false
    if (q) {
      const hay = [r.description, r.page_or_screen, r.reference_id, r.reporter_name, r.app_version]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Plain-English line for one history row, as the REPORTER sees it. Ids are
 * never shown: an assignment says someone took it, not who by uuid.
 */
export function describeIssueEvent(ev) {
  if (!ev || typeof ev !== 'object') return 'N/A'
  switch (ev.event_type) {
    case 'created':
      return 'Report sent'
    case 'status':
      return `Status changed from ${statusLabel(ev.from_value)} to ${statusLabel(ev.to_value)}`
    case 'assign':
      return ev.to_value ? 'An owner was assigned' : 'The owner was removed'
    case 'fixed_version':
      return ev.to_value ? `Fix planned for version ${ev.to_value}` : 'Fix version cleared'
    case 'comment':
      return 'Note added by the support team'
    case 'sla_breach':
      return 'Past its target time. The support team was alerted'
    default:
      return ev.event_type ? String(ev.event_type) : 'N/A'
  }
}

/** Counts for the "My reported problems" page. */
export function myIssueCounts(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  let open = 0
  let fixed = 0
  let late = 0
  for (const r of list) {
    if (isOpenStatus(r.status)) open += 1
    if (r.status === 'fixed') fixed += 1
    if (isOpenStatus(r.status) && slaState(r, now) === 'breached') late += 1
  }
  return { total: list.length, open, fixed, late }
}

const toCount = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
const toHours = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const toCountMap = (obj) => {
  const out = {}
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) out[k] = toCount(v)
  }
  return out
}

/**
 * Normalise get_user_issue_summary(). Medians stay null when nothing was
 * measurable (never 0); a median with a zero sample is forced to null.
 */
export function shapeIssueSummary(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const frN = toCount(r.first_response_measured)
  const fxN = toCount(r.fix_measured)
  return {
    generatedAt: r.generated_at || null,
    total: toCount(r.total),
    open: toCount(r.open),
    byStatus: toCountMap(r.by_status),
    bySeverity: toCountMap(r.by_severity),
    byPlatform: toCountMap(r.by_platform),
    medianFirstResponseHours: frN > 0 ? toHours(r.median_first_response_hours) : null,
    firstResponseMeasured: frN,
    medianFixHours: fxN > 0 ? toHours(r.median_fix_hours) : null,
    fixMeasured: fxN,
    breaches7d: toCount(r.breaches_7d),
    breachAlerts7d: toCount(r.breach_alerts_7d),
    openPastTarget: toCount(r.open_past_target),
  }
}

/** Hours as a short readable duration, or N/A. */
export function formatHours(h) {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) return 'N/A'
  const n = Number(h)
  if (n < 1) return `${Math.max(1, Math.round(n * 60))} min`
  if (n < 48) return `${Math.round(n * 10) / 10} h`
  return `${Math.round((n / 24) * 10) / 10} days`
}
