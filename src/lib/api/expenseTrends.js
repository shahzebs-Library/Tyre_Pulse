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
import { callScopedMulti } from './partsConsumption'

/**
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array>} rows: {country, year, currency, lines, tyre, spare, lubricant, total}
 */
export async function getExpenseYearlyTrend({ country } = {}) {
  return getExpensePeriodTrend({ country, grain: 'year' })
}

/**
 * Period-flexible expense trend. grain = 'year' | 'quarter' | 'month'.
 * @returns {Promise<Array>} rows: {country, period, currency, lines, tyre, spare, lubricant, total}
 */
export async function getExpensePeriodTrend({ country, grain = 'year' } = {}) {
  const g = ['year', 'quarter', 'month'].includes(grain) ? grain : 'year'
  try {
    const { data, error } = await supabase.rpc('get_expense_period_trend', {
      p_country: country && country !== 'All' ? country : 'All',
      p_grain: g,
    })
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * The period trend for an explicit list of countries (V544).
 *
 * The underlying aggregate was ALREADY per country - it groups by (country,
 * period) and tags every row with its own currency, so its rows were never
 * blended. What it could not express was a SUBSET: it takes one country or the
 * literal 'All'. This closes that, so a two-of-three-country scope stops
 * reporting on the third.
 *
 * Returns the FLAT row list the pure `expenseTrends` engine already consumes
 * (it splits by country itself), because a per-country wrapper here would be a
 * second grouping of rows that already carry their country.
 *
 * @param {{countries:string[], grain?:'year'|'quarter'|'month'}} opts
 * @returns {Promise<{ok:boolean, rows:Array, refused:string[]}>}
 */
export async function getExpensePeriodTrendMulti({ countries, grain = 'year' } = {}) {
  const g = ['year', 'quarter', 'month'].includes(grain) ? grain : 'year'
  try {
    const res = await callScopedMulti('get_expense_period_trend_multi', countries, { p_grain: g })
    return {
      ok: res.ok,
      refused: res.refused,
      rows: res.blocks.flatMap((b) => (Array.isArray(b?.result) ? b.result : [])),
    }
  } catch {
    return { ok: false, rows: [], refused: [] }
  }
}
