import { supabase, unwrap } from './_client'

function missing(err) {
  const code = err?.code || err?.cause?.code
  const message = String(err?.message || err?.cause?.message || '').toLowerCase()
  return ['42P01', 'PGRST205'].includes(code) || message.includes('does not exist') || message.includes('schema cache')
}

export async function listShiftHandovers({ site, limit = 20 } = {}) {
  try {
    let query = supabase.from('shift_handovers')
      .select('id,country,site,shift_id,handed_over_by,to_user_id,summary,open_item_count,status,submitted_at,accepted_at,accepted_by,rejection_reason,created_at,updated_at')
    if (site && site !== 'All') query = query.eq('site', site)
    return unwrap(await query.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (missing(err)) return []
    throw err
  }
}

export async function submitShiftHandover({ country, site, shiftId, toUserId, summary, actionItemIds = [] }) {
  const cleanSummary = String(summary || '').trim().slice(0, 8000)
  if (!cleanSummary) throw new Error('A handover summary is required.')
  const handover = unwrap(await supabase.from('shift_handovers').insert({
    country: country && country !== 'All' ? country : null,
    site: site && site !== 'All' ? String(site).slice(0, 200) : null,
    shift_id: shiftId || null,
    to_user_id: toUserId || null,
    summary: cleanSummary,
    open_item_count: actionItemIds.length,
    status: 'submitted',
    submitted_at: new Date().toISOString(),
  }).select('id,country,site,shift_id,handed_over_by,to_user_id,summary,open_item_count,status,submitted_at,created_at').single())
  if (handover?.id && actionItemIds.length) {
    const links = actionItemIds.map((actionItemId) => ({ handover_id: handover.id, action_item_id: actionItemId }))
    const { error } = await supabase.from('shift_handover_items').insert(links)
    if (error) throw error
  }
  return handover
}

export async function reviewShiftHandover(id, accepted, reason = null) {
  const patch = accepted
    ? { status: 'accepted', accepted_at: new Date().toISOString(), rejection_reason: null }
    : { status: 'rejected', rejection_reason: String(reason || '').trim().slice(0, 4000) }
  return unwrap(await supabase.from('shift_handovers').update(patch).eq('id', id)
    .select('id,status,accepted_at,accepted_by,rejection_reason,updated_at').single())
}
