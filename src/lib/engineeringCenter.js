/**
 * engineeringCenter.js - pure helpers behind the Control Center Engineering
 * screens: Developer Center (/console/developer) and Releases
 * (/console/releases). No I/O: every function takes already-loaded data, so
 * the same rules are unit-tested and reused by both pages.
 *
 * Honesty rules applied here:
 *   - an unknown or unmeasured value is null and renders "N/A", never 0;
 *   - times are shown in Riyadh time (UTC+3, no daylight saving);
 *   - a verdict on errors before vs after a release is only given when both
 *     windows are the same length AND the full window has passed.
 */

export const RIYADH_OFFSET_MIN = 180
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const nf = new Intl.NumberFormat('en-US')

export const fmtInt = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? 'N/A' : nf.format(Number(n)))
export const fmtMs = (ms) => (ms === null || ms === undefined || !Number.isFinite(Number(ms)) ? 'N/A' : `${nf.format(Math.round(Number(ms)))} ms`)
const pad = (n) => String(n).padStart(2, '0')

/** A Date shifted so its UTC getters read Riyadh wall-clock time. */
function riyadh(d) {
  const t = d instanceof Date ? d.getTime() : Date.parse(d)
  if (!Number.isFinite(t)) return null
  return new Date(t + RIYADH_OFFSET_MIN * 60000)
}

/** "11:12" in Riyadh time, or "N/A". */
export function riyadhTime(value) {
  const r = riyadh(value)
  return r ? `${pad(r.getUTCHours())}:${pad(r.getUTCMinutes())}` : 'N/A'
}

/** "30 Sep" in Riyadh time, or "N/A". */
export function riyadhDay(value) {
  const r = riyadh(value)
  return r ? `${r.getUTCDate()} ${MONTHS[r.getUTCMonth()]}` : 'N/A'
}

/** Riyadh calendar day key "2026-09-30". */
export function riyadhDayKey(value) {
  const r = riyadh(value)
  return r ? `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}` : null
}

/* ── scheduled jobs ─────────────────────────────────────────────────────── */

/** Plain-English description of every scheduled job this database runs. */
export const JOB_DESCRIPTIONS = Object.freeze({
  'accident-sla-scan': 'Flags accident cases past their deadline',
  'audit-log-retention': 'Deletes audit rows past the retention period',
  'audit-seal-daily': 'Seals yesterday\'s audit log so it cannot be edited',
  checklist_assignments_daily: 'Hands out today\'s checklists',
  'cron-health-watch': 'Watches the other jobs and raises alerts',
  'deliver-webhooks': 'Sends outgoing webhooks',
  'deliver-workflow-notifications': 'Sends approval pushes and emails',
  'driver-fine-daily-reminders': 'Reminds drivers about open fines',
  'embed-knowledge-documents': 'Indexes uploaded documents for the assistant',
  'escalate-workflows': 'Escalates approvals that waited too long',
  'evaluate-alert-thresholds': 'Checks your alert rules',
  'flag-changes-apply': 'Applies scheduled feature flag changes',
  'jit-elevation-expiry': 'Ends temporary access when it runs out',
  'nightly-backup': 'Copies the core tables into a restore point',
  'process-domain-events': 'Runs follow-up work after each change',
  'security-audit-weekly': 'Security scan of the database',
  'send-scheduled-reports': 'Emails scheduled reports that are due',
  'sentry-crash-alert': 'Checks Sentry for new fatal crashes',
  'tenant-export-retention': 'Removes expired company exports',
  'upload-gap-check': 'Warns when a daily upload is missing',
  'user-issue-breach-check': 'Flags reported problems past their target time',
})

export function jobDescription(name) {
  return JOB_DESCRIPTIONS[name] || 'No description recorded for this job'
}

function parseCron(schedule) {
  const f = String(schedule || '').trim().split(/\s+/)
  if (f.length !== 5) return null
  const [mi, hr, dom, mon, dow] = f
  if (dom !== '*' || mon !== '*') return null
  if (mi === '*' && hr === '*' && dow === '*') return { kind: 'minute', every: 1 }
  let m = mi.match(/^\*\/(\d+)$/)
  if (m && hr === '*' && dow === '*') return { kind: 'minute', every: Number(m[1]) }
  if (/^\d+$/.test(mi) && hr === '*' && dow === '*') return { kind: 'hourly', minute: Number(mi) }
  if (/^\d+$/.test(mi) && /^\d+$/.test(hr) && dow === '*') return { kind: 'daily', minute: Number(mi), hour: Number(hr) }
  if (/^\d+$/.test(mi) && /^\d+$/.test(hr) && /^\d$/.test(dow)) return { kind: 'weekly', minute: Number(mi), hour: Number(hr), dow: Number(dow) }
  return null
}

/** Riyadh hour/minute/weekday of a UTC cron time. */
function toRiyadhClock(hour, minute, dow = null) {
  let total = hour * 60 + minute + RIYADH_OFFSET_MIN
  let dayShift = 0
  if (total >= 1440) { total -= 1440; dayShift = 1 }
  return { hour: Math.floor(total / 60), minute: total % 60, dow: dow === null ? null : (dow + dayShift) % 7 }
}

/** "Every minute", "Every 15 min", "Hourly at :05", "Daily 09:30", "Sunday 08:00" (Riyadh). */
export function scheduleLabel(schedule) {
  const c = parseCron(schedule)
  if (!c) return String(schedule || 'N/A')
  if (c.kind === 'minute') return c.every === 1 ? 'Every minute' : `Every ${c.every} min`
  if (c.kind === 'hourly') return `Hourly at :${pad(c.minute)}`
  const r = toRiyadhClock(c.hour, c.minute, c.kind === 'weekly' ? c.dow : null)
  if (c.kind === 'daily') return `Daily ${pad(r.hour)}:${pad(r.minute)}`
  return `${DAY_NAMES[r.dow]} ${pad(r.hour)}:${pad(r.minute)}`
}

/** Cadence bucket for the job filter chips. */
export function scheduleBucket(schedule) {
  const c = parseCron(schedule)
  if (!c) return 'other'
  if (c.kind === 'minute' || c.kind === 'hourly') return c.kind === 'minute' && c.every <= 5 ? 'minute' : 'hourly'
  return c.kind
}

/** Next planned start in plain words, or "N/A" for a shape we cannot read. */
export function nextRunLabel(schedule, now = Date.now()) {
  const c = parseCron(schedule)
  if (!c) return 'N/A'
  if (c.kind === 'minute') return c.every === 1 ? 'in 1 min' : `within ${c.every} min`
  const nowR = riyadh(now)
  if (c.kind === 'hourly') {
    const m = c.minute
    const h = nowR.getUTCMinutes() < m ? nowR.getUTCHours() : (nowR.getUTCHours() + 1) % 24
    return `${pad(h)}:${pad(m)}`
  }
  const r = toRiyadhClock(c.hour, c.minute, c.kind === 'weekly' ? c.dow : null)
  const nowMin = nowR.getUTCHours() * 60 + nowR.getUTCMinutes()
  const at = r.hour * 60 + r.minute
  const hhmm = `${pad(r.hour)}:${pad(r.minute)}`
  if (c.kind === 'daily') return at > nowMin ? `Today ${hhmm}` : `Tomorrow ${hhmm}`
  let add = (r.dow - nowR.getUTCDay() + 7) % 7
  if (add === 0 && at <= nowMin) add = 7
  const next = new Date(nowR.getTime() + add * 86400000)
  return `${DAY_NAMES[r.dow].slice(0, 3)} ${next.getUTCDate()} ${MONTHS[next.getUTCMonth()]} ${hhmm}`
}

/**
 * One job's state for the State column. Order: paused, stuck, failing (policy
 * streak reached), missed its time, weekly job not due in 24 h, otherwise OK.
 */
export function jobState(job, policy = {}) {
  if (!job) return { key: 'unknown', label: 'N/A', tone: 'default' }
  if (job.active === false) return { key: 'paused', label: 'Paused', tone: 'warning' }
  if (job.stuck) return { key: 'stuck', label: 'Stuck', tone: 'danger' }
  const streak = Number(policy.fail_streak) || 2
  if ((Number(job.fail_streak) || 0) >= streak) return { key: 'failing', label: 'Failing', tone: 'danger' }
  if (job.overdue) return { key: 'missed', label: 'Missed', tone: 'danger' }
  if ((Number(job.fail_streak) || 0) > 0) return { key: 'blip', label: 'Last run failed', tone: 'warning' }
  if (!job.last_start) return { key: 'waiting', label: 'Not run yet', tone: 'default' }
  if (scheduleBucket(job.schedule) === 'weekly') return { key: 'weekly', label: 'Weekly', tone: 'info' }
  return { key: 'ok', label: 'OK', tone: 'good' }
}

/** Totals for the jobs panel header. */
export function jobTotals(jobs = []) {
  const list = Array.isArray(jobs) ? jobs : []
  const sum = (k) => list.reduce((a, j) => a + (Number(j[k]) || 0), 0)
  const longest = list.reduce((best, j) => (Number(j.max_ms) > (best?.max_ms ?? -1) ? j : best), null)
  const missedKnown = list.filter((j) => j.missed_nd !== null && j.missed_nd !== undefined)
  return {
    total: list.length,
    active: list.filter((j) => j.active).length,
    runs24h: sum('runs_24h'),
    failed24h: sum('failed_24h'),
    failedNd: sum('failed_nd'),
    missedNd: missedKnown.length ? missedKnown.reduce((a, j) => a + (Number(j.missed_nd) || 0), 0) : null,
    expectedNd: list.reduce((a, j) => a + (Number(j.expected_nd) || 0), 0),
    longest: longest && Number.isFinite(Number(longest.max_ms)) ? { name: longest.jobname, ms: Number(longest.max_ms) } : null,
  }
}

/* ── versions and adoption ─────────────────────────────────────────────── */

export function parseVersion(v) {
  const s = String(v ?? '').trim().replace(/^v/i, '')
  if (!s || !/^\d+(\.\d+)*$/.test(s)) return null
  return s.split('.').map((n) => parseInt(n, 10))
}

export function compareVersions(a, b) {
  const pa = parseVersion(a); const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0; const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Adoption judged on installs AND on phones opened in the last 7 days
 * (Sentry release-health pattern). byVersion rows: { app_version, installs, active_7d }.
 */
export function adoptionSummary(byVersion = [], minVersion, latestVersion) {
  const rows = (Array.isArray(byVersion) ? byVersion : [])
    .map((r) => ({ version: r.app_version || null, installs: Number(r.installs) || 0, active: Number(r.active_7d) || 0 }))
    .sort((a, b) => compareVersions(b.version, a.version))
  const installs = rows.reduce((a, r) => a + r.installs, 0)
  const active = rows.reduce((a, r) => a + r.active, 0)
  const onLatest = latestVersion && parseVersion(latestVersion)
    ? rows.filter((r) => compareVersions(r.version, latestVersion) >= 0) : []
  const gate = minVersion && parseVersion(minVersion) ? minVersion : null
  const below = gate ? rows.filter((r) => !r.version || compareVersions(r.version, gate) < 0) : []
  const sum = (list, k) => list.reduce((a, r) => a + r[k], 0)
  const latestInstalls = latestVersion ? sum(onLatest, 'installs') : null
  const latestActive = latestVersion ? sum(onLatest, 'active') : null
  return {
    rows,
    installs,
    active,
    latestInstalls,
    latestActive,
    belowInstalls: gate ? sum(below, 'installs') : null,
    belowActive: gate ? sum(below, 'active') : null,
    belowRows: below,
    pctInstalls: latestInstalls !== null && installs ? Math.round((latestInstalls / installs) * 100) : null,
    pctActive: latestActive !== null && active ? Math.round((latestActive / active) * 100) : null,
  }
}

/** How many installs and active phones a proposed minimum would force to update. */
export function gateForced(byVersion = [], proposedMin) {
  if (!parseVersion(proposedMin)) return { forced: null, forcedActive: null, notAffected: null }
  let forced = 0; let forcedActive = 0; let ok = 0
  for (const r of byVersion || []) {
    const n = Number(r.installs) || 0; const a = Number(r.active_7d) || 0
    if (!parseVersion(r.app_version) || compareVersions(r.app_version, proposedMin) < 0) { forced += n; forcedActive += a } else ok += n
  }
  return { forced, forcedActive, notAffected: ok }
}

/* ── migrations and edge functions ─────────────────────────────────────── */

/** "20260930080638" -> Date (UTC). */
export function migrationDate(version) {
  const m = String(version || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
}

/** "fleet_workorder_admin_only_writes" -> "Fleet workorder admin only writes". */
export function migrationTitle(name) {
  const s = String(name || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return 'Unnamed migration'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Supabase edge functions in this repository (supabase/functions/*). The
 * deployed version and per-function calls are NOT readable from the console,
 * so they are shown as N/A; the sign-in check is how each function is written.
 * A test keeps this list equal to the folders on disk.
 */
export const EDGE_FUNCTIONS = Object.freeze([
  { name: 'account-recovery', what: 'Self-service account recovery', auth: 'In code' },
  { name: 'admin-revoke-sessions', what: 'Signs a user out everywhere', auth: 'In code' },
  { name: 'ai-orchestrator', what: 'Routes a question to the right agent', auth: 'In code' },
  { name: 'billing-checkout', what: 'Stripe checkout (billing not live)', auth: 'In code' },
  { name: 'billing-webhook', what: 'Stripe events (billing not live)', auth: 'Signature' },
  { name: 'chat-ai', what: 'Answers assistant questions', auth: 'In code' },
  { name: 'embed-worker', what: 'Background document indexing', auth: 'Cron secret' },
  { name: 'generate-embedding', what: 'Turns documents into search vectors', auth: 'Gateway and in code' },
  { name: 'public-api', what: 'External API for customers', auth: 'API key' },
  { name: 'send-email', what: 'Sends report and case emails', auth: 'In code' },
  { name: 'send-scheduled-reports', what: 'Builds and mails scheduled reports', auth: 'In code or cron secret' },
  { name: 'sentry-crash-alert', what: 'Fatal crash alerts', auth: 'Cron secret' },
  { name: 'sentry-issues', what: 'Crash list for the Error Center', auth: 'In code' },
  { name: 'tenant-export', what: 'Exports one company\'s data', auth: 'In code or cron secret' },
  { name: 'workflow-notify', what: 'Push and email for approvals', auth: 'Shared secret' },
])

/* ── releases ───────────────────────────────────────────────────────────── */

export const PLATFORMS = Object.freeze([
  { key: 'web', label: 'Web app' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'android', label: 'Android' },
  { key: 'flutter', label: 'Flutter' },
  { key: 'database', label: 'Database' },
])

/**
 * Verdict on errors before vs after a release. Only when both windows are the
 * same length and complete; small counts are called "Higher" or "Lower", never
 * "Failed", because a handful of errors is not proof of a bad release.
 */
export function errorVerdict(w) {
  if (!w || w.before === null || w.before === undefined || w.after === null || w.after === undefined) return 'N/A'
  if (!w.complete) return 'Too early'
  const b = Number(w.before); const a = Number(w.after)
  if (a - b >= 3 && a >= b * 1.5) return 'Higher'
  if (b - a >= 3 && a <= b / 1.5) return 'Lower'
  return 'Similar'
}

/**
 * One timeline from what is actually recorded:
 *  - editorial web release notes shipped with the build (date only, no time);
 *  - applied database migrations, one entry per Riyadh day;
 *  - the Android minimum / latest setting change;
 *  - releases and rollbacks recorded by hand (public.releases).
 * The Vercel deploy list is NOT connected, so web entries have no commit time.
 */
export function buildReleaseTimeline({ notes = [], migrations = [], android = null, recorded = [], liveBuild = null } = {}) {
  const out = []
  const liveShort = liveBuild && liveBuild !== 'local' && liveBuild !== 'development' ? String(liveBuild).slice(0, 7) : null
  ;(notes || []).forEach((n, i) => {
    const texts = (n.changes || []).map((c) => c?.text?.en).filter(Boolean)
    out.push({
      id: `note-${n.id}`,
      platform: 'web',
      at: n.date ? new Date(`${n.date}T12:00:00Z`) : null,
      timeKnown: false,
      version: i === 0 && liveShort ? liveShort : n.id,
      title: texts[0] ? firstSentence(texts[0]) : 'Web release',
      detail: texts.join(' '),
      status: i === 0 ? 'Live' : 'Superseded',
      source: 'Release notes in the build',
      modules: (n.changes || []).flatMap((c) => c.modules || []),
    })
  })
  const byDay = new Map()
  for (const m of migrations || []) {
    const at = migrationDate(m.version)
    const key = riyadhDayKey(at)
    if (!key) continue
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push({ ...m, at })
  }
  for (const [key, list] of byDay) {
    list.sort((a, b) => a.at - b.at)
    const last = list[list.length - 1]
    out.push({
      id: `db-${key}`,
      platform: 'database',
      at: last.at,
      timeKnown: true,
      version: list.length === 1 ? last.version : `${list.length} migrations`,
      range: list.length > 1 ? `${list[0].version} to ${last.version}` : null,
      title: list.length === 1 ? migrationTitle(last.name) : `${list.length} database changes, latest: ${migrationTitle(last.name)}`,
      detail: list.map((m) => migrationTitle(m.name)).join('; '),
      status: 'Applied',
      source: 'Applied migrations',
    })
  }
  if (android && android.updatedAt && (android.min || android.latest)) {
    out.push({
      id: 'android-gate',
      platform: 'android',
      at: new Date(android.updatedAt),
      timeKnown: true,
      version: android.latest || android.min,
      title: `Android ${android.latest || 'N/A'} recorded as released, minimum ${android.min || 'not set'}`,
      detail: 'Phones below the minimum must update before they can sign in.',
      status: 'Current',
      source: 'App version settings',
    })
  }
  for (const r of recorded || []) {
    out.push({
      id: `rec-${r.id}`,
      platform: r.platform || (r.kind === 'rollback' ? 'web' : 'manual'),
      at: r.released_at ? new Date(r.released_at) : null,
      timeKnown: Boolean(r.released_at),
      version: r.version,
      title: r.kind === 'rollback' ? `Rolled back to ${r.to_version || r.version}` : (r.notes ? firstSentence(r.notes) : `Release ${r.version}`),
      detail: r.kind === 'rollback' ? `From ${r.from_version || 'unknown'}. Reason: ${r.reason || 'N/A'}` : (r.notes || ''),
      status: r.kind === 'rollback' ? 'Rollback' : 'Recorded',
      source: 'Recorded by hand',
      kind: r.kind || 'release',
    })
  }
  return out.sort((a, b) => (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0))
}

function firstSentence(text) {
  const s = String(text || '').trim()
  const m = s.match(/^(.{20,140}?[.!?])(\s|$)/)
  return m ? m[1].replace(/[.!?]$/, '') : (s.length > 140 ? `${s.slice(0, 137)}...` : s)
}

/** Filter the timeline by platform, period (days) and a search term. */
export function filterTimeline(events = [], { platform = 'all', days = 30, search = '', now = Date.now() } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const since = days ? now - days * 86400000 : null
  return (events || []).filter((e) => {
    if (platform !== 'all' && e.platform !== platform) return false
    if (since && e.at && e.at.getTime() < since) return false
    if (q && ![e.title, e.detail, e.version, e.range].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

/** Group events by Riyadh day, newest first. */
export function groupByDay(events = []) {
  const groups = []
  const idx = new Map()
  for (const e of events) {
    const key = e.at ? riyadhDayKey(e.at) : 'unknown'
    if (!idx.has(key)) { idx.set(key, groups.length); groups.push({ key, label: e.at ? riyadhDay(e.at) : 'Date unknown', events: [] }) }
    groups[idx.get(key)].events.push(e)
  }
  return groups
}

/** Count per platform for the filter chips. */
export function platformCounts(events = []) {
  const out = { all: events.length }
  for (const e of events) out[e.platform] = (out[e.platform] || 0) + 1
  return out
}
