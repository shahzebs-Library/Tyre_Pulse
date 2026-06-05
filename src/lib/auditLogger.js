import { supabase } from './supabase'

export async function logAuditEvent({ action, tableName, recordCount = 1, details = {} }) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('audit_log').insert({
      user_id: user.id, action, table_name: tableName, record_count: recordCount, details,
    })
  } catch (e) { console.warn('Audit log failed:', e.message) }
}
