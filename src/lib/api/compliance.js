/**
 * Compliance Center service (super-admin only).
 *
 * Gathers LIVE evidence from the services that already own each source and
 * records per source whether it loaded. Promise.allSettled on purpose: one
 * source failing must make only the controls that depend on it `unknown`,
 * never blank the page and never read as a pass.
 *
 * Attestations are written only through the SECURITY DEFINER RPCs
 * admin_attest_control / admin_withdraw_attestation, which refuse anyone who
 * is not a super admin (42501). The table itself is super-admin read only.
 */
import { supabase, unwrap } from './_client'
import { getSecurityPosture, listSecurityScans, listBreakGlassEvents } from './securityAudit'
import { listAccessReviews } from './accessReviews'
import { listAuditSeals } from './auditSeals'
import { listConsoleSessions } from './consoleSessions'
import { loadSystemConfig, isSystemConfigLoaded } from './systemConfig'
import { toUserMessage } from '../safeError'

const ATT_COLS = 'id, control_id, note, attested_by, attested_by_email, attested_at, expires_at, withdrawn_at, withdrawn_by, withdraw_reason'

export async function listAttestations() {
  return unwrap(await supabase
    .from('compliance_attestations')
    .select(ATT_COLS)
    .order('attested_at', { ascending: false })
    .limit(1000)) || []
}

/**
 * Backup snapshots for evidence. backups.listBackupSnapshots degrades every
 * error to [] (right for its own list view), but here an unreadable source
 * must be `unknown`, not "no backups exist" - so this calls the same RPC and
 * lets the error surface.
 */
async function loadBackupEvidence() {
  const data = unwrap(await supabase.rpc('list_backup_snapshots', { p_limit: 40 }))
  return Array.isArray(data) ? data : []
}

async function loadConfigEvidence() {
  const map = await loadSystemConfig({ force: true })
  if (!isSystemConfigLoaded()) throw new Error('System configuration could not be read.')
  return map || {}
}

export const EVIDENCE_LOADERS = {
  posture: () => getSecurityPosture().then((p) => { if (!p) throw new Error('No posture returned.'); return p }),
  scans: () => listSecurityScans(52),
  breakGlass: () => listBreakGlassEvents(200),
  accessReviews: () => listAccessReviews(),
  seals: () => listAuditSeals(),
  backups: loadBackupEvidence,
  consoleSessions: () => listConsoleSessions({ limit: 500 }),
  config: loadConfigEvidence,
  attestations: listAttestations,
}

/** @returns {Promise<{[source]: {ok: boolean, data?: any, error?: string}}>} */
export async function loadComplianceEvidence(loaders = EVIDENCE_LOADERS) {
  const keys = Object.keys(loaders)
  const settled = await Promise.allSettled(keys.map((k) => loaders[k]()))
  const out = {}
  settled.forEach((s, i) => {
    out[keys[i]] = s.status === 'fulfilled'
      ? { ok: true, data: s.value }
      : { ok: false, error: toUserMessage(s.reason, 'Could not load this evidence source.') }
  })
  return out
}

export async function attestControl(controlId, note, expiresAt) {
  const clean = String(note || '').trim()
  if (clean.length < 3) throw new Error('An attestation needs a note (at least 3 characters).')
  if (!expiresAt) throw new Error('An attestation needs an expiry date.')
  return unwrap(await supabase.rpc('admin_attest_control', {
    p_control_id: controlId,
    p_note: clean,
    p_expires_at: new Date(expiresAt).toISOString(),
  }))
}

export async function withdrawAttestation(id, reason) {
  const clean = String(reason || '').trim()
  if (clean.length < 3) throw new Error('A withdrawal needs a reason (at least 3 characters).')
  return unwrap(await supabase.rpc('admin_withdraw_attestation', { p_id: id, p_reason: clean }))
}
