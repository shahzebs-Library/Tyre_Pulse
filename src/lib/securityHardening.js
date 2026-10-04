/**
 * Security Center helpers (pure, no I/O).
 *
 * remediationStats: age of open findings and how fast they get fixed, read from
 * the scan history (security_scan_runs.failing = the fail + warn check ids of
 * each run). There is no findings table with a stable owner yet, so:
 *   - "open since" is the first scan of the unbroken streak that still fails,
 *   - "fixed" means a check that failed in an earlier scan and passes now,
 *   - owners are not recorded anywhere, so they are reported as null (N/A).
 *
 * hardeningTasks: a short ranked list of what to switch on next, derived from
 * the live posture and the policy switches. Recommendations only; each links to
 * the switch that does it, where the change carries its own impact box.
 */

const DAY_MS = 86400000

function toTime(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function nowTime(now) {
  return now instanceof Date ? now.getTime() : (toTime(now) ?? Date.now())
}

/** Runs oldest first, each with a Set of failing ids. Junk rows dropped. */
export function normaliseRuns(runs = []) {
  return (runs || [])
    .map((r) => ({ at: toTime(r?.ran_at), failing: new Set(Array.isArray(r?.failing) ? r.failing : []) }))
    .filter((r) => r.at !== null)
    .sort((a, b) => a.at - b.at)
}

/**
 * First scan time of the unbroken streak (ending at the latest scan) in which
 * `id` was failing. Null when the latest scan does not list it.
 */
export function openSince(id, runs = []) {
  const list = normaliseRuns(runs)
  if (!list.length || !list[list.length - 1].failing.has(id)) return null
  let first = list[list.length - 1].at
  for (let i = list.length - 2; i >= 0; i -= 1) {
    if (!list[i].failing.has(id)) break
    first = list[i].at
  }
  return first
}

/** Whole days between two times, never negative. */
export function ageDays(from, now = new Date()) {
  const t = toTime(from) ?? (typeof from === 'number' ? from : null)
  if (t === null) return null
  return Math.max(0, Math.floor((nowTime(now) - t) / DAY_MS))
}

/**
 * @param {object} posture shaped posture (checks with id/status/severity)
 * @param {Array} runs     admin_list_security_scans rows
 * @returns {{open:number, oldestDays:number|null, oldestId:string|null, avgFixDays:number|null,
 *            fixed30:number, owners:null, scans:number, sinceById:Object<string,number|null>}}
 */
export function remediationStats(posture, runs = [], now = new Date()) {
  const checks = posture?.checks || []
  const open = checks.filter((c) => c.status === 'fail' || c.status === 'warn')
  const list = normaliseRuns(runs)
  const sinceById = {}
  let oldest = null
  let oldestId = null
  for (const c of open) {
    const t = openSince(c.id, runs)
    sinceById[c.id] = t
    if (t !== null && (oldest === null || t < oldest)) { oldest = t; oldestId = c.id }
  }

  // A fix = an id that failed in some run and is not failing now.
  const nowOpen = new Set(open.map((c) => c.id))
  const firstSeen = {}
  const lastSeen = {}
  for (const r of list) {
    for (const id of r.failing) {
      if (firstSeen[id] === undefined) firstSeen[id] = r.at
      lastSeen[id] = r.at
    }
  }
  const cutoff = nowTime(now) - 30 * DAY_MS
  const fixes = []
  for (const id of Object.keys(firstSeen)) {
    if (nowOpen.has(id)) continue
    // Fixed at the first run after its last failing run, or "now" when the
    // posture (read live) shows it passing and no later scan exists.
    const after = list.find((r) => r.at > lastSeen[id])
    const fixedAt = after ? after.at : nowTime(now)
    fixes.push({ id, days: (fixedAt - firstSeen[id]) / DAY_MS, fixedAt })
  }
  const fixed30 = fixes.filter((f) => f.fixedAt >= cutoff).length
  const avgFixDays = fixes.length ? Math.round((fixes.reduce((s, f) => s + f.days, 0) / fixes.length) * 10) / 10 : null
  return {
    open: open.length,
    oldestDays: oldest === null ? null : ageDays(oldest, now),
    oldestId,
    avgFixDays,
    fixed30,
    owners: null,
    scans: list.length,
    sinceById,
  }
}

const RISK_RANK = { High: 0, Medium: 1, Low: 2 }
const STATE_RANK = { todo: 0, manual: 1, waiting: 2, done: 3, unknown: 4 }

function checkStatus(posture, id) {
  const c = (posture?.checks || []).find((x) => x.id === id)
  return c ? c.status : null
}

/**
 * @param {object} input
 * @param {object} input.posture       shaped posture (may be null)
 * @param {boolean|null} input.ipAllowlist  console IP allowlist on (null = unknown)
 * @param {boolean|null} input.dualControl  dual control on (null = unknown)
 * @param {number|null} input.reviewsEver   access review campaigns ever run (null = unknown)
 * @param {number|null} input.people        people who can sign in (for copy only)
 * @returns {Array<{key,title,detail,risk,state,to}>} ranked: to do first, by risk
 */
export function hardeningTasks({ posture = null, ipAllowlist = null, dualControl = null, reviewsEver = null, people = null } = {}) {
  const superCheck = (posture?.checks || []).find((x) => x.id === 'super_admin_count')
  const superCount = superCheck && superCheck.count !== null && superCheck.count !== undefined ? superCheck.count : null
  const fromCheck = (id) => {
    const s = checkStatus(posture, id)
    if (s === 'pass') return 'done'
    if (s === 'fail' || s === 'warn') return 'todo'
    if (s === 'manual') return 'manual'
    return 'unknown'
  }
  const bool = (v, on) => (v === null || v === undefined ? 'unknown' : v === on ? 'done' : 'todo')

  const tasks = [
    {
      key: 'few_super_admins', title: 'Keep super admins few', risk: 'High', to: '/console/users',
      state: fromCheck('super_admin_count'),
      detail: superCount == null ? 'Good practice is 2 to 4 super admins.' : `${superCount} super admins. Good practice is 2 to 4.`,
    },
    {
      key: 'admin_2fa', title: 'Two-factor for every admin', risk: 'High', to: '/console/security',
      state: fromCheck('super_admin_mfa'),
      detail: 'Every super admin signs in with a second factor.',
    },
    {
      key: 'short_sessions', title: 'Short admin sessions', risk: 'Medium', to: '/console/sessions',
      state: 'done',
      detail: 'Console signs out after 10 minutes idle and 8 hours at most.',
    },
    {
      key: 'ip_allowlist', title: 'Turn on the console IP allowlist', risk: 'High', to: '/console/access-policies',
      state: bool(ipAllowlist, true),
      detail: 'Only listed networks can open the console.',
    },
    {
      key: 'dual_control', title: 'Turn on dual control', risk: 'High', to: '/console/approvals',
      state: bool(dualControl, true),
      detail: 'A second admin approves bulk role change, data cleanup and restore.',
    },
    {
      key: 'first_review', title: 'Run the first access review', risk: 'Medium', to: '/console/access-reviews',
      state: reviewsEver === null || reviewsEver === undefined ? 'unknown' : reviewsEver > 0 ? 'done' : 'todo',
      detail: reviewsEver ? `${reviewsEver} reviews run.` : `0 reviews ever${people != null ? `, ${people} people can sign in` : ''}.`,
    },
    {
      key: 'leaked_passwords', title: 'Refuse leaked passwords', risk: 'Medium', to: '/console/security-audit?tab=findings',
      state: fromCheck('leaked_password') === 'done' ? 'done' : 'manual',
      detail: 'A Supabase dashboard setting. The database cannot read it, so confirm it by hand.',
    },
    {
      key: 'captcha', title: 'Bot check on sign-in', risk: 'Low', to: '/console/security',
      state: 'waiting',
      detail: 'Waits for a phone app build that sends a bot-check token. Turning it on now would block every phone sign-in.',
    },
  ]
  return tasks.sort((a, b) => (STATE_RANK[a.state] - STATE_RANK[b.state]) || (RISK_RANK[a.risk] - RISK_RANK[b.risk]))
}

export const TASK_STATE_LABEL = { done: 'Done', todo: 'To do', manual: 'Check by hand', waiting: 'Waiting', unknown: 'Could not check' }
export const TASK_STATE_TONE = { done: 'good', todo: 'warning', manual: 'info', waiting: 'quiet', unknown: 'quiet' }

export function taskCounts(tasks = []) {
  return { total: tasks.length, done: tasks.filter((t) => t.state === 'done').length }
}
