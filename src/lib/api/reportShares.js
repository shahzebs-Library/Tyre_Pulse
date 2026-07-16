/**
 * reportShares - shareable public/TV report links (V251/V252).
 *
 * Mirrors displayTokens.js: elevated users mint / list / revoke share tokens;
 * the PUBLIC TV viewer reads an org-scoped aggregate snapshot by token via a
 * SECURITY DEFINER RPC that any (even anonymous) client may call. No table is
 * ever exposed to anon; the org is embedded in the token row so nothing leaks.
 */
import { supabase } from '../supabase'

// The report "pages" a share can rotate through (choose any). Extend as more
// public report views are added; the viewer renders whatever the share lists.
export const REPORT_PAGES = [
  { key: 'board_kpis',   label: 'KPIs',      desc: 'Headline KPIs across every module.' },
  { key: 'board_trends', label: 'Trends',    desc: '12-month trend charts (spend, accidents, claims, inspections).' },
  { key: 'board_charts', label: 'Breakdowns', desc: 'Severity, claim status, by-site breakdown charts.' },
]
export const DEFAULT_PAGES = REPORT_PAGES.map((p) => p.key)

/** Missing-relation guard so the UI degrades gracefully before the migration. */
function isBackendMissing(err) {
  const m = String(err?.message || err?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache') || m === '42p01' || m === 'pgrst202'
}

const COLS = 'id, name, token, pages, rotate_seconds, refresh_seconds, active, expires_at, created_at, last_viewed_at, view_count'

/** List this org's report shares (elevated RLS). [] when not provisioned. */
export async function listReportShares() {
  const { data, error } = await supabase
    .from('report_shares').select(COLS).eq('active', true).order('created_at', { ascending: false })
  if (error) { if (isBackendMissing(error)) return []; throw error }
  return data ?? []
}

/**
 * Mint a share. Returns { id, token } - the plaintext token is shown ONCE.
 * @param {{name:string, pages?:string[], rotate?:number, refresh?:number, password?:string, expires?:string}} o
 */
export async function createReportShare(o = {}) {
  const { data, error } = await supabase.rpc('create_report_share', {
    p_name: o.name || 'Shared report',
    p_pages: (o.pages && o.pages.length) ? o.pages : DEFAULT_PAGES,
    p_rotate: o.rotate ?? 30,
    p_refresh: o.refresh ?? 300,
    p_password: o.password || null,
    p_expires: o.expires || null,
  })
  if (error) throw error
  return data
}

/** Revoke (deactivate) a share by id. */
export async function revokeReportShare(id) {
  const { error } = await supabase.rpc('revoke_report_share', { p_id: id })
  if (error) throw error
}

/** PUBLIC read: aggregate snapshot for a share token (callable by anon). */
export async function getReportSnapshot(token, password = null) {
  const { data, error } = await supabase.rpc('get_report_snapshot', { p_token: token, p_password: password })
  if (error) { if (isBackendMissing(error)) return { ok: false, reason: 'unavailable' }; throw error }
  return data || { ok: false, reason: 'invalid' }
}

/** Absolute public share URL for a token. */
export function buildShareUrl(token) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/report/${token}`
}
