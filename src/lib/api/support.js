/**
 * Support service — Help Center tickets (V127). Any authenticated member can
 * raise a ticket (report an issue / ask a question); Admin/Manager/Director
 * triage and respond. RLS enforces org isolation and self-vs-triage visibility;
 * this layer keeps explicit column lists and null-safe country scoping, mirroring
 * checklists.js / stock.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,subject,category,severity,message,page_url,app_context,' +
  'status,admin_response,responded_by,responded_at,created_by,created_by_name,created_by_email,' +
  'created_at,updated_at,resolved_at'

export const TICKET_CATEGORIES = ['bug', 'question', 'feature', 'data', 'account', 'other']
export const TICKET_SEVERITIES = ['low', 'medium', 'high', 'critical']
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed']

/**
 * List tickets (newest first). `mine` restricts to the caller's own tickets
 * (RLS already hides others' tickets from non-triage roles, but a triage user
 * can opt into "just mine"). Optional status/country filters.
 */
export async function listTickets({ mine = false, status, country, limit = 200 } = {}) {
  let q = supabase.from('support_tickets').select(COLS)
  if (status) q = q.eq('status', status)
  if (mine) {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id
    if (uid) q = q.eq('created_by', uid)
  }
  q = applyCountry(q, country)
  return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
}

export async function getTicket(id) {
  return unwrap(await supabase.from('support_tickets').select(COLS).eq('id', id).maybeSingle())
}

/** Raise a new ticket. Captures the reporter's identity + originating page. */
export async function createTicket(values = {}) {
  const subject = String(values.subject || '').trim()
  const message = String(values.message || '').trim()
  if (!subject) throw new Error('A subject is required.')
  if (!message) throw new Error('Please describe the issue.')
  const category = TICKET_CATEGORIES.includes(values.category) ? values.category : 'question'
  const severity = TICKET_SEVERITIES.includes(values.severity) ? values.severity : 'medium'
  const payload = {
    subject: subject.slice(0, 200),
    message: message.slice(0, 8000),
    category,
    severity,
    country: values.country ?? null,
    page_url: values.page_url ? String(values.page_url).slice(0, 500) : null,
    app_context: values.app_context && typeof values.app_context === 'object' ? values.app_context : {},
    created_by_name: values.created_by_name ?? null,
    created_by_email: values.created_by_email ?? null,
    status: 'open',
  }
  return unwrap(await supabase.from('support_tickets').insert(payload).select(COLS).single())
}

/** Patch a ticket (triage: status, response). Stamps resolution timestamps. */
export async function updateTicket(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id; delete clean.created_by
  if (clean.status === 'resolved' || clean.status === 'closed') {
    clean.resolved_at = clean.resolved_at ?? new Date().toISOString()
  } else if (clean.status === 'open' || clean.status === 'in_progress') {
    clean.resolved_at = null
  }
  return unwrap(await supabase.from('support_tickets').update(clean).eq('id', id).select(COLS).single())
}

/** Triage helper: attach an admin response and (by default) mark in_progress. */
export async function respondToTicket(id, response, { status = 'in_progress' } = {}) {
  const { data: auth } = await supabase.auth.getUser()
  return updateTicket(id, {
    admin_response: String(response || '').slice(0, 8000),
    responded_by: auth?.user?.id ?? null,
    responded_at: new Date().toISOString(),
    status,
  })
}

export async function deleteTicket(id) {
  return unwrap(await supabase.from('support_tickets').delete().eq('id', id))
}

/** Aggregate counts by status for the triage header. */
export function summarizeTickets(rows = []) {
  const by = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (by[r?.status] != null) by[r.status] += 1
  }
  return { ...by, total: (Array.isArray(rows) ? rows.length : 0), unresolved: by.open + by.in_progress }
}
