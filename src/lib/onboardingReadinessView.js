/**
 * Onboarding readiness - pure view logic for the Onboarding Wizard
 * (/onboarding-wizard). Turns MEASURED system facts (does the org have a
 * registered site, an imported fleet, a configured role matrix...) plus the
 * hand-kept onboarding_tasks checklist into the blocks the page shows:
 * readiness checks, per-phase progress, KPI tiles and a next-actions list.
 *
 * Nothing here is invented. A fact the service could not read is `null`, which
 * makes its check "unknown": it is shown, but it never counts as passed or
 * failed and is left out of the readiness score.
 */
import { PHASE_LABELS } from './onboarding'

/** Readiness phases (the mockup's implementation phases), in order. */
export const READINESS_PHASES = [
  { key: 'organisation', label: 'Organisation setup' },
  { key: 'fleet', label: 'Fleet and sites' },
  { key: 'users', label: 'Users and roles' },
  { key: 'data', label: 'Data import' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'mobile', label: 'Mobile rollout' },
  { key: 'training', label: 'Training and UAT' },
  { key: 'golive', label: 'Go-live' },
]

/** onboarding_tasks.phase -> readiness phase, so tasks can sit beside checks. */
export const TASK_PHASE_TO_READINESS = {
  setup: 'organisation',
  configuration: 'fleet',
  team: 'users',
  data_import: 'data',
  integration: 'integrations',
  training: 'training',
  go_live: 'golive',
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const DAY = 86400000

/**
 * Pick a status from a measured value. `null` facts stay unknown.
 * @returns {'pass'|'warn'|'fail'|'unknown'}
 */
function decide(known, passCond, failCond) {
  if (!known) return 'unknown'
  if (passCond) return 'pass'
  return failCond ? 'fail' : 'warn'
}

function plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}` }

/** Tasks in one task phase, required ones all completed? null when none. */
function phaseTasksDone(tasks, phase) {
  const inPhase = (tasks || []).filter((t) => t?.phase === phase && t?.required !== false)
  if (!inPhase.length) return null
  return { total: inPhase.length, done: inPhase.filter((t) => t.status === 'completed').length }
}

/**
 * Build the readiness checks from measured facts and the task list.
 * Each check: { id, phase, label, status, critical, detail, to, action }.
 * `critical` checks block go-live when they fail.
 */
export function evaluateChecks(facts = {}, tasks = []) {
  const f = facts || {}
  const checks = []
  const add = (c) => checks.push({ critical: false, to: null, action: null, ...c })

  // Organisation
  add({
    id: 'ORG-001', phase: 'organisation', critical: true, label: 'Company profile named',
    status: f.orgNamed == null ? 'unknown' : f.orgNamed ? 'pass' : 'fail',
    detail: f.orgNamed == null ? 'Could not read the company branding record.'
      : f.orgNamed ? 'Legal or display name is set.' : 'No legal or display name is recorded for the company.',
    to: '/settings', action: 'Set the company name',
  })
  add({
    id: 'ORG-002', phase: 'organisation', label: 'Company logo for reports',
    status: f.companyLogo == null ? 'unknown' : f.companyLogo ? 'pass' : 'warn',
    detail: f.companyLogo == null ? 'Could not read the logo setting.'
      : f.companyLogo ? 'A company logo is set for shared reports.' : 'No company logo is set; shared reports use the default mark.',
    to: '/brand-assets', action: 'Review brand assets',
  })

  // Fleet and sites
  add({
    id: 'FLT-001', phase: 'fleet', critical: true, label: 'Sites registered',
    status: decide(isNum(f.sites), f.sites > 0, true),
    detail: isNum(f.sites) ? (f.sites > 0 ? `${plural(f.sites, 'site')} registered.` : 'No sites are registered.') : 'Could not count sites.',
    to: '/sites', action: 'Register sites',
  })
  const regionKnown = isNum(f.sites) && isNum(f.sitesWithRegion)
  const missingRegion = regionKnown ? Math.max(0, f.sites - f.sitesWithRegion) : null
  add({
    id: 'FLT-002', phase: 'fleet', label: 'Every site placed in a region',
    status: !regionKnown || f.sites === 0 ? 'unknown' : missingRegion === 0 ? 'pass' : 'warn',
    detail: !regionKnown ? 'Could not read site regions.' : f.sites === 0 ? 'No sites to place yet.'
      : missingRegion === 0 ? 'All sites have a region.' : `${plural(missingRegion, 'site')} without a region.`,
    to: '/sites', action: 'Assign regions',
  })
  add({
    id: 'FLT-003', phase: 'fleet', critical: true, label: 'Vehicle master imported',
    status: decide(isNum(f.fleet), f.fleet > 0, true),
    detail: isNum(f.fleet) ? (f.fleet > 0 ? `${plural(f.fleet, 'asset')} in the fleet register.` : 'The fleet register is empty.') : 'Could not count the fleet register.',
    to: '/fleet-master', action: 'Import the vehicle master',
  })
  const typeKnown = isNum(f.fleet) && isNum(f.fleetUntyped)
  add({
    id: 'FLT-004', phase: 'fleet', label: 'Assets carry a vehicle type',
    status: !typeKnown || f.fleet === 0 ? 'unknown' : f.fleetUntyped === 0 ? 'pass' : 'warn',
    detail: !typeKnown ? 'Could not read vehicle types.' : f.fleet === 0 ? 'No assets yet.'
      : f.fleetUntyped === 0 ? 'Every asset has a vehicle type.' : `${plural(f.fleetUntyped, 'asset')} without a vehicle type (tyre layouts and CPK cannot be set for them).`,
    to: '/fleet-master', action: 'Fill vehicle types',
  })

  // Users and roles
  add({
    id: 'USR-001', phase: 'users', critical: true, label: 'Team members approved',
    status: decide(isNum(f.approvedUsers), f.approvedUsers >= 2, f.approvedUsers === 0),
    detail: isNum(f.approvedUsers) ? `${plural(f.approvedUsers, 'approved user')}.` : 'Could not read user accounts.',
    to: null, action: 'Approve users (System Console, Users)',
  })
  add({
    id: 'USR-002', phase: 'users', label: 'No sign-ups waiting for approval',
    status: decide(isNum(f.pendingUsers), f.pendingUsers === 0, false),
    detail: isNum(f.pendingUsers) ? (f.pendingUsers === 0 ? 'No one is waiting.' : `${plural(f.pendingUsers, 'person', 'people')} waiting for approval.`) : 'Could not read pending sign-ups.',
    to: null, action: 'Review sign-ups (System Console, Users)',
  })
  add({
    id: 'USR-003', phase: 'users', critical: true, label: 'Role matrix configured',
    status: decide(isNum(f.matrixRows), f.matrixRows > 0, true),
    detail: isNum(f.matrixRows) ? (f.matrixRows > 0 ? `${plural(f.matrixRows, 'role permission')} set.` : 'No role permissions are configured.') : 'Could not read the role matrix.',
    to: null, action: 'Configure roles (System Console, Access Control)',
  })
  const dead = Array.isArray(f.customRolesWithoutModules) ? f.customRolesWithoutModules : null
  add({
    id: 'USR-004', phase: 'users', critical: true, label: 'Every custom role opens at least one module',
    status: dead == null ? 'unknown' : dead.length === 0 ? 'pass' : 'fail',
    detail: dead == null ? 'Could not compare roles with the matrix.'
      : dead.length === 0 ? 'No custom role in use is locked out.' : `Custom roles in use with no module enabled (users see nothing): ${dead.join(', ')}.`,
    to: null, action: 'Enable modules (System Console, Access Control)',
  })
  add({
    id: 'USR-005', phase: 'users', label: 'Approved users have a data scope',
    status: decide(isNum(f.unscopedUsers), f.unscopedUsers === 0, false),
    detail: isNum(f.unscopedUsers) ? (f.unscopedUsers === 0 ? 'Every approved non-admin user has a country and site scope.' : `${plural(f.unscopedUsers, 'approved user')} with no country or site scope (they see no data).`) : 'Could not read user scopes.',
    to: null, action: 'Assign scope (System Console, Users)',
  })

  // Data import
  add({
    id: 'DAT-001', phase: 'data', critical: true, label: 'Tyre records imported',
    status: decide(isNum(f.tyres), f.tyres > 0, true),
    detail: isNum(f.tyres) ? (f.tyres > 0 ? `${plural(f.tyres, 'tyre record')}.` : 'No tyre records yet.') : 'Could not count tyre records.',
    to: '/data-intake', action: 'Import tyre records',
  })
  add({
    id: 'DAT-002', phase: 'data', label: 'Job cards imported',
    status: f.hasWorkOrders == null ? 'unknown' : f.hasWorkOrders ? 'pass' : 'warn',
    detail: f.hasWorkOrders == null ? 'Could not read job cards.' : f.hasWorkOrders ? 'Job cards are present.' : 'No job cards yet.',
    to: '/data-intake', action: 'Import job cards',
  })
  add({
    id: 'DAT-003', phase: 'data', label: 'Expense lines imported',
    status: f.hasExpenses == null ? 'unknown' : f.hasExpenses ? 'pass' : 'warn',
    detail: f.hasExpenses == null ? 'Could not read expense lines.' : f.hasExpenses ? 'Expense lines are present.' : 'No expense lines yet; cost reports will be empty.',
    to: '/erp-intake', action: 'Import the expense grid',
  })

  // Integrations
  add({
    id: 'INT-001', phase: 'integrations', label: 'Import pipeline used',
    status: f.hasImportBatches == null ? 'unknown' : f.hasImportBatches ? 'pass' : 'warn',
    detail: f.hasImportBatches == null ? 'Could not read import history.' : f.hasImportBatches ? 'At least one import batch is recorded.' : 'No import batch is recorded yet.',
    to: '/data-intake', action: 'Run a first import',
  })
  add({
    id: 'INT-002', phase: 'integrations', label: 'API key issued for system integrations',
    status: decide(isNum(f.apiKeys), f.apiKeys > 0, false),
    detail: isNum(f.apiKeys) ? (f.apiKeys > 0 ? `${plural(f.apiKeys, 'active API key')}.` : 'No active API key. Only needed if an outside system pushes data.') : 'Could not read API keys (your role may not see them).',
    to: '/developer-portal', action: 'Issue an API key',
  })

  // Mobile rollout
  add({
    id: 'MOB-001', phase: 'mobile', label: 'Phones registered for the field app',
    status: decide(isNum(f.devices), f.devices > 0, false),
    detail: isNum(f.devices) ? (f.devices > 0 ? `${plural(f.devices, 'active device')} visible to you.` : 'No active device is registered.') : 'Could not read registered devices.',
    to: null, action: 'Install the field app on phones',
  })
  add({
    id: 'MOB-002', phase: 'mobile', label: 'Pilot inspections recorded',
    status: decide(isNum(f.inspections), f.inspections > 0, false),
    detail: isNum(f.inspections) ? (f.inspections > 0 ? `${plural(f.inspections, 'inspection')} recorded.` : 'No inspection recorded yet.') : 'Could not count inspections.',
    to: '/inspections', action: 'Run a pilot inspection',
  })

  // Training and go-live: only the task checklist can speak to these.
  const training = phaseTasksDone(tasks, 'training')
  add({
    id: 'TRN-001', phase: 'training', label: 'Training and UAT tasks complete',
    status: training == null ? 'unknown' : training.done === training.total ? 'pass' : 'warn',
    detail: training == null ? 'No Training and UAT task in the checklist, so this is not tracked.' : `${training.done} of ${training.total} required tasks complete.`,
    to: null, action: 'Add Training and UAT tasks',
  })
  const golive = phaseTasksDone(tasks, 'go_live')
  add({
    id: 'GOL-001', phase: 'golive', critical: true, label: 'Management sign-off',
    status: golive == null ? 'unknown' : golive.done === golive.total ? 'pass' : 'fail',
    detail: golive == null ? 'No Go Live task in the checklist, so sign-off is not tracked.' : `${golive.done} of ${golive.total} required go-live tasks complete.`,
    to: null, action: 'Add a sign-off task',
  })
  return checks
}

/** Readiness score over MEASURED checks only. score null when nothing measured. */
export function readinessScore(checks = []) {
  const measured = checks.filter((c) => c.status !== 'unknown')
  const passed = measured.filter((c) => c.status === 'pass').length
  return {
    score: measured.length ? Math.round((passed / measured.length) * 100) : null,
    passed,
    measured: measured.length,
    total: checks.length,
    unknown: checks.length - measured.length,
  }
}

/** Critical checks that are failing (these prevent go-live). */
export function criticalOpen(checks = []) {
  return checks.filter((c) => c.critical && c.status === 'fail')
}

/**
 * Per readiness phase: checks passed / measured, plus task completion for the
 * mapped task phase. pct null when the phase has nothing measured.
 */
export function phaseReadiness(checks = [], tasks = []) {
  return READINESS_PHASES.map(({ key, label }) => {
    const inPhase = checks.filter((c) => c.phase === key)
    const measured = inPhase.filter((c) => c.status !== 'unknown')
    const passed = measured.filter((c) => c.status === 'pass').length
    const taskPhases = Object.entries(TASK_PHASE_TO_READINESS).filter(([, r]) => r === key).map(([t]) => t)
    const phaseTasks = (tasks || []).filter((t) => taskPhases.includes(t?.phase))
    return {
      key,
      label,
      passed,
      measured: measured.length,
      checks: inPhase.length,
      pct: measured.length ? Math.round((passed / measured.length) * 100) : null,
      tasksTotal: phaseTasks.length,
      tasksDone: phaseTasks.filter((t) => t.status === 'completed').length,
    }
  })
}

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
function parseDue(v) {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

const OPEN = new Set(['not_started', 'in_progress', 'blocked'])

/** Task KPIs: activation progress, blocked, due this week (and overdue). */
export function taskKpis(tasks = [], now = new Date()) {
  const list = Array.isArray(tasks) ? tasks : []
  const today = dayStart(now)
  const weekEnd = today + 7 * DAY
  const open = list.filter((t) => OPEN.has(t?.status))
  const dueWeek = open.filter((t) => { const d = parseDue(t.due_date); return d != null && d >= today && d < weekEnd })
  const overdue = open.filter((t) => { const d = parseDue(t.due_date); return d != null && d < today })
  const completed = list.filter((t) => t?.status === 'completed').length
  return {
    total: list.length,
    completed,
    completionPct: list.length ? Math.round((completed / list.length) * 100) : null,
    blocked: list.filter((t) => t?.status === 'blocked').length,
    dueThisWeek: dueWeek.length,
    dueThisWeekPhases: new Set(dueWeek.map((t) => t.phase)).size,
    overdue: overdue.length,
  }
}

/**
 * Next actions and risks: failing and warning checks, then blocked and overdue
 * tasks. Priority: High (critical fail, blocked, overdue), Medium (warning).
 */
export function nextActions(checks = [], tasks = [], now = new Date()) {
  const today = dayStart(now)
  const rows = []
  for (const c of checks) {
    if (c.status !== 'fail' && c.status !== 'warn') continue
    rows.push({
      key: c.id, id: c.id, kind: 'check', title: c.detail,
      priority: c.status === 'fail' && c.critical ? 'High' : c.status === 'fail' ? 'High' : 'Medium',
      owner: null, due: null, step: c.action, to: c.to, area: READINESS_PHASES.find((p) => p.key === c.phase)?.label,
    })
  }
  for (const t of (tasks || [])) {
    if (!OPEN.has(t?.status)) continue
    const due = parseDue(t.due_date)
    const isOverdue = due != null && due < today
    if (t.status !== 'blocked' && !isOverdue) continue
    rows.push({
      key: `task-${t.id}`, id: 'TASK', kind: 'task', task: t,
      title: t.status === 'blocked' ? `Blocked: ${t.title}` : `Overdue: ${t.title}`,
      priority: 'High', owner: t.owner || null, due: t.due_date || null,
      step: t.status === 'blocked' ? 'Clear the blocker' : 'Complete or reschedule', to: null,
      area: PHASE_LABELS[t.phase] || t.phase,
    })
  }
  const rank = { High: 0, Medium: 1 }
  return rows.sort((a, b) => (rank[a.priority] - rank[b.priority]) || String(a.id).localeCompare(String(b.id)))
}

/** Map each task id to its title, for the "Depends on" column. */
export function dependencyTitles(tasks = []) {
  return new Map((tasks || []).map((t) => [t.id, t.title]))
}
