/**
 * Inspection approvals - supervisor sign-off over the `inspections` table.
 *
 * When a field inspection is submitted it is stored with
 * `approval_status = 'pending_approval'` and the inspector's drawn signature. A
 * supervisor/manager reviews the recorded tyre conditions + signature and either
 * APPROVES (capturing their own signature, locking the record) or RETURNS it to
 * the field with a note. Country isolation + role gating are enforced server
 * side by the inspections RLS; the client filters are a convenience only.
 *
 * This mirrors the checklist approval flow (lib/checklists.decideApproval) but
 * over inspections, and reuses the same `approval_status` vocabulary the web app
 * writes ('pending_approval' | 'approved' | 'rejected'). NOTE that this is a
 * DIFFERENT vocabulary from the checklist one - do not carry tokens across.
 *
 * Reads are RLS-scoped; the DECISION goes through the `decide_inspection_approval`
 * RPC, which is where the approver check really lives (see decideInspection).
 */
import { supabase } from './supabase'

export interface InspectionApprovalItem {
  id: string
  title: string | null
  site: string | null
  asset_no: string | null
  vehicle_type: string | null
  inspector: string | null
  inspection_date: string | null
  created_at: string | null
  status: string | null
  approval_status: string | null
  notes: string | null
  findings: string | null
  odometer_km: number | null
  hour_meter: number | null
  tyre_conditions: Record<string, any> | null
  inspector_signature: string | null
  approver_signature: string | null
  approver_email: string | null
  approved_at: string | null
}

const LIST_COLS =
  'id,title,site,asset_no,vehicle_type,inspector,inspection_date,created_at,status,approval_status,inspector_signature'

const FULL_COLS =
  'id,title,site,asset_no,vehicle_type,inspector,inspection_date,created_at,status,approval_status,notes,findings,odometer_km,hour_meter,tyre_conditions,inspector_signature,approver_signature,approver_email,approved_at'

/** Pending inspections awaiting supervisor sign-off, newest first (country-scoped). */
export async function listPendingInspectionApprovals(
  country?: string | null,
): Promise<InspectionApprovalItem[]> {
  let q = supabase
    .from('inspections')
    .select(LIST_COLS)
    .eq('approval_status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(100)

  // profiles.country is a normalised scalar here; a null row country is visible
  // to everyone (matches the RESTRICTIVE country RLS). Skip the filter when the
  // approver has no country so they see the full pending queue.
  if (country) q = q.or(`country.eq.${country},country.is.null`)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as InspectionApprovalItem[]
}

/** Load one inspection in full for the review screen. */
export async function getInspectionForApproval(id: string): Promise<InspectionApprovalItem | null> {
  const { data, error } = await supabase
    .from('inspections')
    .select(FULL_COLS)
    .eq('id', id)
    .single()
  if (error) throw error
  return (data as InspectionApprovalItem) ?? null
}

export interface DecideInspectionInput {
  id: string
  approved: boolean
  approverSignature: string | null
  reviewNote: string | null
  /**
   * Display name used ONLY to word the returned-reason note the inspector
   * reads. It is never the authoritative approver - the server derives that
   * from the caller's own session (see below).
   */
  approverName?: string | null
  /** Existing notes so a return reason can be appended without a read round-trip. */
  existingNotes?: string | null
}

/**
 * Approve or return an inspection.
 *
 * THIS GOES THROUGH THE `decide_inspection_approval` RPC, NOT A DIRECT UPDATE,
 * AND THAT IS A CORRECTNESS FIX RATHER THAN A REFACTOR. The direct update this
 * replaces was wrong in four ways that a client can never fix on its own:
 *
 *  1. NO "ALREADY DECIDED" GUARD. Two supervisors opening the same pending
 *     inspection both wrote; the second silently overwrote the first one's
 *     signature and timestamp. The RPC updates `WHERE approval_status =
 *     'pending_approval'` and otherwise raises a message naming who decided it.
 *  2. IT TRUSTED THE CLIENT FOR WHO APPROVED. The typed name was written into
 *     `approver_email` - a free-text person's name landing in an email column -
 *     and `approved_by` came from the client. The RPC uses `auth.uid()` and the
 *     caller's own profile email, so the record cannot be attributed to someone
 *     who did not press the button.
 *  3. IT WAS ENFORCED BY THE WRONG RULE. The permissive `role_update_inspections`
 *     policy admits admin/manager/INSPECTOR, so the direct write let an inspector
 *     stamp an approval; only the mobile screen gate stopped it. The RPC refuses
 *     anyone outside Admin/Manager/Director/Maintenance Supervisor server side.
 *  4. IT BLOCKED DIRECTORS. That same policy does NOT list 'director', so a
 *     Director - who the approvals module and the RPC both allow - was refused by
 *     RLS with a generic error. The RPC is SECURITY DEFINER and admits them.
 *
 * Locking still happens: the RPC sets `status = 'Done'` on approve and the
 * `trg_lock_inspection_content` trigger auto-locks on that transition, so the
 * explicit `locked: true` the old path wrote was already redundant.
 *
 * Throws on failure; the caller surfaces a safe message. The RPC's own guard
 * messages are short and free of backend detail, so `toUserMessage` passes them
 * through verbatim - that is how "already approved by X" reaches the operator.
 */
export async function decideInspection(input: DecideInspectionInput): Promise<void> {
  const { id, approved, approverSignature, reviewNote, approverName, existingNotes } = input
  const note = reviewNote?.trim() || null

  const { error } = await supabase.rpc('decide_inspection_approval', {
    p_inspection_id: id,
    p_decision: approved ? 'approved' : 'rejected',
    p_note: note,
    p_signature: approverSignature,
  })
  if (error) throw error

  // The RPC records the reason in `inspection_audit_log`, which no mobile screen
  // reads. The inspector sees `inspections.notes` on the detail screen, so echo
  // the reason there too or a returned inspection arrives back with no visible
  // explanation of what to fix.
  //
  // BEST EFFORT ON PURPOSE: the decision above is already committed, so a failure
  // here (an approver whose role cannot UPDATE the row directly) must not be
  // reported as a failed decision. The reason is still in the audit log.
  if (!approved && note) {
    const merged = [
      existingNotes?.trim() || '',
      `Returned by ${approverName?.trim() || 'supervisor'}: ${note}`,
    ].filter(Boolean).join('\n\n')
    try {
      await supabase.from('inspections').update({ notes: merged }).eq('id', id)
    } catch {
      /* decision stands; reason is preserved in inspection_audit_log */
    }
  }
}
