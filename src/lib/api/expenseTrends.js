/**
 * expenseTrends service — the single Supabase seam for the Expense Trends &
 * Forecast surface. Calls the `get_expense_yearly_trend` RPC (V413), which
 * returns per (country, year) expense totals split by category (tyre / spare /
 * lubricant), each carrying its own currency. RLS enforces org + country scope.
 *
 * Degrades to [] when the RPC is not deployed yet so the page shows an honest
 * empty state. All analytics live in the pure `src/lib/expenseTrends.js` engine.
 */
import { supabase, isMissingRelation } from './_client'

/**
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array>} rows: {country, year, currency, lines, tyre, spare, lubricant, total}
 */
export async function getExpenseYearlyTrend({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_expense_yearly_trend', {
      p_country: country && country !== 'All' ? country : 'All',
    })
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}
