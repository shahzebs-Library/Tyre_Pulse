import { supabase, unwrap } from './_client'

export async function loadDriverWorkspace(driverId = null) {
  const keys = driverId ? ['fines', 'assignments', 'records', 'events', 'work'] : ['drivers']
  let result
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = unwrap(await supabase.rpc('driver_workspace', { p_driver_id: driverId, p_offset: offset }))
    if (!result) result = { ...page, ...Object.fromEntries(keys.map(k => [k, []])) }
    for (const key of keys) result[key].push(...(page[key] || []).slice(0, 100))
    if (keys.every(key => (page[key] || []).length <= 100)) return { ...result, truncated: false }
  }
  return { ...result, truncated: true }
}

export async function driverWorkspaceCommand(action, payload, requestId) {
  return unwrap(await supabase.rpc('driver_workspace_command', {
    p_action: action, p_payload: payload, p_request_id: requestId,
  }))
}

export async function driverWorkspaceOptions(kind, search = '', offset = 0) {
  return unwrap(await supabase.rpc('driver_workspace_options', { p_kind: kind, p_search: search, p_offset: offset }))
}

export async function loadDriverFineRegister(filters = {}, offset = 0) {
  return unwrap(await supabase.rpc('driver_fine_register', { p_filters: filters, p_offset: offset }))
}

export async function runDriverFineReminders() {
  return unwrap(await supabase.rpc('driver_workspace_run_reminders'))
}

export async function fineSignature(responseId) {
  return unwrap(await supabase.from('driver_fine_responses').select('signature').eq('id', responseId).single()).signature
}

export async function evidenceUrl(path) {
  return unwrap(await supabase.storage.from('driver-fine-evidence').createSignedUrl(path, 60)).signedUrl
}

export async function uploadFineEvidence(fine, file, kind, requestId) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' }[file.type]
  if (!extension || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or PDF up to 5 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const valid = extension === 'png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    : extension === 'jpg' ? bytes[0] === 255 && bytes[1] === 216
      : String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
  if (!valid) throw new Error('The file content does not match its type.')
  const path = `${fine.organisation_id}/${fine.driver_id}/${fine.id}/${requestId}.${extension}`
  const { error } = await supabase.storage.from('driver-fine-evidence').upload(path, file, { contentType: file.type, upsert: false })
  if (error && !['409', 'Duplicate'].includes(String(error.statusCode || error.code))) throw error
  return driverWorkspaceCommand('attach_evidence', { driver_id: fine.driver_id, fine_id: fine.id, object_path: path, file_name: file.name.slice(0, 160), kind }, requestId)
}
