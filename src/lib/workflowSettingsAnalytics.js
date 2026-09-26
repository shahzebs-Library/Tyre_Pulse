/**
 * Approval-workflow configuration analytics (pure, no I/O, no Supabase).
 *
 * Feeds the Workflow Settings page: design KPIs over `workflow_definitions`
 * (how many chains, how long they are, what evidence they demand), a per
 * definition health check, entity coverage, and usage/SLA figures over a
 * sample of `workflow_instances`.
 *
 * Deterministic: `now` is injectable. Nothing is fabricated: SLA compliance
 * is only computed for instances whose current step actually carries an SLA,
 * cycle time only for instances that completed, and every figure that has no
 * basis returns null (N/A in the UI).
 */

const HOUR_MS = 60 * 60 * 1000

/** Maximum steps the server-side validator allows (validate_workflow_steps). */
export const MAX_STEPS = 10

function toMillis(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  const ms = Date.parse(String(v))
  return Number.isNaN(ms) ? null : ms
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function stepsOf(def) {
  return Array.isArray(def?.steps) ? def.steps : []
}

/** Total SLA hours across a definition's steps; null if no step has one. */
export function chainSlaHours(def) {
  const slas = stepsOf(def).map((s) => numOrNull(s?.sla_hours)).filter((h) => h != null && h > 0)
  return slas.length ? slas.reduce((a, b) => a + b, 0) : null
}

/**
 * Health issues for one definition. Codes, not prose; labels live in
 * DEFINITION_ISSUE_LABELS so the UI and export read the same wording.
 */
export function definitionIssues(def, allDefs = []) {
  const issues = []
  const steps = stepsOf(def)
  if (steps.length === 0) issues.push('no_steps')
  if (steps.length > MAX_STEPS) issues.push('too_many_steps')
  if (!String(def?.entity_type || '').trim()) issues.push('no_entity')
  steps.forEach((s) => {
    if (s?.assignee_type === 'user') {
      if (!String(s?.approver_user_id || '').trim()) issues.push('user_step_unassigned')
    } else if (!String(s?.approver_role || '').trim()) {
      issues.push('role_step_unassigned')
    }
    if (numOrNull(s?.sla_hours) == null || numOrNull(s?.sla_hours) <= 0) issues.push('step_no_sla')
    if (s?.condition && typeof s.condition === 'object' && s.condition.field && (s.condition.value == null || s.condition.value === '')) {
      issues.push('condition_incomplete')
    }
  })
  if (steps.length && steps.every((s) => s?.optional)) issues.push('all_optional')
  if (def?.active && def?.entity_type) {
    const clash = (Array.isArray(allDefs) ? allDefs : []).some((o) => o !== def && o?.id !== def?.id && o?.active
      && o.entity_type === def.entity_type && (o.trigger_event || 'manual') === (def.trigger_event || 'manual'))
    if (clash) issues.push('trigger_conflict')
  }
  return [...new Set(issues)]
}

export const DEFINITION_ISSUE_LABELS = {
  no_steps: 'No approval steps',
  too_many_steps: `More than ${MAX_STEPS} steps`,
  no_entity: 'No entity type',
  user_step_unassigned: 'A user step has no user chosen',
  role_step_unassigned: 'A role step has no role chosen',
  step_no_sla: 'A step has no SLA hours',
  condition_incomplete: 'A step condition has no value',
  all_optional: 'Every step is optional',
  trigger_conflict: 'Another active workflow uses the same entity and trigger',
}

/** Severity of an issue set: 'ok' | 'warning' | 'error'. */
export function healthLevel(issues = []) {
  const errors = ['no_steps', 'too_many_steps', 'no_entity', 'user_step_unassigned', 'role_step_unassigned', 'trigger_conflict']
  if (issues.some((i) => errors.includes(i))) return 'error'
  return issues.length ? 'warning' : 'ok'
}

/** One flat row per definition for the table and exports. */
export function definitionRows(defs = []) {
  const list = Array.isArray(defs) ? defs : []
  return list.map((d) => {
    const steps = stepsOf(d)
    const issues = definitionIssues(d, list)
    return {
      id: d.id,
      name: d.name || 'Untitled',
      entity_type: d.entity_type || '',
      trigger_event: d.trigger_event || 'manual',
      active: !!d.active,
      steps: steps.length,
      sla_hours: chainSlaHours(d),
      roles: [...new Set(steps.map((s) => (s?.assignee_type === 'user' ? 'Named user' : s?.approver_role)).filter(Boolean))],
      evidence: {
        signature: steps.filter((s) => s?.require_signature).length,
        photo: steps.filter((s) => s?.require_photo).length,
        gps: steps.filter((s) => s?.require_gps).length,
      },
      conditional: steps.filter((s) => s?.condition?.field).length,
      optional: steps.filter((s) => s?.optional).length,
      issues,
      health: healthLevel(issues),
      updated_at: d.updated_at || d.created_at || null,
      _def: d,
    }
  })
}

/** Design KPIs over the definitions. */
export function summarizeDefinitions(defs = []) {
  const rows = definitionRows(defs)
  const active = rows.filter((r) => r.active)
  const stepCounts = rows.map((r) => r.steps)
  const slas = rows.map((r) => r.sla_hours).filter((h) => h != null)
  const entities = new Set(rows.map((r) => r.entity_type).filter(Boolean))
  const activeEntities = new Set(active.map((r) => r.entity_type).filter(Boolean))
  const withEvidence = rows.filter((r) => r.evidence.signature || r.evidence.photo || r.evidence.gps).length
  return {
    total: rows.length,
    active: active.length,
    inactive: rows.length - active.length,
    entities: entities.size,
    activeEntities: activeEntities.size,
    avgSteps: stepCounts.length ? Math.round((stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length) * 10) / 10 : null,
    avgChainSlaHours: slas.length ? Math.round((slas.reduce((a, b) => a + b, 0) / slas.length) * 10) / 10 : null,
    withEvidence,
    withIssues: rows.filter((r) => r.issues.length).length,
    withErrors: rows.filter((r) => r.health === 'error').length,
  }
}

/**
 * Entity coverage: for every entity type seen in the definitions or in the
 * supplied reference list, how many active and inactive chains exist.
 * An entity with zero active chains is `uncovered`.
 */
export function entityCoverage(defs = [], referenceEntities = []) {
  const map = new Map()
  const touch = (e) => { if (e && !map.has(e)) map.set(e, { entity: e, active: 0, inactive: 0 }) }
  for (const e of referenceEntities || []) touch(e)
  for (const d of Array.isArray(defs) ? defs : []) {
    const e = String(d?.entity_type || '').trim()
    if (!e) continue
    touch(e)
    const cur = map.get(e)
    if (d.active) cur.active += 1; else cur.inactive += 1
  }
  return [...map.values()]
    .map((c) => ({ ...c, uncovered: c.active === 0 }))
    .sort((a, b) => Number(b.uncovered) - Number(a.uncovered) || a.entity.localeCompare(b.entity))
}

/** Hours the current step has been waiting, or null. */
function currentStepAgeHours(inst, now) {
  const start = toMillis(inst?.step_started_at ?? inst?.started_at)
  if (start == null) return null
  return (now - start) / HOUR_MS
}

function currentStepSla(inst) {
  const steps = Array.isArray(inst?.steps) ? inst.steps : []
  const idx = numOrNull(inst?.current_step)
  const s = idx != null ? steps[idx] : null
  const h = numOrNull(s?.sla_hours)
  return h != null && h > 0 ? h : null
}

/**
 * Usage + SLA figures over a sample of instances.
 * `sampleOf` is the true total (exact count) so the page can say how much of
 * the history the figures rest on.
 */
export function summarizeInstances(instances = [], { now, sampleOf = null } = {}) {
  const t = toMillis(now ?? new Date()) ?? Date.now()
  const list = Array.isArray(instances) ? instances : []
  const byStatus = { pending: 0, approved: 0, rejected: 0, cancelled: 0, other: 0 }
  let slaTracked = 0; let overdue = 0; const cycles = []
  const byDefinition = new Map()
  for (const i of list) {
    const st = Object.prototype.hasOwnProperty.call(byStatus, i?.status) ? i.status : 'other'
    byStatus[st] += 1
    const name = i?.definition_name || 'Unnamed workflow'
    const d = byDefinition.get(name) || { name, runs: 0, pending: 0, approved: 0, rejected: 0, overdue: 0 }
    d.runs += 1
    if (st === 'pending' || st === 'approved' || st === 'rejected') d[st] += 1
    if (st === 'pending') {
      const sla = currentStepSla(i)
      const age = currentStepAgeHours(i, t)
      if (sla != null && age != null) {
        slaTracked += 1
        if (age > sla) { overdue += 1; d.overdue += 1 }
      }
    }
    const s = toMillis(i?.started_at); const c = toMillis(i?.completed_at)
    if (s != null && c != null && c >= s) cycles.push((c - s) / HOUR_MS)
    byDefinition.set(name, d)
  }
  const decided = byStatus.approved + byStatus.rejected
  cycles.sort((a, b) => a - b)
  const median = cycles.length
    ? (cycles.length % 2 ? cycles[(cycles.length - 1) / 2] : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2)
    : null
  return {
    sampled: list.length,
    sampleOf: sampleOf ?? list.length,
    byStatus,
    overdue,
    slaTracked,
    slaCompliancePct: slaTracked ? Math.round(((slaTracked - overdue) / slaTracked) * 1000) / 10 : null,
    approvalRatePct: decided ? Math.round((byStatus.approved / decided) * 1000) / 10 : null,
    medianCycleHours: median == null ? null : Math.round(median * 10) / 10,
    byDefinition: [...byDefinition.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
  }
}

/** Filter the definition rows for the table. */
export function filterDefinitionRows(rows = [], { search = '', status = 'all', entity = 'all', health = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status === 'active' && !r.active) return false
    if (status === 'inactive' && r.active) return false
    if (entity !== 'all' && r.entity_type !== entity) return false
    if (health !== 'all' && r.health !== health) return false
    if (!q) return true
    return [r.name, r.entity_type, r.trigger_event, ...(r.roles || [])].some((v) => String(v || '').toLowerCase().includes(q))
  })
}

/** Flat export rows. */
export function definitionExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    name: r.name,
    entity_type: r.entity_type,
    trigger_event: r.trigger_event,
    status: r.active ? 'Active' : 'Inactive',
    steps: r.steps,
    sla_hours: r.sla_hours ?? '',
    roles: (r.roles || []).join(', '),
    evidence: [r.evidence.signature ? `signature x${r.evidence.signature}` : '', r.evidence.photo ? `photo x${r.evidence.photo}` : '', r.evidence.gps ? `GPS x${r.evidence.gps}` : ''].filter(Boolean).join(', '),
    health: r.health,
    issues: r.issues.map((i) => DEFINITION_ISSUE_LABELS[i] || i).join('; '),
  }))
}
