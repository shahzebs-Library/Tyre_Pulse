/**
 * handoverApproval - who signs a vehicle handover, in what order, and when it
 * is actually closed.
 *
 * A handover_reports row is a flat field record: the driver captures a
 * checkout / checkin and signs it (signature_url). The owner's upgrade adds a
 * TWO-STAGE sign-off ON TOP of that field evidence, modelled on the checklist
 * ladder (checklistApproval.js / V594):
 *
 *     draft -> pending_supervisor -> pending_incharge -> approved
 *                                                     \-> rejected (sent back)
 *
 * A FLEET SUPERVISOR signs the first rung; only then a FLEET INCHARGE closes
 * it. The driver's own field signature is never a sign-off.
 *
 * THIS FILE AND THE SQL decide_handover_approval ARE A PAIR
 * (supabase/migrations/20261112130000_handover_two_stage_signoff.sql). The role
 * sets, the ladder transitions and the close-in-one-sign rule are enforced
 * server-side by that RPC and by guard_handover_approval_stages; everything here
 * exists so the web/Flutter clients can explain who may act and where a sheet
 * has got to WITHOUT surfacing a raw refusal. Change both together, exactly as
 * checklistApproval.js mirrors decide_checklist_approval.
 *
 * SQL predicate mirror:
 *   handover_can_sign_supervisor() = super OR app_is_elevated()
 *       (Admin/Manager/Director) OR role in (Fleet Supervisor, Fleet Incharge)
 *   handover_can_sign_incharge()   = super OR role in (Admin, Fleet Incharge)
 */

export const STAGE_SUPERVISOR = 'supervisor'
export const STAGE_INCHARGE = 'incharge'

export const HANDOVER_STAGES = [
  {
    key: STAGE_SUPERVISOR,
    status: 'pending_supervisor',
    label: 'Supervisor sign-off',
    // app_is_elevated() = Admin/Manager/Director, plus the two fleet roles.
    // Fleet Incharge is here because a higher rung can act on the lower one -
    // that is what lets an incharge close in one signature.
    roles: ['Admin', 'Manager', 'Director', 'Fleet Supervisor', 'Fleet Incharge'],
  },
  {
    key: STAGE_INCHARGE,
    status: 'pending_incharge',
    label: 'Fleet incharge approval',
    // The final rung. Admin is a break-glass signer (exactly one person holds
    // Fleet Incharge and a queue only they can clear jams on leave). Manager and
    // Director sign the supervisor rung only - they are deliberately NOT here.
    roles: ['Admin', 'Fleet Incharge'],
  },
]

const BY_KEY = Object.fromEntries(HANDOVER_STAGES.map((s) => [s.key, s]))
const STATUS_TO_STAGE = Object.fromEntries(HANDOVER_STAGES.map((s) => [s.status, s.key]))

/** 'Fleet Incharge' and 'fleet_incharge' are the same role. The DB stores Title Case. */
export function normaliseRole(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * Which stage is outstanding on this handover, or null when none is. Reads the
 * row's OWN approval_status, so a sheet that has moved on since a list was drawn
 * resolves correctly.
 */
export function stageFor(row) {
  return STATUS_TO_STAGE[String(row?.approval_status ?? '')] ?? null
}

export function stageLabel(stageKey) {
  return BY_KEY[stageKey]?.label ?? ''
}

/**
 * Does this role satisfy the signer predicate for ONE named stage? Mirrors
 * handover_can_sign_supervisor() / handover_can_sign_incharge() exactly.
 */
export function roleCanSign(stageKey, role, opts = {}) {
  if (opts.isSuperAdmin) return true
  const def = BY_KEY[stageKey]
  if (!def) return false
  const r = normaliseRole(role)
  return def.roles.some((x) => normaliseRole(x) === r)
}

/**
 * At pending_supervisor, an incharge-signer (Admin / super / Fleet Incharge)
 * closes BOTH rungs with one signature. MIRRORS the SQL decide_handover_approval
 * (v_both) - change both. A Fleet Supervisor (or a Manager/Director) at the
 * supervisor rung advances to pending_incharge instead.
 */
export function closesInOneSign(row, opts = {}) {
  return stageFor(row) === STAGE_SUPERVISOR && roleCanSign(STAGE_INCHARGE, role_of(opts), opts)
}

/** Can this person decide THIS handover at its current stage right now? */
export function canActOnStage(row, opts = {}) {
  const stage = stageFor(row)
  if (!stage) return false
  return roleCanSign(stage, role_of(opts), opts) || closesInOneSign(row, opts)
}

/**
 * Rejection (send back) is available to any supervisor-signer at EITHER pending
 * stage, which is wider than approval authority - mirrors the SQL reject gate
 * (handover_can_sign_supervisor). The server is the authority; this only lets a
 * client show the control honestly.
 */
export function canReject(row, opts = {}) {
  return stageFor(row) != null && roleCanSign(STAGE_SUPERVISOR, role_of(opts), opts)
}

/** The status a decision moves the handover to. Pass opts.role so an incharge-signer closes in one. */
export function nextStatusFor(row, approved, opts = {}) {
  if (!approved) return 'rejected'
  const stage = stageFor(row)
  if (stage === STAGE_SUPERVISOR) {
    return closesInOneSign(row, opts) ? 'approved' : 'pending_incharge'
  }
  if (stage === STAGE_INCHARGE) return 'approved'
  return String(row?.approval_status ?? 'approved')
}

/**
 * The full ladder with what has happened on each rung, for the on-click sign-off
 * panel: who signed, when, and their signature.
 */
export function approvalProgress(row) {
  const st = String(row?.approval_status ?? '')
  return [
    {
      key: STAGE_SUPERVISOR,
      label: 'Supervisor sign-off',
      name: row?.supervisor_name ?? null,
      signature: row?.supervisor_signature ?? null,
      at: row?.supervisor_at ?? null,
      done: st === 'pending_incharge' || st === 'approved' || Boolean(row?.supervisor_at),
      current: st === 'pending_supervisor',
    },
    {
      key: STAGE_INCHARGE,
      label: 'Fleet incharge approval',
      name: row?.incharge_name ?? null,
      signature: row?.incharge_signature ?? null,
      at: row?.incharge_at ?? null,
      done: st === 'approved',
      current: st === 'pending_incharge',
    },
  ]
}

/** Closed means CLOSED - not "a supervisor looked at it". */
export function isFullyClosed(row) {
  return String(row?.approval_status ?? '') === 'approved'
}

export function isRejected(row) {
  return String(row?.approval_status ?? '') === 'rejected'
}

/**
 * One line saying where a handover has got to. Says "waiting for the fleet
 * incharge" rather than "pending", because "pending" tells the reader nothing
 * about who is holding it.
 */
export function statusSummary(row) {
  const st = String(row?.approval_status ?? '')
  if (st === 'approved') return { tone: 'good', text: 'Closed' }
  if (st === 'rejected') return { tone: 'bad', text: 'Sent back' }
  if (st === 'pending_incharge') return { tone: 'warn', text: 'Waiting for the fleet incharge' }
  if (st === 'pending_supervisor') return { tone: 'warn', text: 'Waiting for a supervisor' }
  if (st === 'draft') return { tone: 'muted', text: 'Draft' }
  return { tone: 'muted', text: 'No sign-off needed' }
}

// Small internal helper so every public fn accepts the same { role, isSuperAdmin } opts.
function role_of(opts) {
  return opts?.role
}
