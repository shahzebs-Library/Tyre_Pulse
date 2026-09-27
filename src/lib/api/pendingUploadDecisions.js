import { supabase, ServiceError } from './_client'
import { toUserMessage } from '../safeError'

export async function decidePendingUpload(id, approve, reason = null) {
  const { data, error } = await supabase.rpc(
    approve ? 'approve_pending_upload' : 'reject_pending_upload',
    { p_upload_id: id, ...(!approve ? { p_reason: reason } : {}) },
  )
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  if (data?.ok !== true) throw new Error('The server did not confirm the decision. Refresh before retrying.')
  return data
}
