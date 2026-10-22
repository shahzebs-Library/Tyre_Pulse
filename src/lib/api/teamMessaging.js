/**
 * Message the Team receipt / reply API. Backend RLS restricts recipient access.
 * Device push delivery cannot be inferred from notifications or queue status.
 */
import { supabase, toServiceError } from './_client'

export async function listMyTeamMessages(limit = 100) {
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw toServiceError(authError)
  const userId = auth?.user?.id
  if (!userId) throw new Error('Sign in to view team messages.')
  const { data, error } = await supabase.from('notifications')
    .select('id,title,body,entity_id,read,created_at')
    .eq('user_id', userId).eq('type', 'broadcast')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw toServiceError(error)
  return data || []
}

export async function listMyTeamReceipts() {
  const { data, error } = await supabase.from('broadcast_recipient_receipts')
    .select('broadcast_id,recipient_id,read_at,acknowledged_at')
  if (error) throw toServiceError(error)
  return data || []
}

export async function readTeamMessage(broadcastId) {
  if (!broadcastId) throw new Error('Message ID is required.')
  const { data, error } = await supabase.from('broadcast_recipient_receipts')
    .update({ read_at: new Date().toISOString() })
    .eq('broadcast_id', broadcastId).is('read_at', null)
    .select('broadcast_id,read_at')
  if (error) throw toServiceError(error)
  return data || []
}

export async function acknowledgeTeamMessage(broadcastId) {
  if (!broadcastId) throw new Error('Message ID is required.')
  const { data, error } = await supabase.from('broadcast_recipient_receipts')
    .update({ acknowledged_at: new Date().toISOString(), read_at: new Date().toISOString() })
    .eq('broadcast_id', broadcastId).is('acknowledged_at', null)
    .select('broadcast_id,acknowledged_at')
  if (error) throw toServiceError(error)
  if (!data?.length) throw new Error('Message already acknowledged or not available to this account.')
  return data[0]
}

export async function listTeamReplies(broadcastId) {
  if (!broadcastId) return []
  const { data, error } = await supabase.from('broadcast_replies')
    .select('id,broadcast_id,author_id,body,created_at')
    .eq('broadcast_id', broadcastId)
    .order('created_at', { ascending: true }).limit(250)
  if (error) throw toServiceError(error)
  return data || []
}

/**
 * Push queue / provider-result rows for one broadcast (manager-only via RLS; an
 * unauthorised caller simply gets no rows). Reflects provider acceptance, never OS delivery.
 */
export async function listBroadcastPushQueue(broadcastId) {
  if (!broadcastId) return []
  const { data, error } = await supabase.from('workflow_notifications')
    .select('status,attempts,result,last_error,created_at,delivered_at')
    .eq('event_type', 'broadcast.sent')
    .eq('payload->>entity_id', broadcastId)
    .limit(50)
  if (error) throw toServiceError(error)
  return data || []
}

export async function replyToTeamMessage(broadcastId, body) {
  const value = String(body || '').trim()
  if (!broadcastId || !value || value.length > 4000) throw new Error('Reply must be 1 to 4,000 characters.')
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw toServiceError(authError)
  const authorId = auth?.user?.id
  if (!authorId) throw new Error('Sign in to reply.')
  const { data, error } = await supabase.from('broadcast_replies')
    .insert({ broadcast_id: broadcastId, author_id: authorId, body: value })
    .select('id,broadcast_id,author_id,body,created_at').single()
  if (error) throw toServiceError(error)
  return data
}
