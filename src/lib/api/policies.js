/**
 * Policies service — Policy Management module (V137). Stores fleet governance
 * documents (policies, SOPs, standards) with versioning, ownership, effective/
 * review dates and a status lifecycle. RLS enforces org isolation; reads are
 * open to any authenticated member, writes to Admin/Manager/Director. This layer
 * keeps an explicit column list and null-safe country scoping, mirroring
 * support.js / stock.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,title,category,version,owner,effective_date,' +
  'review_date,status,body,notes,created_by,created_at,updated_at'

export const POLICY_STATUSES = ['draft', 'active', 'under_review', 'archived']

/** True when a Supabase error indicates the table has not been created yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List policies (newest first). Optional status/country filters. Returns [] when
 * the backing table is missing so the page can surface the "apply migration"
 * state instead of crashing.
 */
export async function listPolicies({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('policies').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getPolicy(id) {
  return unwrap(await supabase.from('policies').select(COLS).eq('id', id).maybeSingle())
}

/** Create a policy. Title is required; status defaults to draft. */
export async function createPolicy(values = {}) {
  const title = String(values.title || '').trim()
  if (!title) throw new Error('A policy title is required.')
  const status = POLICY_STATUSES.includes(values.status) ? values.status : 'draft'
  const payload = {
    title: title.slice(0, 300),
    category: values.category ? String(values.category).slice(0, 120) : null,
    version: values.version ? String(values.version).slice(0, 60) : null,
    owner: values.owner ? String(values.owner).slice(0, 160) : null,
    effective_date: values.effective_date || null,
    review_date: values.review_date || null,
    status,
    body: values.body ? String(values.body).slice(0, 20000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('policies').insert(payload).select(COLS).single())
}

/** Patch a policy. Strips immutable columns before writing. */
export async function updatePolicy(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.updated_at
  delete clean.organisation_id
  delete clean.created_by
  if (clean.status != null && !POLICY_STATUSES.includes(clean.status)) delete clean.status
  return unwrap(await supabase.from('policies').update(clean).eq('id', id).select(COLS).single())
}

export async function deletePolicy(id) {
  return unwrap(await supabase.from('policies').delete().eq('id', id))
}
