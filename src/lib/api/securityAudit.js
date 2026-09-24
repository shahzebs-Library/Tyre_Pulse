/**
 * Security Audit service. Super-admin only; every function is enforced
 * server-side (the RPCs refuse anyone who is not a super admin).
 */
import { supabase, unwrap } from './_client'
import { shapePosture } from '../securityAudit'

export async function getSecurityPosture() {
  const raw = unwrap(await supabase.rpc('admin_security_posture'))
  return shapePosture(raw)
}

/** Run and record a scan. New findings alert every super admin. */
export async function runSecurityScan() {
  const raw = unwrap(await supabase.rpc('admin_run_security_scan'))
  return shapePosture(raw)
}

export async function listSecurityScans(limit = 26) {
  return unwrap(await supabase.rpc('admin_list_security_scans', { p_limit: limit })) || []
}

/** Break-glass trail: super-admin sign-ins and high-risk actions, newest first. */
export async function listBreakGlassEvents(limit = 50) {
  return unwrap(await supabase
    .from('system_logs')
    .select('id, created_at, severity, message, user_email, detail')
    .eq('source', 'break_glass')
    .order('created_at', { ascending: false })
    .limit(limit)) || []
}
