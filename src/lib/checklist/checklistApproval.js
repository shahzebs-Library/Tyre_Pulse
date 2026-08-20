/**
 * checklistApproval - who signs, in what order, and when it is actually closed.
 *
 * Before V594 a checklist had ONE approver field and one 'pending' state, so a
 * supervisor signature and a final approval were the same event: one person
 * could close a sheet on their own. The owner's rule is two sign-offs - the
 * trade fills and signs, a SUPERVISOR signs it off, and only then the AREA
 * MANAGER closes it.
 *
 * This module owns that ladder for both stacks. The database enforces the same
 * order in guard_checklist_approval_stages, which refuses a stage skip and
 * refuses a close while a blocking mark remains; THIS FILE AND THAT TRIGGER ARE
 * A PAIR. Everything here exists so the phone can explain a refusal before
 * somebody signs, not surface a raw 22023 afterwards.
 *
 * MIRROR: mobile/lib/checklistApproval.ts, pinned by src/test/checklistApproval.test.js.
 */

export const STAGE_SUPERVISOR = 'supervisor'
export const STAGE_AREA_MANAGER = 'area_manager'

export const APPROVAL_STAGES = [
  {
    key: STAGE_SUPERVISOR,
    label: 'Supervisor sign-off',
    /** profiles.role values that may act. Compared case/spacing-insensitively. */
    // V600: the trades' own supervisors sign first. Manager, Director and
    // Fleet Supervisor came OFF this rung - they are not who signs.
    roles: ['Admin', 'Maintenance Supervisor', 'Workshop Supervisor',
            'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager',
            'Tyre Data Collector'],
  },
  {
    key: STAGE_AREA_MANAGER,
    label: 'Area manager approval',
    // Admin and Director are here deliberately: exactly ONE person holds an
    // area-manager role today, and a queue only they can clear jams the moment
    // they take leave.
    roles: ['Admin', 'Director', 'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager'],
  },
]

const BY_KEY = Object.fromEntries(APPROVAL_STAGES.map((s) => [s.key, s]))

/** 'Tyre Man' and 'tyre_man' are the same role. The DB stores Title Case. */
export function normaliseRole(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function isTwoStage(template) {
  return Boolean(template?.require_area_manager)
}

/**
 * Which stage is outstanding on this submission, or null when nothing is.
 * Reads the submission's OWN status, so a sheet that has moved on since the
 * list was drawn resolves correctly rather than by position in a queue.
 */
export function stageFor(template, submission) {
  const st = String(submission?.approval_status ?? '')
  if (st === 'pending') return STAGE_SUPERVISOR
  if (st === 'pending_area_manager') return STAGE_AREA_MANAGER
  return null
}

/** The status a sign-off moves the submission to. */
export function nextStatusFor(template, submission, approved) {
  if (!approved) return 'rejected'
  const stage = stageFor(template, submission)
  if (stage === STAGE_SUPERVISOR && isTwoStage(template)) return 'pending_area_manager'
  if (stage) return 'approved'
  return String(submission?.approval_status ?? 'approved')
}

export function canActOnStage(stage, role, opts = {}) {
  if (opts.isSuperAdmin) return true
  const def = BY_KEY[stage]
  if (!def) return false
  const r = normaliseRole(role)
  return def.roles.some((x) => normaliseRole(x) === r)
}

/** Can this person do anything at all with this submission right now? */
export function canDecide(template, submission, role, opts = {}) {
  const stage = stageFor(template, submission)
  return stage ? canActOnStage(stage, role, opts) : false
}

export function stageLabel(stage) {
  return BY_KEY[stage]?.label ?? ''
}

/**
 * The full ladder with what has happened on each rung, for the "on click should
 * be able to see" panel: who signed, when, and their signature.
 */
export function approvalProgress(template, submission) {
  const two = isTwoStage(template)
  const st = String(submission?.approval_status ?? '')
  const rows = [{
    key: STAGE_SUPERVISOR,
    label: two ? 'Supervisor sign-off' : 'Approval',
    name: submission?.supervisor_name ?? (two ? null : submission?.approver_name) ?? null,
    signature: submission?.supervisor_signature ?? (two ? null : submission?.approver_signature) ?? null,
    at: submission?.supervisor_at ?? (two ? null : submission?.approved_at) ?? null,
    done: two
      ? Boolean(submission?.supervisor_at) || st === 'pending_area_manager' || st === 'approved'
      : st === 'approved',
    current: two ? st === 'pending' : st === 'pending',
  }]
  if (two) {
    rows.push({
      key: STAGE_AREA_MANAGER,
      label: 'Area manager approval',
      name: submission?.approver_name ?? null,
      signature: submission?.approver_signature ?? null,
      at: submission?.approved_at ?? null,
      done: st === 'approved',
      current: st === 'pending_area_manager',
    })
  }
  return rows
}

/** Closed means CLOSED - not "a supervisor looked at it". */
export function isFullyClosed(submission) {
  return String(submission?.approval_status ?? '') === 'approved'
}

export function isRejected(submission) {
  return String(submission?.approval_status ?? '') === 'rejected'
}

/**
 * One line saying where a sheet has got to. Deliberately says "waiting for the
 * area manager" rather than "pending", because "pending" told the reader
 * nothing about who is holding it.
 */
export function statusSummary(template, submission) {
  const st = String(submission?.approval_status ?? '')
  if (st === 'approved') return { tone: 'good', text: 'Closed' }
  if (st === 'rejected') return { tone: 'bad', text: 'Sent back' }
  if (st === 'pending_area_manager') return { tone: 'warn', text: 'Waiting for the area manager' }
  if (st === 'pending') return { tone: 'warn', text: isTwoStage(template) ? 'Waiting for a supervisor' : 'Waiting for approval' }
  return { tone: 'muted', text: 'No approval needed' }
}
