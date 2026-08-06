/**
 * accidentPortal - external insurer / authority read-only portal links for ONE
 * accident case (docs/accident-module/16_EXTERNAL_PORTAL.sql, Phase 10).
 *
 * An insurer or claims authority sometimes needs to SEE the state of one case
 * (is the claim registered, what is the severity, which teams are still open)
 * without a login or any reach into tenant data. This mirrors the report_shares
 * anon-token pattern: a token row carries the organisation, the external party
 * reads a PII-lean snapshot ONLY through a SECURITY DEFINER RPC gated by that
 * high-entropy token, and NO base table is ever exposed to anon.
 *
 * SHIP-BEFORE-MIGRATE. 16_EXTERNAL_PORTAL.sql is an AUTHORED review artifact, not
 * yet applied, so the RPCs may not exist. Every mint / revoke here degrades: when
 * the function is not provisioned (missing relation / function) it returns a
 * { ok:false, reason:'not_provisioned' } sentinel instead of throwing, so the UI
 * shows an honest "not yet activated" note. A REAL failure (permission, out of
 * scope) still surfaces as an error.
 *
 * The RPC parameter names below match the SQL definitions verbatim:
 *   accident_portal_create(p_accident_id uuid, p_password text, p_expires timestamptz)
 *   accident_portal_revoke(p_id uuid)
 */
import { supabase, unwrap, isMissingRelation } from './_client'

/** Returned when the portal RPCs are not yet provisioned (pre-migration). */
const NOT_PROVISIONED = { ok: false, reason: 'not_provisioned' }

/**
 * Mint a read-only external portal link for one accident case.
 *
 * @param {string} accidentId accidents.id
 * @param {{ password?: string, expires?: string }} [opts] optional bcrypt password
 *   and an ISO expiry timestamp; blanks are sent as null.
 * @returns {Promise<object>} the RPC payload `{ ok:true, id, token }`, or the
 *   `{ ok:false, reason:'not_provisioned' }` sentinel when the RPC is not live.
 */
export async function createCasePortalLink(accidentId, { password, expires } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  try {
    const data = unwrap(
      await supabase.rpc('accident_portal_create', {
        p_accident_id: accidentId,
        p_password: (password && String(password).trim()) || null,
        p_expires: expires || null,
      }),
    )
    return data || NOT_PROVISIONED
  } catch (err) {
    if (isMissingRelation(err)) return NOT_PROVISIONED
    throw err
  }
}

/**
 * Revoke (deactivate) a portal link by its share id.
 *
 * @param {string} id accident_portal_shares.id
 * @returns {Promise<object>} `{ ok:true, id, active:false }`, or the
 *   `{ ok:false, reason:'not_provisioned' }` sentinel when the RPC is not live.
 */
export async function revokeCasePortalLink(id) {
  if (!id) throw new Error('A portal link id is required.')
  try {
    const data = unwrap(await supabase.rpc('accident_portal_revoke', { p_id: id }))
    return data || { ok: true, id }
  } catch (err) {
    if (isMissingRelation(err)) return NOT_PROVISIONED
    throw err
  }
}

/**
 * Read the PII-lean snapshot behind a portal token. ANON-callable by design -
 * this is the one read an insurer makes from the public viewer page. Returns
 * the RPC payload verbatim: `{ ok:true, case_no, reference_no, status,
 * severity, workflow_stage, incident_date, workstreams, claim, generated_at }`
 * or `{ ok:false, reason:'invalid'|'revoked'|'expired'|'password'|'unavailable' }`.
 * Never throws for the viewer - a transport failure maps to 'unavailable'.
 *
 * @param {string} token portal share token ('acp_...')
 * @param {string} [password] required only when the link was minted with one
 */
export async function getCasePortalSnapshot(token, password) {
  try {
    const { data, error } = await supabase.rpc('get_accident_portal_snapshot', {
      p_token: String(token || ''),
      p_password: (password && String(password)) || null,
    })
    if (error) return { ok: false, reason: 'unavailable' }
    return data || { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Absolute external portal URL for a token, served by the public viewer page
 * at /accident-portal/<token> (src/pages/AccidentPortalView.jsx).
 *
 * @param {string} token portal share token ('acp_...')
 * @returns {string}
 */
export function buildCasePortalUrl(token) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/accident-portal/${token}`
}
