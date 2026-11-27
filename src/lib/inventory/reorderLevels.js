/**
 * Suggested reorder levels from real consumption.
 *
 * Inputs per register row: the usage from `usageFor` (stockRegisterDetail.js) and,
 * when known, the item's lead time from Material Master. Only a SITE rate is used:
 * a country rate mixes every site's issues and cannot say how much one store needs,
 * so it never produces a suggestion (the reason is stated instead).
 *
 *   critical level = usage over the lead time
 *   min level      = critical level + safety stock (half a month of usage)
 *   reorder qty    = two months of usage
 *
 * Everything is rounded UP to whole units and is never negative. A value that
 * cannot be measured is null, never 0. Nothing here writes anything: a person
 * applies a suggestion from the register.
 *
 * Pure functions, no I/O. Text is English unless the caller passes `t`
 * (see src/lib/wmsText.js).
 */
import { textFn } from '../wmsText'

/** Lead time used when Material Master holds none (0 of 23,274 items carry one today). */
export const DEFAULT_LEAD_DAYS = 30
/** Safety stock, in months of usage, on top of the lead-time usage. */
export const SAFETY_MONTHS = 0.5
/** Months of usage one reorder should cover. */
export const COVER_MONTHS = 2

const DAYS_PER_MONTH = 30

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const up = (v) => Math.max(0, Math.ceil(+v.toFixed(6)))

/** Lead time for a row: Material Master when set (> 0), else the default. */
export function leadTimeFor(r, defaultDays = DEFAULT_LEAD_DAYS) {
  const lt = num(r?.item?.lead_time_days ?? r?.lead_time_days)
  if (lt !== null && lt > 0) return { days: Math.round(lt), source: 'material_master' }
  return { days: defaultDays, source: 'default' }
}

/**
 * Suggestion for one row.
 * @param {object} r register row (country, site, item, min_level, critical_level, reorder_qty)
 * @param {{scope:'site'|'country'|'none', avgPerMonth:number}|null} usage
 * @returns {{ ok:boolean, reason:string|null, avgPerMonth:number|null, leadDays:number|null,
 *   leadSource:string|null, critical:number|null, min:number|null, reorderQty:number|null,
 *   current:{critical:number|null,min:number|null,reorderQty:number|null}, differs:boolean,
 *   explanation:string }}
 */
export function suggestReorderLevels(r, usage, { defaultLeadDays = DEFAULT_LEAD_DAYS, t } = {}) {
  const tx = textFn(t)
  const current = {
    critical: num(r?.critical_level),
    min: num(r?.min_level),
    reorderQty: num(r?.reorder_qty),
  }
  const none = (reason, explanation) => ({
    ok: false, reason, avgPerMonth: usage ? num(usage.avgPerMonth) : null, leadDays: null, leadSource: null,
    critical: null, min: null, reorderQty: null, current, differs: false, explanation,
  })

  if (!usage) return none('no_code', tx('wmsmsgprocure.reorder.noCode'))
  if (usage.scope === 'country') {
    return none('country_only', tx('wmsmsgprocure.reorder.countryOnly'))
  }
  const rate = num(usage.avgPerMonth)
  if (usage.scope !== 'site' || rate === null || rate <= 0) {
    return none('no_usage', tx('wmsmsgprocure.reorder.noUsage'))
  }

  const { days, source } = leadTimeFor(r, defaultLeadDays)
  const critical = up(rate * (days / DAYS_PER_MONTH))
  const min = critical + up(rate * SAFETY_MONTHS)
  const reorderQty = Math.max(1, up(rate * COVER_MONTHS))
  const differs = current.critical !== critical || current.min !== min || current.reorderQty !== reorderQty

  const leadText = tx(source === 'material_master' ? 'wmsmsgprocure.reorder.leadMaster' : 'wmsmsgprocure.reorder.leadDefault', { days })
  const explanation = tx('wmsmsgprocure.reorder.explanation', { rate, critical, lead: leadText, min, reorder: reorderQty })

  return { ok: true, reason: null, avgPerMonth: rate, leadDays: days, leadSource: source, critical, min, reorderQty, current, differs, explanation }
}

/** Suggestions for many rows, keyed by row id via `usageOf(row)`. */
export function buildReorderSuggestions(rows = [], usageOf, opts) {
  return (rows || []).map(r => ({ row: r, s: suggestReorderLevels(r, usageOf ? usageOf(r) : null, opts) }))
}

/** Counts for the honesty line above the panel. */
export function summarizeSuggestions(items = []) {
  const out = { total: 0, suggested: 0, differs: 0, countryOnly: 0, noUsage: 0, noCode: 0 }
  for (const { s } of items || []) {
    out.total += 1
    if (s.ok) { out.suggested += 1; if (s.differs) out.differs += 1; continue }
    if (s.reason === 'country_only') out.countryOnly += 1
    else if (s.reason === 'no_code') out.noCode += 1
    else out.noUsage += 1
  }
  return out
}

/** The patch the existing edit path writes for one applied suggestion. */
export function levelPatch(s) {
  if (!s?.ok) return null
  return { min_level: s.min, critical_level: s.critical, reorder_qty: s.reorderQty }
}
