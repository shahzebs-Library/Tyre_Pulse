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
 * writes ('pending_approval' | 'approved' | 'rejected').
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
  approverName: string
  approverSignature: string | null
  approverId: string | null
  reviewNote: string | null
  /** Existing notes so a return reason can be appended without a read round-trip. */
  existingNotes?: string | null
}

/**
 * Approve or return an inspection. Approve locks the record and stores the
 * approver's signature; return re-opens it to the field with the review note
 * appended to the notes. Throws on failure (the caller surfaces a safe message).
 */
export async function decideInspection(input: DecideInspectionInput): Promise<void> {
  const { id, approved, approverName, approverSignature, approverId, reviewNote, existingNotes } = input

  const patch: Record<string, any> = approved
    ? {
        approval_status: 'approved',
        status: 'Done',
        approver_signature: approverSignature,
        approver_email: approverName || null,
        approved_by: approverId,
        approved_at: new Date().toISOString(),
        locked: true,
      }
    : {
        approval_status: 'rejected',
        status: 'In Progress',
        notes: [
          existingNotes?.trim() || '',
          reviewNote ? `Returned by ${approverName || 'supervisor'}: ${reviewNote}` : '',
        ].filter(Boolean).join('\n\n') || null,
      }

  const { error } = await supabase.from('inspections').update(patch).eq('id', id)
  if (error) throw error
}
