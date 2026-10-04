/**
 * Reads for console values that used to say "Not recorded" although the
 * database holds them (migration 20261004110100_console_fill_data_gaps).
 * Both RPCs are super admin only and throw a clean message on failure.
 */
import { supabase, ServiceError } from './_client'
import { toUserMessage } from '../safeError'

async function rpc(name, args, fallback) {
  let res
  try {
    res = await supabase.rpc(name, args)
  } catch (err) {
    throw new ServiceError(toUserMessage(err, fallback), err?.code, err)
  }
  if (res?.error) throw new ServiceError(toUserMessage(res.error, fallback), res.error.code, res.error)
  return res?.data ?? null
}

export function getOrgStorage() {
  return rpc('admin_org_storage', {}, 'Could not read storage per organization.')
}

export function getUserSigninFacts(userId) {
  return rpc('admin_user_signin_facts', { p_user: userId }, 'Could not read sign-in history.')
}
