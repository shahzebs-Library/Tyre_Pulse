import { supabase } from './supabase'
import { secureStorage, readItem } from './secureStorage'
import { File } from 'expo-file-system'
import { safeUuid } from './ids'

export type WorkspaceData = Record<string, any>
export const RESOLUTIONS = ['direct_payment', 'already_paid', 'dispute', 'company_recovery', 'instalments']
export const RECORD_TYPES = ['driver_documents', 'driver_training', 'driver_coaching', 'driver_safety_events', 'driver_expenses', 'tyre_records', 'accidents', 'wo_tasks', 'checklist_submissions', 'odometer_logs', 'wash_records']
export const RECEIPT_STATEMENT = 'I acknowledge receipt and review of this notice and submit the response shown above. Receipt does not mean admission of responsibility. A payment or recovery request does not authorize an automatic payment or payroll deduction.'
export function workspaceRequestId(): string {
  return safeUuid()
}
export function recordLabel(r: WorkspaceData | null): string {
  return r ? [r.title || r.course_name || r.doc_type || r.event_type || r.category || r.template_name || r.accident_type || r.brand, r.asset_no, r.driver_name, r.incident_date || r.expense_date || r.reading_date || r.created_at].filter(Boolean).join(' · ') || r.id : 'Record no longer available'
}
export function validateFineResponse(v: WorkspaceData): string | null {
  if (!RESOLUTIONS.includes(v.resolution)) return 'Choose a resolution.'
  if ((v.explanation || '').trim().length < 3) return 'Explain your request, including the proposed arrangement.'
  if (v.resolution === 'already_paid' && (v.payment_reference || '').trim().length < 3) return 'Enter your payment reference.'
  if (v.resolution === 'direct_payment' && !v.proposed_date) return 'Choose your proposed payment date.'
  if (!v.acknowledged || !v.signature) return 'Review the statement and sign before submitting.'
  return null
}
async function unwrap(request: PromiseLike<{ data: any; error: any }>) {
  const { data, error } = await request; if (error) throw error; return data
}
export async function loadDriverWorkspace(driverId: string | null = null): Promise<WorkspaceData> {
  const keys = driverId ? ['fines', 'assignments', 'records', 'events', 'work'] : ['drivers']
  let result: WorkspaceData = {}
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = await unwrap(supabase.rpc('driver_workspace', { p_driver_id: driverId, p_offset: offset }))
    if (!offset) result = { ...page, ...Object.fromEntries(keys.map(k => [k, []])) }
    for (const key of keys) result[key].push(...(page[key] || []).slice(0, 100))
    if (keys.every(key => (page[key] || []).length <= 100)) return { ...result, truncated: false }
  }
  return { ...result, truncated: true }
}
export const driverWorkspaceCommand = (action: string, payload: WorkspaceData, requestId: string) => unwrap(supabase.rpc('driver_workspace_command', { p_action: action, p_payload: payload, p_request_id: requestId }))
export const driverWorkspaceOptions = (kind: string, search = '', offset = 0): Promise<WorkspaceData[]> => unwrap(supabase.rpc('driver_workspace_options', { p_kind: kind, p_search: search, p_offset: offset }))
export const fineSignature = async (id: string): Promise<string> => (await unwrap(supabase.from('driver_fine_responses').select('signature').eq('id', id).single())).signature
export const evidenceUrl = async (path: string): Promise<string> => (await unwrap(supabase.storage.from('driver-fine-evidence').createSignedUrl(path, 60))).signedUrl

export async function uploadFinePhoto(fine: WorkspaceData, uri: string, kind: string, requestId: string) {
  const file = new File(uri)
  if (!file.exists || file.size > 5 * 1024 * 1024) throw new Error('Choose a photo up to 5 MB.')
  const bytes = await file.bytes()
  const extension = bytes[0] === 137 && bytes[1] === 80 ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpg' : null
  if (!extension) throw new Error('Choose a PNG or JPEG image.')
  const path = `${fine.organisation_id}/${fine.driver_id}/${fine.id}/${requestId}.${extension}`
  const { error } = await supabase.storage.from('driver-fine-evidence').upload(path, bytes.buffer, { contentType: extension === 'png' ? 'image/png' : 'image/jpeg', upsert: false })
  if (error && !['409', 'Duplicate'].includes(String((error as any).statusCode || (error as any).code))) throw error
  return driverWorkspaceCommand('attach_evidence', { driver_id: fine.driver_id, fine_id: fine.id, object_path: path, file_name: `evidence.${extension}`, kind }, requestId)
}

function slot(owner: string, suffix: string) {
  if (!owner) throw new Error('Sign in before opening saved driver work.')
  return `driver_workspace_v1_${owner.replace(/[^a-zA-Z0-9_-]/g, '_')}_${suffix}`
}
export async function readWorkspaceSaved(owner: string, suffix: string): Promise<WorkspaceData | null> {
  const result = await readItem(slot(owner, suffix))
  if (result.status === 'unreadable' || result.status === 'torn') throw new Error('Saved work could not be read. Nothing has been overwritten.')
  return result.value ? JSON.parse(result.value) : null
}
export const saveWorkspaceData = (owner: string, suffix: string, data: WorkspaceData) => secureStorage.setItem(slot(owner, suffix), JSON.stringify(data))
export const clearWorkspaceData = (owner: string, suffix: string) => secureStorage.removeItem(slot(owner, suffix))
