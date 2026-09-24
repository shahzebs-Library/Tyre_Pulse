/**
 * Security Audit engine (pure). Shapes the server's posture payload for the
 * console page and summarises it. The checks themselves run in the database
 * (admin_security_posture) so the page can never drift from the live catalog.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low']

export const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

export const STATUS_LABEL = {
  pass: 'Passing',
  fail: 'Failing',
  warn: 'Warning',
  info: 'Information',
  manual: 'Check by hand',
}

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const STATUS_RANK = { fail: 0, warn: 1, manual: 2, info: 3, pass: 4 }

/** A check needs attention when it fails, warns, or cannot be read by SQL. */
export function needsAttention(check) {
  return check?.status === 'fail' || check?.status === 'warn' || check?.status === 'manual'
}

/** Worst first: status, then severity, then title. */
export function sortChecks(checks = []) {
  return [...checks].sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
    || (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9)
    || String(a.title).localeCompare(String(b.title)))
}

export function shapePosture(raw) {
  if (!raw || typeof raw !== 'object') return null
  const checks = Array.isArray(raw.checks) ? raw.checks.map((c) => ({
    id: c.id,
    category: c.category || 'Other',
    title: c.title || c.id,
    severity: SEVERITIES.includes(c.severity) ? c.severity : 'low',
    status: c.status || 'info',
    count: c.count === null || c.count === undefined ? null : Number(c.count),
    items: Array.isArray(c.items) ? c.items : [],
    explain: c.explain || '',
    fix: c.fix || '',
  })) : []
  return {
    generatedAt: raw.generated_at || null,
    score: raw.score === null || raw.score === undefined ? null : Number(raw.score),
    checks: sortChecks(checks),
    activity: raw.activity || {},
    newFindings: Array.isArray(raw.new_findings) ? raw.new_findings : [],
  }
}

export function postureSummary(posture) {
  const checks = posture?.checks || []
  const open = checks.filter((c) => c.status === 'fail' || c.status === 'warn')
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((c) => c.severity === s).length]))
  return {
    total: checks.length,
    passing: checks.filter((c) => c.status === 'pass').length,
    failing: checks.filter((c) => c.status === 'fail').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    manual: checks.filter((c) => c.status === 'manual').length,
    open: open.length,
    bySeverity,
    categories: [...new Set(checks.map((c) => c.category))].sort(),
  }
}

/** Oldest-first series for the score trend chart. */
export function scanTrend(runs = []) {
  const sorted = [...runs].filter((r) => r?.ran_at).sort((a, b) => new Date(a.ran_at) - new Date(b.ran_at))
  return {
    labels: sorted.map((r) => new Date(r.ran_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })),
    scores: sorted.map((r) => (r.score === null || r.score === undefined ? null : Number(r.score))),
  }
}
