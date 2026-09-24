/**
 * Access Review service. Super-admin only; every RPC refuses anyone else
 * server-side (42501). Deciding records evidence; only applyAccessReview
 * changes access (locks users decided "revoke").
 */
import { supabase, unwrap } from './_client'

export async function listAccessReviews() {
  return unwrap(await supabase.rpc('admin_list_access_reviews')) || []
}

export async function getAccessReview(campaignId) {
  const raw = unwrap(await supabase.rpc('admin_get_access_review', { p_campaign: campaignId }))
  return { campaign: raw?.campaign || null, items: Array.isArray(raw?.items) ? raw.items : [] }
}

export async function startAccessReview(name, dueAt = null) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('A campaign name is required.')
  return unwrap(await supabase.rpc('admin_start_access_review', {
    p_name: clean,
    p_due_at: dueAt ? new Date(dueAt).toISOString() : null,
  }))
}

export async function decideAccessItem(itemId, decision, note = null) {
  if (decision === 'revoke' && !String(note || '').trim()) throw new Error('A revoke decision needs a reason.')
  return unwrap(await supabase.rpc('admin_decide_access_item', {
    p_item: itemId, p_decision: decision, p_note: note ? String(note).trim() : null,
  }))
}

/** Sequential on purpose: each call is its own audited decision. */
export async function bulkDecide(itemIds = [], decision = 'keep', note = null, onProgress) {
  const out = { ok: 0, failed: 0, errors: [] }
  let i = 0
  for (const id of itemIds) {
    try { await decideAccessItem(id, decision, note); out.ok += 1 } catch (e) { out.failed += 1; out.errors.push(e) }
    i += 1
    onProgress?.(i, itemIds.length)
  }
  return out
}

export async function applyAccessReview(campaignId) {
  return unwrap(await supabase.rpc('admin_apply_access_review', { p_campaign: campaignId }))
}
