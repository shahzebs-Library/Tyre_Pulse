/**
 * driverFineRegisterAnalytics - pure helpers for the traffic fine register
 * (src/components/driver/DriverFineRegister.jsx, mounted on /driver-workspace).
 *
 * The register is paged SERVER-side by the driver_fine_register RPC: each call
 * returns up to PAGE_SIZE rows plus one look-ahead row that only says whether a
 * next page exists. Nothing here pretends to know the full total. The summary
 * covers the page on screen and says so; the exports page the whole filtered
 * set separately.
 *
 * Money rule: fines carry their own currency. Balances are summed PER
 * currency and never added across SAR / AED / EGP.
 */

export const FINE_PAGE_SIZE = 100

export const humanFineValue = (value) => String(value || 'not recorded').replaceAll('_', ' ')

// Number(null) is 0 and 0 is finite: a blank balance must stay unknown.
const finite = (v) => {
  if (v == null || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Split an RPC page into the visible rows and the "has next page" flag. */
export function splitFinePage(rows = [], pageSize = FINE_PAGE_SIZE) {
  const list = Array.isArray(rows) ? rows : []
  return { visible: list.slice(0, pageSize), hasNext: list.length > pageSize }
}

/** Summary of the visible page. Money per currency, never blended. */
export function summarizeFinePage(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStage = { driver: 0, supervisor: 0, finance: 0, complete: 0 }
  const balances = new Map()
  let open = 0
  let overdue = 0
  let unpricedBalances = 0
  for (const r of list) {
    if (String(r?.status || '').toLowerCase() === 'open') open += 1
    if (r?.overdue) overdue += 1
    const stage = String(r?.review_stage || '').toLowerCase()
    if (byStage[stage] != null) byStage[stage] += 1
    const bal = finite(r?.balance)
    const cur = String(r?.currency || '').trim()
    if (bal == null || !cur) { unpricedBalances += 1; continue }
    balances.set(cur, (balances.get(cur) || 0) + bal)
  }
  return {
    rows: list.length,
    open,
    overdue,
    byStage,
    balances: [...balances.entries()]
      .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    unpricedBalances,
  }
}

/** "SAR 1,500 | AED 300", or 'N/A' when no balance was recorded. */
export function formatBalances(balances = []) {
  if (!balances.length) return 'N/A'
  return balances.map((b) => `${b.currency} ${b.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' | ')
}

/** Number of filters in use (search counts once). */
export function activeFineFilterCount(f = {}) {
  let n = 0
  if (String(f.search || '').trim()) n += 1
  if (f.status) n += 1
  if (f.review_stage) n += 1
  if (f.overdue) n += 1
  return n
}
