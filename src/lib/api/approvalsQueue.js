/**
 * Approvals queue aggregation service — the single Supabase boundary that lets
 * the unified Approval Dashboard (`src/pages/Approvals.jsx`) surface EVERY
 * pending approval type that lives outside the V95 workflow engine, alongside
 * it. The workflow engine itself stays owned by `workflows.js`
 * (`approval_dashboard` / `workflow_act`); this module adds the other
 * approval-bearing surfaces that exist in the schema:
 *
 *   • Accident closure requests — `accidents.closure_status = 'pending_closure'`,
 *     actioned by the SECURITY DEFINER RPCs `approve_accident_closure` /
 *     `reject_accident_closure` (both enforce `is_elevated_user()` server-side).
 *   • Checklist sign-off — `checklist_submissions.approval_status = 'pending'`
 *     (V212), decided by a direct RLS-gated UPDATE (same columns the mobile
 *     CHECKLIST_APPROVAL command writes; RLS restricts UPDATE to elevated roles).
 *   • Data intake batches — `import_batches.approval_status = 'pending_approval'`
 *     plus the legacy `pending_uploads` queue. These have their own rich review
 *     surface (`UploadApprovals.jsx`); we only COUNT them here and deep-link,
 *     never duplicate the commit workflow.
 *
 * Conventions mirror the rest of `src/lib/api/*`: explicit least-privilege
 * column lists, `applyCountry` null-safe scoping, `unwrap` error surfacing, and
 * a missing-relation guard so an un-provisioned table degrades to an honest
 * empty result instead of throwing. No fabricated rows — every item is real.
 */
import { supabase, unwrap, applyCountry } from './_client'

/** True when the failure is "table/relation does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  )
}

/** True when the failure is "function not found" (RPC not provisioned). */
function isMissingFunction(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return code === '42883' || code === 'PGRST202' || msg.includes('could not find the function')
}

// ─── Accident closure approvals ─────────────────────────────────────────────────

const ACCIDENT_CLOSURE_COLS =
  'id,asset_no,driver_name,incident_date,site,country,severity,accident_type,' +
  'estimated_damage_cost,closure_status,close_requested_by,close_requested_at,close_request_note'

/**
 * Accident closure requests awaiting an elevated approver, oldest request first
 * (the closest to breaching an internal SLA sits at the top). Country-scoped and
 * RLS-scoped. Degrades to [] if the `accidents` table is absent.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listAccidentClosures({ country } = {}) {
  try {
    let q = supabase
      .from('accidents')
      .select(ACCIDENT_CLOSURE_COLS)
      .eq('closure_status', 'pending_closure')
      .order('close_requested_at', { ascending: true, nullsFirst: false })
      .limit(500)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Approve an accident closure. Delegates to the SECURITY DEFINER RPC, which
 * verifies the caller is Admin/Manager/Director, closes the case, writes a
 * closure remark and notifies the requester. No client-side role trust.
 * @param {string} accidentId
 */
export async function approveAccidentClosure(accidentId) {
  return unwrap(await supabase.rpc('approve_accident_closure', { p_accident_id: accidentId }))
}

/**
 * Reject an accident closure (returns the case to `open`). A reason is strongly
 * encouraged and is recorded + notified to the requester server-side.
 * @param {string} accidentId
 * @param {string|null} [reason]
 */
export async function rejectAccidentClosure(accidentId, reason = null) {
  return unwrap(
    await supabase.rpc('reject_accident_closure', {
      p_accident_id: accidentId,
      p_reason: reason && String(reason).trim() ? String(reason).trim().slice(0, 8000) : null,
    }),
  )
}

// ─── Checklist sign-off approvals ───────────────────────────────────────────────

const CHECKLIST_COLS =
  'id,title,template_name,template_id,asset_no,site,country,submitted_at,submitted_by,' +
  'score_pct,score_passed,approval_status,' +
  // V594. `document_no` is the reference the sheet is known by, and the
  // supervisor pair says whether the first rung is already behind it - without
  // them a queue row cannot say WHO it is waiting for.
  'document_no,supervisor_name,supervisor_at'

/** The waiting states. BOTH of them - see listChecklistApprovals. */
export const CHECKLIST_WAITING_STATUSES = ['pending', 'pending_area_manager']

/**
 * Checklist submissions still awaiting sign-off, oldest first.
 *
 * BOTH WAITING STATES, and that is the whole point. V594 split the sign-off into
 * a supervisor rung and an area-manager rung, so a sheet a supervisor has already
 * signed sits at 'pending_area_manager'. Reading only 'pending' made that sheet
 * VANISH from the queue with nobody able to close it - the work had been done and
 * the last approval could never be asked for.
 *
 * The template's two-stage flag is attached from a second cheap query rather than
 * an embedded join: the template list is tiny, and naming a PostgREST
 * relationship is a guess that breaks silently when a constraint is renamed. A
 * template we cannot read leaves the flag false, i.e. the single-stage default,
 * which is what every pre-V594 template genuinely is.
 *
 * Country-scoped, RLS-scoped, degrades to [] pre-migration.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listChecklistApprovals({ country } = {}) {
  try {
    let q = supabase
      .from('checklist_submissions')
      .select(CHECKLIST_COLS)
      .in('approval_status', CHECKLIST_WAITING_STATUSES)
      .order('submitted_at', { ascending: true })
      .limit(500)
    q = applyCountry(q, country)
    const rows = unwrap(await q) || []
    return attachTemplateRules(rows)
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Attach each row's `require_area_manager` so the queue can say which rung it is
 * waiting on. Best-effort: a failure leaves the rows exactly as they arrived
 * rather than emptying a queue over a decoration.
 */
async function attachTemplateRules(rows) {
  const ids = Array.from(new Set(rows.map((r) => r.template_id).filter(Boolean)))
  if (!ids.length) return rows
  try {
    const tpl = unwrap(await supabase
      .from('checklist_templates')
      .select('id,name,require_area_manager')
      .in('id', ids)
      .limit(500)) || []
    const byId = new Map(tpl.map((t) => [t.id, t]))
    return rows.map((r) => {
      const t = byId.get(r.template_id)
      return {
        ...r,
        template_name: r.template_name || t?.name || null,
        require_area_manager: !!t?.require_area_manager,
      }
    })
  } catch {
    return rows
  }
}

/**
 * Decide a checklist submission through the guarded server RPC (V320, taught the
 * second rung by V597).
 *
 * THE RUNG IS RESOLVED SERVER-SIDE, and it has to be. The caller says only
 * 'approved' or 'rejected'; the function reads the template's
 * require_area_manager and the row's own current status and decides whether that
 * means a SUPERVISOR sign-off (-> 'pending_area_manager', writing the supervisor
 * columns) or a FINAL approval (-> 'approved', writing the approver columns and
 * locking the row). Hand-rolling those column writes from here is exactly what
 * V597 had to undo: it wrote 'approved' straight from 'pending' and hit the
 * stage trigger with a raw 22023 that nobody could act on.
 *
 * The response carries the status it actually reached, so a caller must use
 * `res.status` rather than assuming a sign-off closed the sheet.
 *
 * A SIGNATURE IS MANDATORY on any approval - the function refuses without one.
 * Its refusals are plain sentences ("Only an area manager can give final
 * approval on this checklist."), so surface them as they are.
 *
 * A submission recorded 'not_required' never entered the queue at all (the
 * missed-sign-off case). The RPC only moves a row that is waiting, so such a row
 * is first enrolled into 'pending' and then decided. If the decision is then
 * refused - a blocking mark, the wrong role - the sheet is left in the queue
 * where it belongs rather than back in the silence it came from.
 *
 * @param {string} id
 * @param {{ approved:boolean, reviewNote?:string|null, signature?:string|null,
 *   currentStatus?:string|null }} decision
 * @returns {Promise<{ok:boolean, decision:string, status:string}>}
 */
export async function decideChecklist(id, {
  approved, reviewNote = null, signature = null, currentStatus = null,
} = {}) {
  if (!approved && !(reviewNote && String(reviewNote).trim())) {
    throw new Error('A note is required when returning a checklist for correction.')
  }
  if (approved && !String(signature ?? '').trim()) {
    throw new Error('A signature is required to sign off this checklist.')
  }

  if (currentStatus && !CHECKLIST_WAITING_STATUSES.includes(String(currentStatus))) {
    // Put it in the queue first, so the sign-off that was skipped is now being
    // ASKED for and then answered, through the one guarded path.
    unwrap(await supabase
      .from('checklist_submissions')
      .update({ approval_status: 'pending' })
      .eq('id', id)
      .select('id')
      .single())
  }

  const res = unwrap(await supabase.rpc('decide_checklist_approval', {
    p_submission_id: id,
    p_decision: approved ? 'approved' : 'rejected',
    p_note: reviewNote && String(reviewNote).trim() ? String(reviewNote).trim().slice(0, 8000) : null,
    p_signature: signature ? String(signature) : null,
  }))
  return res && typeof res === 'object'
    ? res
    : { ok: true, decision: approved ? 'approved' : 'rejected', status: approved ? 'approved' : 'rejected' }
}

// ─── Inspection sign-off approvals ──────────────────────────────────────────────

const INSPECTION_COLS =
  'id,title,inspection_type,asset_no,tyre_serial,site,country,inspection_date,' +
  'inspector,severity,created_at,approval_status'

/**
 * Field inspections awaiting sign-off (`approval_status = 'pending_approval'`,
 * the token the mobile submit path writes), oldest first. This is the queue the
 * tyre crews feed from their phones; it previously only surfaced on the
 * Inspections page, never on the unified Approval Dashboard.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listInspectionApprovals({ country } = {}) {
  try {
    let q = supabase
      .from('inspections')
      .select(INSPECTION_COLS)
      .eq('approval_status', 'pending_approval')
      .order('created_at', { ascending: true })
      .limit(500)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Decide an inspection through the guarded server RPC (V320): the approver
 * identity + timestamp are derived server-side, only a row still in
 * 'pending_approval' transitions, and a second decider gets a clean
 * "already decided" error. Approve locks it (status Done); reject returns it
 * to In Progress for rework.
 * @param {string} id
 * @param {{ approved:boolean, reviewNote?:string|null }} decision
 */
export async function decideInspection(id, { approved, reviewNote = null, signature = null } = {}) {
  // THE SIGNATURE USED TO BE DROPPED HERE. The RPC has taken `p_signature` since
  // V597 and the Inspections register refuses to approve without one, but this
  // path never sent it - so the SAME inspection, approved from the queue instead
  // of the register, was stored with `approver_signature` left null. The record
  // then showed an approval nobody had signed. It is passed through now.
  return unwrap(
    await supabase.rpc('decide_inspection_approval', {
      p_inspection_id: id,
      p_decision: approved ? 'approved' : 'rejected',
      p_note: reviewNote && String(reviewNote).trim() ? String(reviewNote).trim().slice(0, 8000) : null,
      p_signature: approved && signature ? String(signature) : null,
    }),
  )
}

// ─── Data-intake pending count (deep-link only, never duplicated here) ───────────

/**
 * Live count of data-intake approval points so the dashboard can badge a
 * deep-link to the canonical Upload / Data-Intake Approvals surface
 * (`UploadApprovals.jsx`). Sums:
 *   • `import_batches.approval_status = 'pending_approval'`  (canonical intake)
 *   • `pending_uploads.status = 'pending'`                  (legacy staged queue)
 * Each source is counted independently and any missing relation contributes 0,
 * so the badge is always honest.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<number>}
 */
export async function countDataIntakePending({ country } = {}) {
  const countOf = async (build) => {
    try {
      const { count, error } = await build()
      if (error) throw error
      return count || 0
    } catch (err) {
      if (isMissingRelation(err) || isMissingFunction(err)) return 0
      // A permission/other error should not blank the whole dashboard — treat as 0.
      return 0
    }
  }

  const batches = await countOf(() => {
    let q = supabase
      .from('import_batches')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending_approval')
    q = applyCountry(q, country)
    return q
  })

  const uploads = await countOf(() => {
    let q = supabase
      .from('pending_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    q = applyCountry(q, country)
    return q
  })

  return batches + uploads
}

// ─── Checklists that skipped the sign-off they were supposed to have ────────────

/**
 * Submissions from a template flagged `require_approval` that were nonetheless
 * recorded `approval_status = 'not_required'`, so they never entered any queue.
 *
 * WHY THIS EXISTS. The reported symptom was "checklist approvals do not show in
 * the dashboard". The queue was reading correctly and was genuinely empty - but
 * measured on the live data, the template "Predictive Maintenance Checklist" has
 * require_approval = true and TWO submissions against it, both stamped
 * not_required. Those predate the V212 approval lifecycle (all three live
 * submissions are from 2026-07-12, before the column was ever populated by the
 * submit path), so they are historical rather than a live leak - but an empty
 * queue that hides them tells the reader nobody ever needed to sign anything.
 *
 * Two cheap queries rather than an embedded join: the template list is tiny, and
 * naming a PostgREST relationship is a guess that breaks silently when the
 * constraint is renamed.
 *
 * @returns {Promise<Array<object>>}
 */
export async function listChecklistSignoffGaps({ country } = {}) {
  try {
    const templates = unwrap(await supabase
      .from('checklist_templates')
      .select('id,name')
      .eq('require_approval', true)
      .limit(500)) || []
    const ids = templates.map((t) => t.id).filter(Boolean)
    if (!ids.length) return []

    const nameById = new Map(templates.map((t) => [t.id, t.name]))
    let q = supabase
      .from('checklist_submissions')
      .select(CHECKLIST_COLS)
      .in('template_id', ids)
      .eq('approval_status', 'not_required')
      .order('submitted_at', { ascending: false })
      .limit(500)
    q = applyCountry(q, country)
    const rows = unwrap(await q) || []
    return rows.map((r) => ({ ...r, template_name: r.template_name || nameById.get(r.template_id) || null }))
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

// ─── Deciding several at once ───────────────────────────────────────────────────

/**
 * Decide many items in one action, reporting each result separately.
 *
 * THE CONTRACT IS PARTIAL HONESTY. Approvals are individually permissioned and
 * individually stateful: one item may have been decided by someone else a second
 * ago, or fall outside this user's country scope. So this never reports "12
 * approved" unless twelve actually succeeded - it returns every outcome and lets
 * the caller say "10 approved, 2 could not be". Rejecting the whole batch because
 * one item failed would be worse: the other eleven were legitimate.
 *
 * Runs sequentially on purpose. Each decision writes and may fire notification
 * triggers; a burst of parallel writes buys a second and risks rate limiting on
 * a queue that is normally a handful of rows.
 *
 * @param {Array<object>} items  approval items carrying { id, source }
 * @param {'approve'|'reject'} action
 * @param {{ reason?:string, signature?:string }} [opts]
 * @returns {Promise<{ ok:Array, failed:Array<{item:object, error:string}> }>}
 */
export async function bulkDecide(items, action, opts = {}) {
  const approve = action === 'approve'
  const ok = []
  const failed = []
  for (const item of (Array.isArray(items) ? items : [])) {
    try {
      if (item.source === 'accident_closure') {
        if (approve) await approveAccidentClosure(item.id)
        else await rejectAccidentClosure(item.id, opts.reason || null)
      } else if (item.source === 'inspection') {
        // An inspection sign-off IS a signature, and the register refuses to
        // approve one without a mark. This path used to send none, so a
        // bulk-approved inspection was stored with `approver_signature` null -
        // an approval nobody had signed. The batch signature (the approver's
        // saved mark, applied to every row) is passed through now.
        await decideInspection(item.id, {
          approved: approve,
          reviewNote: approve ? null : (opts.reason || null),
          signature: approve ? (opts.signature || null) : null,
        })
      } else if (item.source === 'checklist') {
        await decideChecklist(item.id, {
          approved: approve,
          reviewNote: approve ? null : (opts.reason || null),
          // One signature drawn once and applied to the batch is the same person
          // signing each sheet, which is what a batch sign-off IS. Without one
          // the server refuses every row, so a caller that cannot supply it must
          // not offer bulk approval.
          signature: approve ? (opts.signature || null) : null,
          currentStatus: item.raw?.approval_status || null,
        })
      } else {
        throw new Error('This approval type cannot be decided in bulk.')
      }
      ok.push(item)
    } catch (err) {
      failed.push({ item, error: err?.message || 'could not be decided' })
    }
  }
  return { ok, failed }
}
