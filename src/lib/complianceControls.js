/**
 * Compliance control catalogue (pure, no I/O).
 *
 * Each control is mapped to SOC 2 Trust Services Criteria and ISO/IEC 27001:2022
 * Annex A, and evaluates LIVE evidence gathered by src/lib/api/compliance.js.
 *
 * THE HONESTY RULES this file exists to hold:
 * - A source that failed to load makes every control that depends on it
 *   `unknown`. It is never read as a pass (and never as a fail either: "we could
 *   not look" is not "it is broken").
 * - A control SQL cannot measure is `manual` until a super admin attests it,
 *   and goes back to `manual` when the attestation expires or is withdrawn.
 * - The readiness score counts manual controls as not yet evidenced and leaves
 *   unknown controls out, reporting coverage beside the score so a high score
 *   over half the catalogue cannot pass for a high score over all of it.
 *
 * Evidence shape (every key optional): { [source]: { ok: boolean, data, error } }
 * sources: posture, scans, breakGlass, accessReviews, seals, backups,
 *          consoleSessions, config, attestations
 */

export const STATUSES = ['pass', 'warn', 'fail', 'manual', 'unknown']

export const STATUS_LABEL = {
  pass: 'Passing',
  warn: 'Needs attention',
  fail: 'Failing',
  manual: 'Needs attestation',
  unknown: 'Could not check',
}

export const FRAMEWORKS = [
  { value: 'all', label: 'All' },
  { value: 'soc2', label: 'SOC 2' },
  { value: 'iso', label: 'ISO 27001' },
]

export const SOURCE_LABEL = {
  posture: 'Security posture',
  scans: 'Security scan history',
  breakGlass: 'Break-glass trail',
  accessReviews: 'Access reviews',
  seals: 'Audit seals',
  backups: 'Backup snapshots',
  consoleSessions: 'Console audit trail',
  config: 'System configuration',
  attestations: 'Manual attestations',
}

const DAY = 86400000
const STATUS_RANK = { fail: 0, warn: 1, manual: 2, unknown: 3, pass: 4 }

/* ── helpers ──────────────────────────────────────────────────────────────── */

function src(ev, key) {
  const s = ev?.[key]
  return s && s.ok === true ? s.data : undefined
}

function result(status, detail, evidenceRefs = []) {
  return { status, detail, evidenceRefs }
}

function unknown(sourceKey) {
  return result('unknown', `${SOURCE_LABEL[sourceKey] || sourceKey} could not be loaded, so this control was not evaluated.`, [])
}

function toTime(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

export function ageDays(ts, now = Date.now()) {
  const t = toTime(ts)
  if (t === null) return null
  return Math.max(0, (now - t) / DAY)
}

function fmtDay(ts) {
  const t = toTime(ts)
  return t === null ? 'N/A' : new Date(t).toISOString().slice(0, 10)
}

/** Parsed system_config value (the loader returns raw column values). */
function cfg(config, key) {
  if (!config || !(key in config)) return undefined
  const v = config[key]
  if (typeof v === 'string') {
    const s = v.trim().replace(/^"|"$/g, '')
    if (s === 'true') return true
    if (s === 'false') return false
    if (s !== '' && Number.isFinite(Number(s))) return Number(s)
    return s
  }
  return v
}

const POSTURE_MAP = { pass: 'pass', fail: 'fail', warn: 'warn', info: 'pass', manual: 'manual' }

/** Evaluate one or more posture checks together; worst status wins. */
function postureControl(ev, ids) {
  const posture = src(ev, 'posture')
  if (!posture) return unknown('posture')
  const checks = ids.map((id) => (posture.checks || []).find((c) => c.id === id))
  if (checks.some((c) => !c)) {
    return result('unknown', `The latest posture scan did not include ${ids.filter((_, i) => !checks[i]).join(', ')}.`, [])
  }
  const statuses = checks.map((c) => POSTURE_MAP[c.status] || 'unknown')
  const worst = statuses.reduce((w, s) => ((STATUS_RANK[s] ?? 9) < (STATUS_RANK[w] ?? 9) ? s : w), 'pass')
  const detail = checks.map((c) => `${c.title}: ${POSTURE_MAP[c.status] === 'pass' ? 'passing' : (c.status === 'fail' ? 'failing' : c.status)}${c.count !== null && c.count !== undefined && c.status !== 'pass' ? ` (${c.count})` : ''}`).join('. ')
  return result(worst, detail, checks.map((c) => `admin_security_posture: ${c.id}`))
}

/** Active attestation for a control, or null. */
export function activeAttestation(attestations = [], controlId, now = Date.now()) {
  const live = (attestations || [])
    .filter((a) => a && a.control_id === controlId && !a.withdrawn_at && (toTime(a.expires_at) ?? 0) > now)
    .sort((a, b) => (toTime(b.attested_at) ?? 0) - (toTime(a.attested_at) ?? 0))
  return live[0] || null
}

const EXPIRY_WARN_DAYS = 14

/** A manual control: its status comes only from a current attestation. */
function manualControl(ev, controlId, now) {
  const atts = src(ev, 'attestations')
  if (!atts) return unknown('attestations')
  const a = activeAttestation(atts, controlId, now)
  if (!a) {
    return result('manual', 'This control cannot be measured automatically. Attest it with a note that names the evidence, and an expiry.', [])
  }
  const left = (toTime(a.expires_at) - now) / DAY
  const detail = `Attested by ${a.attested_by_email || 'a super admin'} on ${fmtDay(a.attested_at)}, expires ${fmtDay(a.expires_at)}. Note: ${a.note}`
  return result(left <= EXPIRY_WARN_DAYS ? 'warn' : 'pass', left <= EXPIRY_WARN_DAYS ? `${detail} (expires within ${EXPIRY_WARN_DAYS} days)` : detail, [`compliance_attestations: ${a.id}`])
}

/* ── catalogue ────────────────────────────────────────────────────────────── */

export const CONTROLS = [
  {
    id: 'AC-RLS', domain: 'Access control', sources: ['posture'],
    soc2: ['CC6.1'], iso: ['A.8.3', 'A.5.15'],
    title: 'Row level security on every table',
    description: 'Every table in the public schema enforces row level security, so a user can only ever read and change the rows their organisation, country and site allow.',
    evaluate: (ev) => postureControl(ev, ['rls_disabled']),
  },
  {
    id: 'AC-ANON', domain: 'Access control', sources: ['posture'],
    soc2: ['CC6.1', 'CC6.6'], iso: ['A.8.3', 'A.8.20'],
    title: 'No anonymous data access',
    description: 'Signed-out visitors hold no table grants and can only call the small allowlist of functions the sign-in and public share pages need.',
    evaluate: (ev) => postureControl(ev, ['anon_table_grants', 'anon_definer_functions']),
  },
  {
    id: 'AC-DB-PRIV', domain: 'Access control', sources: ['posture'],
    soc2: ['CC6.1', 'CC8.1'], iso: ['A.8.3', 'A.8.28'],
    title: 'Database privileges are least privilege',
    description: 'Privileged functions pin their search path, no view runs with owner rights, and no application role can truncate a table (row security does not cover truncate).',
    evaluate: (ev) => postureControl(ev, ['definer_search_path', 'owner_views', 'truncate_grants']),
  },
  {
    id: 'AC-STORAGE', domain: 'Access control', sources: ['posture'],
    soc2: ['CC6.1', 'CC6.7'], iso: ['A.8.3', 'A.5.10'],
    title: 'No public file buckets',
    description: 'Uploaded photos and documents are only reachable through signed, expiring links, never through a public bucket.',
    evaluate: (ev) => postureControl(ev, ['public_buckets']),
  },
  {
    id: 'AC-PRIV-ADMIN', domain: 'Access control', sources: ['posture'],
    soc2: ['CC6.2', 'CC6.3'], iso: ['A.8.2', 'A.5.15'],
    title: 'Privileged accounts are few and named',
    description: 'Between two and five super admins exist (no single point of failure, no sprawl), and no plain Admin can reach platform administration.',
    evaluate: (ev) => postureControl(ev, ['super_admin_count', 'plain_admins']),
  },
  {
    id: 'AC-REVIEW', domain: 'Access control', sources: ['accessReviews'],
    soc2: ['CC6.2', 'CC6.3'], iso: ['A.5.18', 'A.8.2'],
    title: 'Access is recertified every quarter',
    description: 'A super admin reviews every user\'s access and closes the review at least every 90 days; revoked users are locked when the review is applied.',
    evaluate: (ev, now) => {
      const reviews = src(ev, 'accessReviews')
      if (!reviews) return unknown('accessReviews')
      const closed = reviews.filter((c) => c.status === 'closed' && c.closed_at)
        .sort((a, b) => toTime(b.closed_at) - toTime(a.closed_at))
      if (!closed.length) {
        const open = reviews.filter((c) => c.status !== 'closed').length
        return result('fail', open ? `No access review has been completed yet (${open} in progress).` : 'No access review has ever been run.', ['admin_list_access_reviews'])
      }
      const last = closed[0]
      const age = ageDays(last.closed_at, now)
      const detail = `Last completed review "${last.name}" closed ${fmtDay(last.closed_at)} (${Math.floor(age)} days ago).`
      return result(age <= 90 ? 'pass' : age <= 120 ? 'warn' : 'fail', detail, [`access_review_campaigns: ${last.id}`])
    },
  },
  {
    id: 'AUTH-MFA', domain: 'Authentication', sources: ['posture', 'config'],
    soc2: ['CC6.1'], iso: ['A.8.5', 'A.5.17'],
    title: 'Multi-factor sign-in for administrators',
    description: 'Every super admin has a verified second factor, and administrators are required to enrol one.',
    evaluate: (ev) => {
      const base = postureControl(ev, ['super_admin_mfa'])
      const config = src(ev, 'config')
      if (!config) return base.status === 'unknown' ? base : { ...base, status: base.status === 'pass' ? 'unknown' : base.status, detail: `${base.detail}. The 2FA requirement setting could not be read.` }
      const required = cfg(config, 'two_factor_required') === true
      if (base.status === 'unknown') return base
      const detail = `${base.detail}. Admin 2FA requirement is ${required ? 'on' : 'off'}.`
      const status = base.status !== 'pass' ? base.status : (required ? 'pass' : 'warn')
      return result(status, detail, [...base.evidenceRefs, 'system_config: two_factor_required'])
    },
  },
  {
    id: 'AUTH-PASSWORD', domain: 'Authentication', sources: ['config'],
    soc2: ['CC6.1'], iso: ['A.5.17'],
    title: 'Password strength policy',
    description: 'New and reset passwords must be at least 12 characters (8 is the floor this control tolerates with a warning).',
    evaluate: (ev) => {
      const config = src(ev, 'config')
      if (!config) return unknown('config')
      const n = cfg(config, 'password_min_length')
      if (typeof n !== 'number') return result('warn', 'No minimum password length is set, so the platform default of 8 applies.', ['system_config: password_min_length'])
      return result(n >= 12 ? 'pass' : n >= 8 ? 'warn' : 'fail', `Minimum password length is ${n} characters.`, ['system_config: password_min_length'])
    },
  },
  {
    id: 'AUTH-LEAKED-PW', domain: 'Authentication', sources: ['attestations'], manual: true,
    soc2: ['CC6.1'], iso: ['A.5.17'],
    title: 'Leaked password protection',
    description: 'Supabase Auth rejects passwords found in known breach lists. SQL cannot read this setting, so it is confirmed by hand in the Supabase dashboard and attested here.',
    evaluate: (ev, now) => manualControl(ev, 'AUTH-LEAKED-PW', now),
  },
  {
    id: 'AUTH-SESSION', domain: 'Authentication', sources: ['config', 'posture'],
    soc2: ['CC6.1'], iso: ['A.8.5'],
    title: 'Idle sign-out and brute-force lockout',
    description: 'Idle sessions sign out automatically and repeated failed sign-ins lock the account for a period.',
    evaluate: (ev) => {
      const config = src(ev, 'config')
      if (!config) return unknown('config')
      const idle = cfg(config, 'session_timeout_hours')
      const attempts = cfg(config, 'max_login_attempts')
      const idleOn = typeof idle === 'number' && idle > 0
      const lockOn = typeof attempts === 'number' && attempts > 0
      const detail = `Idle sign-out ${idleOn ? `after ${idle} hours` : 'is off'}. Account lockout ${lockOn ? `after ${attempts} failed attempts` : 'is off'}. The console always signs out after 10 minutes idle.`
      return result(idleOn && lockOn ? 'pass' : (idleOn || lockOn) ? 'warn' : 'fail', detail, ['system_config: session_timeout_hours', 'system_config: max_login_attempts'])
    },
  },
  {
    id: 'MON-SCAN', domain: 'Monitoring', sources: ['scans', 'posture'],
    soc2: ['CC7.1'], iso: ['A.8.8', 'A.8.16'],
    title: 'Weekly security scan with a healthy score',
    description: 'The security posture scan runs at least weekly and the score stays at 90 or above.',
    evaluate: (ev, now) => {
      const scans = src(ev, 'scans')
      if (!scans) return unknown('scans')
      const sorted = [...scans].filter((r) => r?.ran_at).sort((a, b) => toTime(b.ran_at) - toTime(a.ran_at))
      if (!sorted.length) return result('fail', 'No security scan has ever been recorded.', ['security_scan_runs'])
      const last = sorted[0]
      const age = ageDays(last.ran_at, now)
      const score = last.score === null || last.score === undefined ? null : Number(last.score)
      const fresh = age <= 8 ? 'pass' : age <= 14 ? 'warn' : 'fail'
      const scoreStatus = score === null ? 'warn' : score >= 90 ? 'pass' : score >= 70 ? 'warn' : 'fail'
      const status = STATUS_RANK[fresh] < STATUS_RANK[scoreStatus] ? fresh : scoreStatus
      return result(status, `Last scan ${fmtDay(last.ran_at)} (${Math.floor(age)} days ago) scored ${score === null ? 'N/A' : score}. ${sorted.length} scans on record.`, [`security_scan_runs: ${last.id}`])
    },
  },
  {
    id: 'MON-BREAKGLASS', domain: 'Monitoring', sources: ['breakGlass'],
    soc2: ['CC7.2', 'CC7.3'], iso: ['A.8.16', 'A.5.25'],
    title: 'Privileged activity is alerted',
    description: 'Every console sign-in and every high-risk super-admin action raises a break-glass record and notifies every super admin.',
    evaluate: (ev, now) => {
      const rows = src(ev, 'breakGlass')
      if (!rows) return unknown('breakGlass')
      const recent = rows.filter((r) => (ageDays(r.created_at, now) ?? 999) <= 30).length
      return result('pass', `Break-glass trail is live: ${recent} events in the last 30 days (${rows.length} loaded).`, ['system_logs: source=break_glass'])
    },
  },
  {
    id: 'LOG-SEALS', domain: 'Logging', sources: ['seals'],
    soc2: ['CC7.2'], iso: ['A.8.15', 'A.5.28'],
    title: 'Tamper-evident audit logs',
    description: 'Each audit source is sealed daily into a hash chain, so a changed or deleted record is detectable.',
    evaluate: (ev, now) => {
      const seals = src(ev, 'seals')
      if (!seals) return unknown('seals')
      const expected = ['audit_log_v2', 'access_audit', 'console_sessions']
      const latest = {}
      for (const s of seals) {
        if (!s?.source || !s.day) continue
        if (!latest[s.source] || s.day > latest[s.source]) latest[s.source] = s.day
      }
      const parts = expected.map((k) => {
        const age = latest[k] ? ageDays(`${latest[k]}T23:59:59Z`, now) : null
        return { k, age, day: latest[k] }
      })
      const missing = parts.filter((p) => p.day === undefined)
      const stale = parts.filter((p) => p.age !== null && p.age > 2)
      const detail = parts.map((p) => `${p.k}: ${p.day ? `sealed to ${p.day}` : 'never sealed'}`).join('. ')
      const status = missing.length ? 'fail' : stale.length ? 'warn' : 'pass'
      return result(status, `${detail}. ${seals.length} seals on record.`, ['audit_seals'])
    },
  },
  {
    id: 'LOG-CONSOLE', domain: 'Logging', sources: ['consoleSessions'],
    soc2: ['CC7.2', 'CC8.1'], iso: ['A.8.15', 'A.8.2'],
    title: 'Administrator actions are recorded',
    description: 'Console sign-ins and administrative changes are written server side to the console audit trail, which clients cannot forge.',
    evaluate: (ev, now) => {
      const rows = src(ev, 'consoleSessions')
      if (!rows) return unknown('consoleSessions')
      if (!rows.length) return result('warn', 'The console audit trail is readable but holds no records.', ['console_sessions'])
      const last = rows[0]
      const recent = rows.filter((r) => (ageDays(r.created_at, now) ?? 999) <= 30).length
      return result('pass', `${recent} console actions recorded in the last 30 days; latest ${fmtDay(last.created_at)}.`, ['console_sessions'])
    },
  },
  {
    id: 'LOG-RETENTION', domain: 'Logging', sources: ['config'],
    soc2: ['CC7.2'], iso: ['A.8.15', 'A.5.33'],
    title: 'Audit logs are kept at least a year',
    description: 'Audit and error logs are retained for 365 days or more (0 means keep forever).',
    evaluate: (ev) => {
      const config = src(ev, 'config')
      if (!config) return unknown('config')
      const d = cfg(config, 'audit_retention_days')
      if (typeof d !== 'number' || d === 0) return result('pass', 'Audit logs are kept forever (no retention purge).', ['system_config: audit_retention_days'])
      return result(d >= 365 ? 'pass' : d >= 90 ? 'warn' : 'fail', `Audit logs are purged after ${d} days.`, ['system_config: audit_retention_days'])
    },
  },
  {
    id: 'BAK-NIGHTLY', domain: 'Availability', sources: ['backups', 'config'],
    soc2: ['A1.2'], iso: ['A.8.13'],
    title: 'Nightly backups are running',
    description: 'A snapshot of the core business tables is taken every night and kept for 30 days.',
    evaluate: (ev, now) => {
      const snaps = src(ev, 'backups')
      if (!snaps) return unknown('backups')
      const config = src(ev, 'config')
      const enabled = config ? cfg(config, 'backup_enabled') !== false : null
      const latest = [...snaps].filter((s) => s?.taken_at).sort((a, b) => toTime(b.taken_at) - toTime(a.taken_at))[0]
      if (!latest) return result('fail', `No backup snapshot exists.${enabled === false ? ' Nightly backup is switched off.' : ''}`, ['list_backup_snapshots'])
      const hours = (now - toTime(latest.taken_at)) / 3600000
      let status = hours <= 26 ? 'pass' : hours <= 72 ? 'warn' : 'fail'
      if (enabled === false) status = 'fail'
      const detail = `Latest snapshot ${fmtDay(latest.taken_at)} (${Math.floor(hours)} hours ago), ${latest.table_count ?? 'N/A'} tables. ${snaps.length} snapshots retained.${enabled === false ? ' Nightly backup is switched off.' : enabled === null ? ' The backup switch could not be read.' : ''}`
      return result(status, detail, [`backups.snapshots: ${latest.id}`, 'system_config: backup_enabled'])
    },
  },
  {
    id: 'BAK-RESTORE-TEST', domain: 'Availability', sources: ['attestations'], manual: true,
    soc2: ['A1.3'], iso: ['A.8.13', 'A.5.30'],
    title: 'Restore is tested',
    description: 'A restore from backup (the console preview plus a platform point-in-time restore drill) is exercised and the result recorded at least twice a year.',
    evaluate: (ev, now) => manualControl(ev, 'BAK-RESTORE-TEST', now),
  },
  {
    id: 'CHG-MGMT', domain: 'Change management', sources: ['attestations'], manual: true,
    soc2: ['CC8.1'], iso: ['A.8.32', 'A.8.25'],
    title: 'Changes are reviewed and tested before release',
    description: 'Code changes go through a pull request with automated tests, lint and build checks before they reach production, and database changes are migration files with verify and rollback steps.',
    evaluate: (ev, now) => manualControl(ev, 'CHG-MGMT', now),
  },
  {
    id: 'IR-PLAN', domain: 'Incident response', sources: ['attestations'], manual: true,
    soc2: ['CC7.4', 'CC7.5'], iso: ['A.5.24', 'A.5.26'],
    title: 'Incident response plan',
    description: 'A written incident response plan names who decides, how customers are told and how access is revoked, and it has been reviewed this year.',
    evaluate: (ev, now) => manualControl(ev, 'IR-PLAN', now),
  },
  {
    id: 'VEND-REVIEW', domain: 'Suppliers', sources: ['attestations'], manual: true,
    soc2: ['CC9.2'], iso: ['A.5.19', 'A.5.22'],
    title: 'Critical vendors are reviewed',
    description: 'The security reports of critical suppliers (hosting, database, email, error tracking) are reviewed each year.',
    evaluate: (ev, now) => manualControl(ev, 'VEND-REVIEW', now),
  },
]

export const DOMAINS = [...new Set(CONTROLS.map((c) => c.domain))]

/* ── evaluation ───────────────────────────────────────────────────────────── */

/** Run every control. Never throws: a control that throws is recorded as unknown. */
export function evaluateControls(evidence = {}, now = Date.now(), controls = CONTROLS) {
  return controls.map((c) => {
    let r
    try {
      r = c.evaluate(evidence, now)
    } catch {
      r = result('unknown', 'This control could not be evaluated from the evidence provided.', [])
    }
    if (!r || !STATUSES.includes(r.status)) r = result('unknown', 'This control returned no result.', [])
    return {
      id: c.id,
      domain: c.domain,
      title: c.title,
      description: c.description,
      soc2: c.soc2,
      iso: c.iso,
      manual: !!c.manual,
      sources: c.sources,
      status: r.status,
      detail: r.detail || '',
      evidenceRefs: r.evidenceRefs || [],
    }
  })
}

export function filterByFramework(results = [], framework = 'all') {
  if (framework === 'soc2') return results.filter((r) => r.soc2?.length)
  if (framework === 'iso') return results.filter((r) => r.iso?.length)
  return results
}

/** Worst first: status, then domain, then id. */
export function sortResults(results = []) {
  return [...results].sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
    || String(a.domain).localeCompare(String(b.domain))
    || String(a.id).localeCompare(String(b.id)))
}

/**
 * Readiness: pass = 1, warn = 0.5, fail = 0, manual = 0 (not yet evidenced).
 * Unknown controls are excluded and reported as a coverage gap.
 * Returns score null when nothing could be measured.
 */
export function readinessScore(results = []) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, results.filter((r) => r.status === s).length]))
  const denom = counts.pass + counts.warn + counts.fail + counts.manual
  const score = denom ? Math.round(((counts.pass + counts.warn * 0.5) / denom) * 100) : null
  return {
    score,
    counts,
    total: results.length,
    evaluated: denom,
    coveragePct: results.length ? Math.round((denom / results.length) * 100) : null,
  }
}

/** Per-domain pass share for bar charts. */
export function domainSummary(results = []) {
  const map = new Map()
  for (const r of results) {
    const d = map.get(r.domain) || { domain: r.domain, total: 0, pass: 0, warn: 0, fail: 0, manual: 0, unknown: 0 }
    d.total += 1
    d[r.status] += 1
    map.set(r.domain, d)
  }
  return [...map.values()].map((d) => ({ ...d, passPct: d.total ? Math.round((d.pass / d.total) * 100) : 0 }))
}

/** Sources that failed to load, for the page banner. */
export function failedSources(evidence = {}) {
  return Object.entries(evidence)
    .filter(([, v]) => v && v.ok === false)
    .map(([k, v]) => ({ key: k, label: SOURCE_LABEL[k] || k, error: v.error || 'Could not load' }))
}

/** Flat rows for the evidence pack (PDF + Excel). */
export function evidencePackRows(results = [], generatedAt = new Date().toISOString()) {
  return sortResults(results).map((r) => ({
    control_id: r.id,
    domain: r.domain,
    soc2: (r.soc2 || []).join(', ') || 'N/A',
    iso: (r.iso || []).join(', ') || 'N/A',
    title: r.title,
    status: STATUS_LABEL[r.status] || r.status,
    detail: r.detail || 'N/A',
    evidence: (r.evidenceRefs || []).join('; ') || 'N/A',
    evaluated_at: generatedAt,
  }))
}

export const EVIDENCE_COLUMNS = ['control_id', 'domain', 'soc2', 'iso', 'title', 'status', 'detail', 'evidence', 'evaluated_at']
export const EVIDENCE_HEADERS = ['Control', 'Domain', 'SOC 2', 'ISO 27001', 'Title', 'Status', 'Detail', 'Evidence', 'Evaluated at']
