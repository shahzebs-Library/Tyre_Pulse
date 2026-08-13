/**
 * Send a message to your people - their phones and their in-app inbox.
 *
 * Everything else that notifies in this system is event driven: something
 * happens and the right people are told. There was no way for a manager to
 * simply say something to the team. The Announcements page writes a banner
 * inside the web app and reaches no phone at all.
 *
 * This adds no new transport. The in-app row goes to `notifications`, the same
 * bell the web and the phone already read, and the push is queued into
 * `workflow_notifications` for the delivery job that already exists - so retry,
 * backoff and the global push kill switch all apply unchanged.
 *
 * The audience is resolved on the SERVER, both for the preview and for the
 * send, so the count an admin is shown before pressing send is produced by the
 * same query that decides who is actually told.
 *
 * @module api/broadcast
 */
import { supabase } from './_client'

const COLS = 'id,title,body,title_ar,body_ar,target_roles,target_countries,target_sites,'
  + 'send_push,status,recipient_count,push_count,sent_at,created_at'

function missing(error) {
  const m = String(error?.message || error?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find')
    || m.includes('schema cache')
}

/**
 * Who this audience actually resolves to, before anything is sent.
 *
 * `with_app` is the number that matters and is deliberately separate from the
 * total: a message to 35 people of whom 2 carry the app is not a message to 35
 * phones, and presenting one number would let someone believe the fleet had
 * been reached.
 *
 * @param {{roles?:string[], countries?:string[], sites?:string[]}} [audience]
 * @returns {Promise<{ok:boolean,total:number,with_app:number,by_role:Array}>}
 */
export async function previewAudience({ roles = [], countries = [], sites = [] } = {}) {
  const { data, error } = await supabase.rpc('broadcast_audience', {
    p_roles: roles, p_countries: countries, p_sites: sites,
  })
  if (error) {
    if (missing(error)) return { ok: false, total: 0, with_app: 0, by_role: [] }
    throw error
  }
  return {
    ok: data?.ok === true,
    total: Number(data?.total) || 0,
    with_app: Number(data?.with_app) || 0,
    by_role: Array.isArray(data?.by_role) ? data.by_role : [],
  }
}

/**
 * Send it. One server call does the whole thing, so a message can never land
 * half delivered - recorded, in every inbox, and queued to every device that
 * exists, or none of it.
 *
 * The Arabic fields are OPTIONAL and are never generated. A machine translation
 * of an operational instruction that nobody checked is worse than no Arabic at
 * all. When they are supplied, a reader known to use Arabic gets the Arabic
 * version, and anyone whose language the system does not know yet gets both
 * rather than silently losing half the message.
 *
 * @returns {Promise<{ok:boolean, id?:string, recipients:number, pushes_queued:number, reason?:string}>}
 */
export async function sendBroadcast({
  title, body, titleAr, bodyAr,
  roles = [], countries = [], sites = [], sendPush = true,
} = {}) {
  const { data, error } = await supabase.rpc('broadcast_send', {
    p_title: title,
    p_body: body,
    p_title_ar: titleAr || null,
    p_body_ar: bodyAr || null,
    p_roles: roles,
    p_countries: countries,
    p_sites: sites,
    p_send_push: sendPush !== false,
  })
  if (error) throw error
  return {
    ok: data?.ok === true,
    id: data?.id,
    reason: data?.reason,
    recipients: Number(data?.recipients) || 0,
    pushes_queued: Number(data?.pushes_queued) || 0,
  }
}

/** Messages already sent, newest first. `[]` before the feature is provisioned. */
export async function listBroadcasts(limit = 50) {
  const { data, error } = await supabase
    .from('broadcast_messages').select(COLS)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (missing(error)) return []
    throw error
  }
  return data || []
}

/* ── pure helpers ───────────────────────────────────────────────────────── */

/**
 * Plain English for who a message went to. An empty audience means everyone,
 * which is worth saying out loud rather than rendering as blank.
 */
export function audienceLabel({ target_roles, target_countries, target_sites } = {}) {
  const parts = []
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : [])
  if (list(target_roles).length) parts.push(list(target_roles).join(', '))
  if (list(target_countries).length) parts.push(list(target_countries).join(', '))
  if (list(target_sites).length) parts.push(list(target_sites).join(', '))
  return parts.length ? parts.join(' - ') : 'Everyone'
}

/**
 * What is wrong with this message, or '' when it is ready to send.
 * An Arabic body with no Arabic title (or the reverse) is treated as unfinished
 * rather than sent half translated.
 */
export function validateBroadcast({ title, body, titleAr, bodyAr } = {}) {
  const t = String(title || '').trim()
  const b = String(body || '').trim()
  const ta = String(titleAr || '').trim()
  const ba = String(bodyAr || '').trim()
  if (!t) return 'Add a title.'
  if (!b) return 'Add a message.'
  if (t.length > 120) return 'Keep the title under 120 characters so it is readable on a phone.'
  if ((ta && !ba) || (ba && !ta)) return 'Fill in both the Arabic title and the Arabic message, or leave both blank.'
  return ''
}

/**
 * How many people will genuinely be reached on a phone, stated honestly.
 * Never implies a reach the device count does not support.
 */
export function reachNote({ total, with_app: withApp } = {}) {
  const n = Number(total) || 0
  const d = Number(withApp) || 0
  if (n === 0) return 'Nobody matches this audience yet.'
  const inbox = `${n} ${n === 1 ? 'person' : 'people'} will see it in the app`
  if (d === 0) return `${inbox}. None of them has the phone app signed in yet, so no push will be delivered.`
  return `${inbox}, and ${d} of them ${d === 1 ? 'has' : 'have'} the phone app, so ${d === 1 ? 'that one gets' : 'they get'} a push too.`
}
