// auditLogger.js — Audit event logging for CLAUDE.md compliance
import { supabase } from './supabase'

const SESSION_ID = crypto.randomUUID()

export async function logAuditEvent({
  action,
  tableName = null,
  recordId = null,
  oldValues = null,
  newValues = null,
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('audit_log_v2').insert({
      user_id:    user.id,
      user_email: user.email,
      action,
      table_name: tableName,
      record_id:  String(recordId ?? ''),
      old_values: oldValues,
      new_values: newValues,
      session_id: SESSION_ID,
    })
  } catch {
    // Audit logging is non-critical — never throw
  }
}

// Convenience wrappers
export const audit = {
  create:  (table, id, values)        => logAuditEvent({ action: 'CREATE', tableName: table, recordId: id, newValues: values }),
  update:  (table, id, old, updated)  => logAuditEvent({ action: 'UPDATE', tableName: table, recordId: id, oldValues: old, newValues: updated }),
  delete:  (table, id, values)        => logAuditEvent({ action: 'DELETE', tableName: table, recordId: id, oldValues: values }),
  login:   ()                         => logAuditEvent({ action: 'LOGIN' }),
  logout:  ()                         => logAuditEvent({ action: 'LOGOUT' }),
  export:  (type, filters)            => logAuditEvent({ action: 'EXPORT', tableName: type, newValues: filters }),
  view:    (page)                     => logAuditEvent({ action: 'PAGE_VIEW', tableName: page }),
}
