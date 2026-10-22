/**
 * Register filters for the AI Tyre Inspection page.
 *
 * Server side (date, site, status, text) lives in listInspectionsForAiRegister.
 * Everything here applies to the rows of the loaded page and ALSO re-checks the
 * server filters, which is idempotent and keeps the combination correct if a row
 * ever arrives that the server filter would have excluded.
 *
 * Semantics worth keeping (tested):
 *  - 'all' / '' disables a filter.
 *  - AI status 'none' = the inspection has no AI job at all.
 *  - A job filter (AI status, review status) matches when ANY job of the inspection matches,
 *    and a missing review_status counts as 'unreviewed'. An inspection without jobs can
 *    therefore never match a review-status filter.
 *  - Dates compare the calendar day (first 10 characters) inclusively.
 */
import { normalizePositionConditions } from './aiTyreInspectionDomain'

export const DEFAULT_REGISTER_FILTERS = Object.freeze({
  quick: 'all', site: 'all', status: 'all', condition: 'all',
  aiStatus: 'all', review: 'all', dateFrom: '', dateTo: '',
})

const on = v => v !== undefined && v !== null && v !== '' && v !== 'all'
const day = v => String(v || '').slice(0, 10)

export function matchesRegisterFilters(record, jobs, f = DEFAULT_REGISTER_FILTERS) {
  const filters = { ...DEFAULT_REGISTER_FILTERS, ...f }
  if (filters.quick === 'photos' && !record.photosForReview) return false
  if (filters.quick === 'measurements' && !record.measuredCount) return false
  if (filters.quick === 'missing' && !record.needsMeasurement) return false
  const list = jobs || []
  if (filters.aiStatus === 'none') { if (list.length) return false }
  else if (on(filters.aiStatus) && !list.some(j => j.status === filters.aiStatus)) return false
  if (on(filters.review) && !list.some(j => (j.review_status || 'unreviewed') === filters.review)) return false
  if (on(filters.site) && record.site !== filters.site) return false
  if (on(filters.status) && record.status !== filters.status) return false
  const d = day(record.inspection_date)
  if (filters.dateFrom && d < filters.dateFrom) return false
  if (filters.dateTo && d > filters.dateTo) return false
  if (on(filters.condition)
    && !Object.values(normalizePositionConditions(record)).some(v => v?.condition === filters.condition)) return false
  return true
}

export function applyRegisterFilters(records, jobsByInspection, filters) {
  return (records || []).filter(r => matchesRegisterFilters(r, jobsByInspection?.[r.id], filters))
}

/** Distinct, sorted tyre conditions present in the rows (for the filter dropdown). */
export function conditionOptions(rows) {
  return [...new Set((rows || []).flatMap(r => Object.values(normalizePositionConditions(r)).map(v => v?.condition).filter(Boolean)))].sort()
}
