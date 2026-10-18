import { supabase, unwrap } from './_client'

async function postEntry(name, args) {
  try { return unwrap(await supabase.rpc(name, args)) } catch (error) {
    if (error.code === 'PT423') throw new Error('An approval workflow protects this stock item. Open Movement history to review its approval status.')
    if (error.code === '23505') throw new Error('This entry or item already exists. Refresh stock and select its Existing stock suggestion.')
    throw error
  }
}

export async function searchStockItems({ country, site, query, signal }) {
  let q = supabase.rpc('stock_item_suggestions', { p_country: country, p_site: site, p_query: query })
  if (signal) q = q.abortSignal(signal)
  return unwrap(await q) || []
}

export async function saveStockEntry({ requestId, country, site, mode, reference, notes, lines }) {
  return postEntry('save_stock_entry', {
    p_request_id: requestId, p_country: country, p_site: site, p_mode: mode,
    p_reference: reference || '', p_notes: notes || '', p_lines: lines,
  })
}

export async function transferStockEntry({ requestId, from, to, quantity, notes }) {
  return postEntry('transfer_stock_entry', {
    p_request_id: requestId, p_from: from.id, p_to: to.id, p_qty: Number(quantity),
    p_expected_from: from.stock_qty, p_expected_to: to.stock_qty, p_notes: notes || '',
  })
}
