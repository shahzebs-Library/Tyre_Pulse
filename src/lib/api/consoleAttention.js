/**
 * Loader for the console dashboard's attention panel. Every reader settles
 * independently; a failed reader yields null (UNKNOWN), which the pure engine
 * renders as "could not check" rather than a silent all-clear.
 */
import { supabase } from '../supabase'

const count = async (build) => {
  try {
    const { count: c, error } = await build()
    return error ? null : (c ?? null)
  } catch { return null }
}

const latest = async (table, dateCol, country) => {
  try {
    let q = supabase.from(table).select(dateCol).order(dateCol, { ascending: false }).limit(1)
    if (country) q = q.eq('country', country)
    const { data, error } = await q
    if (error) return null
    return data?.[0]?.[dateCol] ?? null
  } catch { return null }
}

export async function loadAttentionInputs() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const [pendingUsers, lockedUsers, unresolvedErrors, openTrustAlerts, ksaExp, uaeExp, egyExp, ksaJc] =
    await Promise.all([
      count(() => supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('approved', false)),
      count(() => supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('locked', true)),
      count(() => supabase.from('system_logs').select('id', { count: 'exact', head: true })
        .in('severity', ['error', 'critical']).eq('resolved', false).gte('created_at', weekAgo)),
      count(() => supabase.from('trust_alerts').select('id', { count: 'exact', head: true }).eq('status', 'open')),
      latest('parts_consumption', 'event_date', 'KSA'),
      latest('parts_consumption', 'event_date', 'UAE'),
      latest('parts_consumption', 'event_date', 'Egypt'),
      latest('work_orders', 'created_at', 'KSA'),
    ])
  return {
    pendingUsers, lockedUsers, unresolvedErrors, openTrustAlerts,
    feeds: [
      { label: 'KSA expenses', latest: ksaExp },
      { label: 'UAE expenses', latest: uaeExp },
      { label: 'Egypt expenses', latest: egyExp },
      { label: 'KSA job cards', latest: ksaJc },
    ],
  }
}
