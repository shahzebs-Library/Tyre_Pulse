/**
 * SSO enforcement after a PASSWORD sign-in - mobile mirror of the web
 * `checkSsoPasswordLogin` in src/lib/api/accessPolicies.js.
 *
 * An organisation that requires SSO (sso_connections.enforce_sso, V200 + the
 * 20260924117000 access policies) refuses password sign-in for its users.
 * Super admins are exempt server-side. The check is asked AFTER the password
 * has been proven, so the answer is only ever given to the account holder and
 * is never an account-enumeration oracle.
 *
 * FAILS OPEN on any error, missing RPC or malformed payload: a broken check
 * must never lock field staff out of the app.
 *
 * Kept free of React Native / supabase imports so the plain Node jest suite
 * can exercise it; the caller injects the RPC.
 */

export interface SsoCheckResult {
  allowed: boolean
  reason: string | null
  failedOpen: boolean
}

type RpcResult = { data: unknown; error: unknown }

/** Pure: turn the RPC response into a decision. Anything unclear allows. */
export function interpretSsoCheck(res: RpcResult | null | undefined): SsoCheckResult {
  if (!res || res.error || !res.data || typeof res.data !== 'object') {
    return { allowed: true, reason: null, failedOpen: true }
  }
  const d = res.data as { allowed?: unknown; reason?: unknown }
  return {
    allowed: d.allowed !== false,
    reason: typeof d.reason === 'string' ? d.reason : null,
    failedOpen: false,
  }
}

/** Calls `sso_password_login_check` through the injected rpc; never throws. */
export async function checkSsoPasswordLogin(
  rpc: () => PromiseLike<RpcResult>,
): Promise<SsoCheckResult> {
  try {
    return interpretSsoCheck(await rpc())
  } catch {
    return { allowed: true, reason: null, failedOpen: true }
  }
}
