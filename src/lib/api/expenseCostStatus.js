/**
 * Expense cost status service (migration 20261110090000). Read only.
 *
 * get_expense_cost_status_summary: per country (own currency) lines and amount by
 * ACTUAL / ESTIMATED / CONFIRMED_ZERO / MISSING / DISPUTED, plus credits, repair,
 * retread and the two dispute reasons. expense_cost_status_lines: the lines behind a
 * status, capped at 500 here.
 *
 * Both degrade to { ok:false } / [] when the functions are not provisioned yet, so a
 * page never breaks before the migration is applied.
 */
import { supabase, isNotProvisioned, toServiceError } from './_client'
import { shapeExpenseStatusSummary } from '../expenseCostStatus'

const scopeCountry = (c) => (c && c !== 'All' ? c : null)
const day = (d) => (d ? String(d).slice(0, 10) : null)

export async function getExpenseCostStatusSummary({ country, from, to } = {}) {
  const { data, error } = await supabase.rpc('get_expense_cost_status_summary', {
    p_country: scopeCountry(country), p_from: day(from), p_to: day(to),
  })
  if (error) {
    if (isNotProvisioned(error)) return { ok: false, countries: [], notProvisioned: true }
    throw toServiceError(error)
  }
  return shapeExpenseStatusSummary(data)
}

export async function listExpenseCostStatusLines({ country, from, to, status, limit = 200 } = {}) {
  const { data, error } = await supabase.rpc('expense_cost_status_lines', {
    p_country: scopeCountry(country), p_from: day(from), p_to: day(to),
    p_status: status || null, p_limit: Math.max(1, Math.min(Number(limit) || 200, 500)),
  })
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error)
  }
  return Array.isArray(data) ? data : []
}
