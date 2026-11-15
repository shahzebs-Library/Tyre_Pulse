/**
 * One date window for a governed (expense grid) cost total.
 *
 * Pages offer different period pickers (a calendar year, "last 6 months",
 * "all time"). The grid reader needs concrete from/to days, so every picker is
 * turned into the same shape here and every screen states the window it used.
 */
const ALL_TIME_FROM = '2000-01-01'

const isoDay = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** @returns {{from:string,to:string,allTime:boolean}} */
export function governedWindow({ from, to } = {}, now = new Date()) {
  return {
    from: from || ALL_TIME_FROM,
    to: to || isoDay(now),
    allTime: !from,
  }
}

/** Plain-English label for a window: "2026-01-01 to 2026-12-31" or "all dates to ...". */
export function governedWindowLabel(win) {
  if (!win) return ''
  return win.allTime ? `all dates up to ${win.to}` : `${win.from} to ${win.to}`
}

/** The one sentence every tyre-record cost breakdown carries. */
export const GRID_BREAKDOWN_NOTE =
  'Breakdown from tyre record prices. The authoritative total comes from the expense grid, so these rows are not added up here.'
