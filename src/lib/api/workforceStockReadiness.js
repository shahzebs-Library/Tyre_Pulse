/**
 * Loads what the stock-readiness check needs: the tyre sizes on one asset and the stock register for
 * the caller's country. Read-only; RLS scopes both tables. Never throws: a failed read returns
 * { ok:false } so the check reads "could not check" rather than inventing a stock figure.
 */
import { supabase, fetchAllPages, applyCountry, toServiceError } from './_client'
import { assetSizeKeys, stockReadiness } from '../workforceStockReadiness'

const STOCK_COLS = 'id,site,description,tyre_size,stock_qty,stock_status,last_counted_at,updated_at'

export async function loadStockReadiness ({ assetNo, site, country } = {}) {
  const asset = String(assetNo ?? '').trim().toUpperCase()
  if (!asset) return { ok: true, result: null }
  try {
    // Currently fitted tyres first, scoped to the selected country (an asset number can exist in
    // more than one country). History is read only when nothing is fitted, newest first.
    const tyreQuery = () => applyCountry(supabase.from('tyre_records').select('size,status,removal_date')
      .eq('asset_no', asset), country)
    let tyres = await tyreQuery().is('removal_date', null).order('id', { ascending: true }).limit(200)
    if (tyres.error) throw toServiceError(tyres.error, 'Could not read the asset tyres')
    if (!assetSizeKeys(tyres.data || []).length) {
      tyres = await tyreQuery().order('removal_date', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(200)
      if (tyres.error) throw toServiceError(tyres.error, 'Could not read the asset tyres')
    }
    const stock = await fetchAllPages((from, to) => applyCountry(
      supabase.from('stock_records').select(STOCK_COLS), country).order('id', { ascending: true }).range(from, to), { max: 5000 })
    if (stock.error) throw toServiceError(stock.error, 'Could not read stock')
    const sizes = assetSizeKeys(tyres.data || [])
    return { ok: true, result: stockReadiness({ sizes, site, stockRows: stock.data || [] }), truncated: !!stock.truncated }
  } catch (error) {
    return { ok: false, error }
  }
}
