/**
 * Open one job card by its id OR by its human job card number.
 *
 * A job card number is unique per company since TEN-1b, not globally. An
 * ordinary user only sees their own company (RLS), so a number resolves to one
 * card for them. A super admin's read spans companies, so the same number can
 * match a card in each: the caller's own company wins, a number held by one
 * company only resolves to that card, and a number held by several other
 * companies is reported as ambiguous instead of opening an arbitrary one.
 */
import { supabase, toServiceError } from './_client'
import { currentOrgId, pickCompanyRow } from './companyScope'

const ID_RE = /^[0-9a-f-]{16,}$/i

/**
 * @param {string} ref            work_orders.id or work_orders.work_order_no
 * @param {{select:string, country?:string}} opts
 *   select must include organisation_id.
 * @returns {Promise<{job:object|null, ambiguous:boolean}>}
 */
export async function loadWorkOrderByRef(ref, { select, country } = {}) {
  const key = String(ref ?? '').trim()
  if (!key) return { job: null, ambiguous: false }
  const scoped = country && country !== 'All' ? country : null
  const byId = ID_RE.test(key)
  let q = supabase.from('work_orders').select(select)
  q = byId ? q.eq('id', key) : q.eq('work_order_no', key)
  if (scoped) q = q.eq('country', scoped)
  const { data, error } = await q.order('id').limit(byId ? 1 : 50)
  if (error) throw toServiceError(error, 'Could not load the job.')
  const rows = Array.isArray(data) ? data : []
  if (byId) return { job: rows[0] || null, ambiguous: false }
  const { row, ambiguous } = pickCompanyRow(rows, await currentOrgId())
  return { job: row, ambiguous }
}
