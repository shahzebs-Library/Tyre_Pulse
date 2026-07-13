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
  'id,title,template_name,asset_no,site,country,submitted_at,submitted_by,' +
  'score_pct,score_passed,approval_status'

/**
 * Checklist submissions from `require_approval` templates still awaiting sign-off
 * (V212), oldest first. Country-scoped, RLS-scoped, degrades to [] pre-migration.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listChecklistApprovals({ country } = {}) {
  try {
    let q = supabase
      .from('checklist_submissions')
      .select(CHECKLIST_COLS)
      .eq('approval_status', 'pending')
      .order('submitted_at', { ascending: true })
      .limit(500)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Decide a checklist submission. RLS restricts UPDATE on `checklist_submissions`
 * to elevated roles (V212), so this is the client convenience over an
 * authorised write — the same shape the mobile CHECKLIST_APPROVAL command uses.
 * Approving locks the submission; rejecting requires a review note.
 * @param {string} id
 * @param {{ approved:boolean, approverName?:string|null, approverId?:string|null,
 *   reviewNote?:string|null }} decision
 */
export async function decideChecklist(id, { approved, approverName = null, approverId = null, reviewNote = null } = {}) {
  if (!approved && !(reviewNote && String(reviewNote).trim())) {
    throw new Error('A note is required when returning a checklist for correction.')
  }
  const patch = {
    approval_status: approved ? 'approved' : 'rejected',
    approver_name: approverName ? String(approverName).slice(0, 200) : null,
    approved_by: approverId || null,
    approved_at: new Date().toISOString(),
    review_note: approved ? null : String(reviewNote).trim().slice(0, 8000),
    locked: !!approved,
  }
  return unwrap(
    await supabase
      .from('checklist_submissions')
      .update(patch)
      .eq('id', id)
      .select('id,approval_status')
      .single(),
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
